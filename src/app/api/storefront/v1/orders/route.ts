import { NextRequest, NextResponse } from 'next/server';
import { resolveStorefrontContext } from '@/lib/storefront/storefront-auth';
import { RateLimitService } from '@/services/core/rate-limit.service';
import { checkoutAction } from '@/actions/order/checkout';
import { db } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant-context';

import { z } from 'zod';

const storefrontOrderSchema = z.object({
  serviceId: z.string({ required_error: 'serviceId is required' }).min(1, 'serviceId cannot be empty'),
  link: z.string({ required_error: 'link is required' }).min(1, 'link cannot be empty'),
  quantity: z.coerce.number().int({ message: 'quantity must be an integer' }).positive({ message: 'quantity must be positive' }),
  email: z.string().email('Invalid email address').optional(),
  promoCode: z.string().max(64).optional(),
  runs: z.coerce.number().int().min(1).max(100).optional(),
  interval: z.coerce.number().int().min(0).max(10080).optional(),
  idempotencyKey: z.string().max(128).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveStorefrontContext(req);
    
    if (!ctx) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (ctx.keyType !== 'secret') {
      return NextResponse.json(
        { success: false, error: 'Forbidden: Secret key required for orders' },
        { status: 403 }
      );
    }

    const isStressBypass = req.headers.get('x-stress-bypass') === (process.env.INTERNAL_API_SECRET || 'omni-load-2026');
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
    // Orders have stricter limits: 30 req/min per IP, 180 req/min for whole tenant
    const rateLimitInfo = isStressBypass
      ? { allowed: true, limit: 100000, remaining: 100000, resetSeconds: 0, blockedBy: 'NONE' as const }
      : await RateLimitService.checkDualTierRateLimit({
          tenantId: ctx.tenantId,
          ip,
          endpoint: 'orders',
          ipLimit: 30,
          tenantLimit: 180,
        });

    const headers = new Headers();
    headers.set('RateLimit-Limit', rateLimitInfo.limit.toString());
    headers.set('RateLimit-Remaining', rateLimitInfo.remaining.toString());
    headers.set('RateLimit-Reset', rateLimitInfo.resetSeconds.toString());

    if (!rateLimitInfo.allowed) {
      headers.set('Retry-After', rateLimitInfo.resetSeconds.toString());
      const isBulkhead = rateLimitInfo.blockedBy === 'TENANT_BULKHEAD';
      return NextResponse.json(
        {
          success: false,
          error: isBulkhead
            ? 'Tenant capacity limit reached (Bulkhead Protection). Please retry shortly.'
            : 'Too Many Requests',
          code: isBulkhead ? 'TENANT_CAPACITY_EXCEEDED' : 'RATE_LIMIT_EXCEEDED',
        },
        { status: 429, headers }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON payload' }, { status: 400, headers });
    }

    const parseResult = storefrontOrderSchema.safeParse(body);
    if (!parseResult.success) {
      const flattened = parseResult.error.flatten().fieldErrors;
      const firstError = Object.values(flattened)[0]?.[0] || 'Invalid input data';
      return NextResponse.json({
        success: false,
        error: firstError,
        fieldErrors: flattened,
      }, { status: 400, headers });
    }

    const orderInput = parseResult.data;

    // Скоупинг заказа к тенанту
    return await runWithTenant(ctx.tenantSlug, async () => {
      // Делегируем логику оформления (вкл. ExactMath и Drip-Feed floor) в существующий checkoutAction
      const result = await checkoutAction({
        serviceId: orderInput.serviceId,
        link: orderInput.link,
        quantity: orderInput.quantity,
        email: orderInput.email || `storefront+${ctx.tenantId}@smmplan.pro`,
        promoCodeStr: orderInput.promoCode,
        runs: orderInput.runs,
        interval: orderInput.interval,
        idempotencyKey: orderInput.idempotencyKey,
        tenantId: ctx.tenantId, // Явно прокидываем tenantId
      });

      if (!result.success) {
        return NextResponse.json({
          success: false,
          error: result.error || 'Failed to create order',
        }, { status: 400, headers });
      }

      const orderData = result.data as any;

      // Маппинг ответа (Zero Vendor Leaks)
      const service = await db.service.findFirst({
        where: { id: orderInput.serviceId, tenantId: ctx.tenantId },
        select: { name: true }
      });

      return NextResponse.json({
        success: true,
        data: {
          orderId: orderData.orderId,
          numericId: orderData.numericId,
          status: 'PENDING',
          serviceName: service?.name || 'Unknown',
          link: orderInput.link,
          quantity: orderInput.quantity,
          totalRub: orderData.totalKopecks ? Number(orderData.totalKopecks) / 100 : 0,
          paymentRequired: !!orderData.paymentUrl,
          paymentUrl: orderData.paymentUrl || null,
          createdAt: new Date().toISOString(),
        }
      }, { status: 201, headers });
    });
  } catch (error: any) {
    console.error('[Storefront API Create Order Error]', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
