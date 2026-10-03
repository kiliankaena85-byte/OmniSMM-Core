/**
 * YooKassa Multi-Tenant Webhook Request Handler
 * Shared between root route (/api/webhooks/yookassa) and parameterized route (/api/webhooks/yookassa/[tenantId]).
 * tenant-isolation-ignore: Inbound webhook resolves tenantId from incoming payment record before scoping.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { paymentService } from '@/services/financial/payment.service';
import { db } from '@/lib/db';
import { MutexManager } from '@/lib/redis-lock';
import { SecurityAlertService } from '@/services/security/security-alert.service';
import { logger } from '@/lib/logger';
import { sanitizeTenantSlug } from '@/lib/tenant-resolver-edge';
import { runWithTenant, runWithTenantBypass } from '@/lib/tenant-context';

interface YooKassaWebhookPayload {
  type?: string;
  event?: string;
  created_at?: string;
  object?: {
    id?: string;
    status?: string;
    paid?: boolean;
    amount?: {
      value?: string;
      currency?: string;
    };
    created_at?: string;
    metadata?: {
      paymentId?: string;
      userId?: string;
      orderId?: string;
      source?: string;
      tenantId?: string;
      type?: string;
      [key: string]: unknown;
    };
    receipt_registration?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const MAX_BODY_SIZE = 1024 * 64; // 64KB

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function rubToKopecks(value: unknown): bigint {
  if (typeof value !== 'string') {
    throw new Error('INVALID_AMOUNT_FORMAT');
  }

  const normalized = value.trim();

  const decimalMatch = /^(\d+)\.(\d{2})$/.exec(normalized);
  if (decimalMatch) {
    return BigInt(decimalMatch[1]) * BigInt(100) + BigInt(decimalMatch[2]);
  }

  const integerMatch = /^(\d+)$/.exec(normalized);
  if (integerMatch) {
    return BigInt(integerMatch[1]) * BigInt(100);
  }

  throw new Error('INVALID_AMOUNT_FORMAT');
}

export async function handleYooKassaWebhookRequest(
  req: NextRequest,
  explicitTenantId?: string
): Promise<NextResponse> {
  try {
    const { getClientIp } = await import('@/utils/ip');
    const rawIp = await getClientIp(req);
    const ip = rawIp.replace(/^::ffff:/, '');

    const { SettingsProvider, SettingsManager } = await import('@/lib/settings');
    const isTestMode = await SettingsProvider.isTestMode(explicitTenantId);
    const isDev = process.env.NODE_ENV === 'development';

    // --- SECURITY GUARD: Yookassa Official IP Range Validation (INV-GW-01) ---
    // Defense-in-depth only (forwarded IP headers are spoofable); authenticity is enforced
    // by mandatory API re-verification in confirmPayment. Test mode does NOT bypass this.
    const { isYooKassaIp } = await import('@/lib/security/yookassa-ip');
    const isAllowedIp = isDev ? true : isYooKassaIp(ip);
    
    if (!isAllowedIp) {
      console.error(`[YooKassa Webhook] BLOCKED: IP spoofing attempt from ${ip}`);
      await SecurityAlertService.record({
        event: 'SPOOFED_IP_WEBHOOK',
        severity: 'CRITICAL',
        ip,
        details: { gateway: 'yookassa' },
      });
      return NextResponse.json({ error: 'Unauthorized IP' }, { status: 403 });
    }

    const rawText = await req.text();
    if (rawText.length > MAX_BODY_SIZE) {
      console.warn('[Webhook] Oversized payload rejected');
      await SecurityAlertService.record({
        event: 'OVERSIZED_PAYLOAD',
        severity: 'WARNING',
        ip,
        details: { gateway: 'yookassa', size: rawText.length },
      });
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    let rawBody: YooKassaWebhookPayload = {};
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const internalPaymentId = rawBody.object?.metadata?.paymentId;
    const gatewayId = rawBody.object?.id;
    const metadataTenantId = rawBody.object?.metadata?.tenantId as string | undefined;

    // Zero-Trust Database Resolution: determine tenant strictly from DB payment record first
    let webhookTenantId: string | undefined = explicitTenantId ? sanitizeTenantSlug(explicitTenantId) : undefined;
    if (!webhookTenantId && (internalPaymentId || gatewayId)) {
      const p = await runWithTenantBypass('Inbound yookassa tenant lookup', async () => {
        return db.payment.findFirst({
          where: {
            OR: [
              ...(internalPaymentId ? [{ id: internalPaymentId }] : []),
              ...(gatewayId ? [{ gatewayId }] : [])
            ]
          },
          select: { tenantId: true }
        });
      });
      if (p?.tenantId) webhookTenantId = p.tenantId;
    }
    webhookTenantId = webhookTenantId || metadataTenantId || 'smmplan';

    return await runWithTenant(webhookTenantId, async () => {
    const secrets = await SettingsManager.getPaymentSecrets(webhookTenantId);
    const expectedSecret = secrets.yookassaWebhookSecret || (webhookTenantId === 'smmplan' ? process.env.YOOKASSA_WEBHOOK_SECRET : undefined);

    const providedSignature = req.headers.get('x-sha256-signature') || req.headers.get('x-content-signature') || req.headers.get('digest');

    // Verification of signature if provided
    if (providedSignature) {
      if (!expectedSecret) {
        console.error('[YooKassa] Webhook signature provided but secret is not configured on server (Fail-Closed)');
        return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
      }

      const crypto = (await import('crypto')).default;
      const expectedSig = crypto
        .createHmac('sha256', expectedSecret)
        .update(rawText, 'utf8')
        .digest('hex');

      const signatureHex = providedSignature.replace(/^sha256=/i, '');
      const HEX_REGEX = /^[0-9a-f]{64}$/i;

      if (!HEX_REGEX.test(signatureHex)) {
        await SecurityAlertService.record({
          event: 'INVALID_SIGNATURE_FORMAT',
          severity: 'CRITICAL',
          ip,
          details: { gateway: 'yookassa', signature: providedSignature },
        });
        return NextResponse.json({ error: 'Invalid signature format' }, { status: 403 });
      }

      if (!safeCompare(expectedSig, signatureHex)) {
        console.error('[YooKassa] HMAC signature mismatch — possible webhook forgery attempt');
        await SecurityAlertService.record({
          event: 'SIGNATURE_FAILED',
          severity: 'CRITICAL',
          ip,
          details: { gateway: 'yookassa' },
        });
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
      }
    }
    
    const webhookCreatedAt = rawBody.object?.created_at || rawBody.created_at;
    if (webhookCreatedAt) {
      const webhookTime = new Date(webhookCreatedAt).getTime();
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      if (webhookTime < twentyFourHoursAgo) {
        await SecurityAlertService.record({
          event: 'REPLAY_ATTEMPT',
          severity: 'CRITICAL',
          ip,
          details: { gateway: 'yookassa', webhookTime, gatewayId: rawBody.object?.id },
        });
        return NextResponse.json({ error: 'Stale webhook rejected' }, { status: 400 });
      }
    }

    // --- ANTI-REPLAY GUARD ---
    const webhookEventId = (rawBody as Record<string, unknown>).id as string | undefined || 
      (gatewayId ? `yoo:${rawBody.event || 'evt'}:${gatewayId}:${rawBody.object?.status || 'status'}` : undefined);
    
    let replayKey: string | null = null;
    if (webhookEventId) {
      try {
        const { redis } = await import('@/lib/redis');
        replayKey = `webhook:yoo:event:${webhookEventId}`;
        const isNew = await redis.set(replayKey, '1', 'EX', 86400, 'NX');
        if (!isNew) {
          logger.info('[YooKassa Webhook] Idempotent duplicate event bypassed', { webhookEventId });
          return NextResponse.json({ success: true, duplicate: true });
        }
      } catch (redisErr) {
        if (process.env.NODE_ENV === 'production') {
          console.error('[YooKassa Webhook] Fail-Closed: Redis Anti-Replay Guard unreachable:', redisErr);
          return NextResponse.json({ error: 'Anti-Replay Guard service unavailable' }, { status: 503 });
        }
      }
    }

    if (rawBody.event === 'payment.canceled' && rawBody.object) {
      const gId = rawBody.object.id;
      if (typeof gId !== 'string' || gId.trim().length === 0) {
        return NextResponse.json({ error: 'Invalid gatewayId' }, { status: 400 });
      }
      try {
        const result = await MutexManager.withLock(`webhook_payment_${gId}`, 15000, 10000, async () => {
          const success = await paymentService.cancelPayment(gId);
          return NextResponse.json({ success, status: 'Payment canceled' }, { status: 200 });
        });
        return result;
      } catch (lockError) {
        if (replayKey) {
          try {
            const { redis } = await import('@/lib/redis');
            await redis.del(replayKey).catch(() => {});
          } catch {
            // ignore
          }
        }
        console.error(`[YooKassa Webhook] Failed to acquire lock for payment ${gId}:`, lockError);
        return NextResponse.json({ error: 'Concurrent processing lock timeout' }, { status: 429 });
      }
    }

    if (rawBody.event === 'payment.succeeded' && rawBody.object) {
      const gId = rawBody.object.id;
      if (typeof gId !== 'string' || gId.trim().length === 0) {
        console.error('[YooKassa Webhook] Missing or invalid gatewayId');
        return NextResponse.json({ error: 'Invalid gatewayId' }, { status: 400 });
      }

      const currency = String(rawBody.object.amount?.currency || '').toUpperCase();
      if (currency !== 'RUB') {
        console.error(`[YooKassa Webhook] Invalid currency: ${currency}`);
        return NextResponse.json({ error: 'Invalid currency' }, { status: 400 });
      }

      let amountCents: bigint;
      try {
        amountCents = rubToKopecks(rawBody.object.amount?.value);
      } catch {
        console.error('[YooKassa Webhook] Failed to parse amount via rubToKopecks');
        return NextResponse.json({ error: 'Invalid amount format' }, { status: 400 });
      }
      
      const userId = rawBody.object.metadata?.userId;
      const paymentInternalId = rawBody.object.metadata?.paymentId;
      const metadataType = typeof rawBody.object.metadata?.type === "string" ? rawBody.object.metadata.type : undefined;

      const receiptId = rawBody.object.receipt_registration === 'succeeded' 
        ? `yookassa_receipt_${gId}` 
        : undefined;

      if (!userId) {
        return NextResponse.json({ error: 'Missing userId in metadata' }, { status: 400 });
      }

      try {
        const result = await MutexManager.withLock(`webhook_payment_${gId}`, 15000, 10000, async () => {
          let existingPayment = null;
          if (paymentInternalId) {
            existingPayment = await db.payment.findUnique({ where: { id: paymentInternalId } });
          }
          if (!existingPayment && gId) {
            existingPayment = await db.payment.findUnique({ where: { gatewayId: gId } });
          }
          if (existingPayment && existingPayment.status === 'SUCCEEDED') {
            console.info(`[YooKassa Webhook] Payment ${existingPayment.id} already processed (idempotency hit)`);
            return NextResponse.json({ success: true, status: 'Payment processed strictly (idempotent)' }, { status: 200 });
          }

          const rawMetadata = rawBody.object?.metadata;
          const paymentMetadata = (rawMetadata && typeof rawMetadata === 'object') ? rawMetadata as Record<string, unknown> : undefined;
          const success = await paymentService.confirmPayment(
            gId, amountCents, userId, isTestMode, 'yookassa', paymentInternalId, metadataType, receiptId, paymentMetadata
          );

          if (success) {
            return NextResponse.json({ success: true, status: 'Payment processed strictly' }, { status: 200 });
          } else {
            // INV-GW-04: a transient verification failure must not be swallowed by the anti-replay key;
            // release it so gateway retries are re-processed (DB idempotency guarantees a single credit).
            if (replayKey) {
              const { redis } = await import('@/lib/redis');
              await redis.del(replayKey).catch(() => {});
            }
            return NextResponse.json({ error: 'Payment double-check validation failed' }, { status: 400 });
          }
        });
        
        return result;
      } catch (lockError) {
        if (replayKey) {
          try {
            const { redis } = await import('@/lib/redis');
            await redis.del(replayKey).catch(() => {});
          } catch {
            // ignore
          }
        }
        console.error(`[YooKassa Webhook] Failed to acquire lock for payment ${gId}:`, lockError);
        return NextResponse.json({ error: 'Concurrent processing lock timeout' }, { status: 429 });
      }
    }

    return NextResponse.json({ status: 'Ignored unsupported event' }, { status: 200 });
    });
  } catch (error: unknown) {
    console.error('Webhook error:', (error instanceof Error ? error.message : String(error)));
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
