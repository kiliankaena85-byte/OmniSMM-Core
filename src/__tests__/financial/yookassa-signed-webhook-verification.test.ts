import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/webhooks/yookassa/route';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';

describe('YooKassa Signed Webhook & Payment Acceptance Verification', () => {
  const WEBHOOK_SECRET = 'test_webhook_secret_for_suite';

  beforeEach(() => {
    process.env.YOOKASSA_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it('1. Successfully processes a valid signed YooKassa webhook and activates order', async () => {
    const user = await db.user.create({
      data: {
        email: `yoo_hook_test_${Date.now()}@smmplan.pro`,
        passwordHash: 'dummy_hash',
        role: 'USER',
        balance: BigInt(0),
        tenantId: 'smmplan'
      }
    });

    const payment = await db.payment.create({
      data: {
        userId: user.id,
        amount: BigInt(2500), // 25.00 RUB
        currency: 'RUB',
        status: 'PENDING',
        gateway: 'yookassa',
        gatewayId: `yoo_gw_${Date.now()}`,
        tenantId: 'smmplan'
      }
    });

    let service = await db.service.findFirst({ where: { isActive: true } });
    if (!service) {
      const category = (await db.category.findFirst()) || (await db.category.create({
        data: { name: 'Test Category', slug: `test-cat-${Date.now()}`, tenantId: 'smmplan' }
      }));
      service = await db.service.create({
        data: {
          name: 'Test Service',
          categoryId: category.id,
          rate: 0.25,
          minQty: 10,
          maxQty: 10000,
          tenantId: 'smmplan',
          isActive: true
        }
      });
    }

    const order = await db.order.create({
      data: {
        userId: user.id,
        serviceId: service.id,
        providerId: service?.providerId || null,
        providerServiceId: service?.externalId || '1',
        charge: BigInt(2500),
        providerCost: BigInt(1000),
        quantity: 100,
        link: 'https://t.me/test_verified',
        status: 'AWAITING_PAYMENT',
        paymentId: payment.id,
        tenantId: 'smmplan'
      }
    });

    const payload = {
      type: 'notification',
      event: 'payment.succeeded',
      object: {
        id: payment.gatewayId,
        status: 'succeeded',
        paid: true,
        amount: { value: '25.00', currency: 'RUB' },
        created_at: new Date().toISOString(),
        metadata: {
          paymentId: payment.id,
          userId: user.id,
          orderId: order.id,
          type: 'checkout'
        },
        receipt_registration: 'succeeded'
      }
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');

    const req = new NextRequest('http://localhost:3000/api/webhooks/yookassa', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sha256-signature': signature,
        'x-forwarded-for': '185.71.76.10' // INV-GW-01: official YooKassa range (loopback no longer accepted)
      },
      body: rawBody
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const resData = await res.json();
    expect(resData.success).toBe(true);

    const updatedPayment = await db.payment.findUnique({ where: { id: payment.id } });
    const updatedOrder = await db.order.findUnique({ where: { id: order.id } });

    expect(updatedPayment?.status).toBe('SUCCEEDED');
    expect(updatedOrder?.status).toBe('PENDING');

    // Note: LedgerEntry and User are immutable by design (Financial Audit Trail invariant)
  });

  it('2. Rejects webhook with forged/invalid HMAC signature', async () => {
    const payload = {
      type: 'notification',
      event: 'payment.succeeded',
      object: {
        id: 'fake_id',
        status: 'succeeded',
        paid: true,
        amount: { value: '100.00', currency: 'RUB' },
        metadata: { userId: 'fake_user' }
      }
    };

    const rawBody = JSON.stringify(payload);
    const invalidSignature = crypto.createHmac('sha256', 'wrong_secret').update(rawBody, 'utf8').digest('hex');

    const req = new NextRequest('http://localhost:3000/api/webhooks/yookassa', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sha256-signature': invalidSignature,
        'x-forwarded-for': '185.71.76.10' // INV-GW-01: official YooKassa range (loopback no longer accepted)
      },
      body: rawBody
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    const resData = await res.json();
    expect(resData.error).toBe('Invalid signature');
  });

  it('3. Rejects stale/replay webhooks older than 24 hours', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const payload = {
      type: 'notification',
      event: 'payment.succeeded',
      object: {
        id: 'stale_id',
        status: 'succeeded',
        paid: true,
        amount: { value: '50.00', currency: 'RUB' },
        created_at: twoDaysAgo,
        metadata: { userId: 'stale_user' }
      }
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');

    const req = new NextRequest('http://localhost:3000/api/webhooks/yookassa', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sha256-signature': signature,
        'x-forwarded-for': '185.71.76.10' // INV-GW-01: official YooKassa range (loopback no longer accepted)
      },
      body: rawBody
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const resData = await res.json();
    expect(resData.error).toBe('Stale webhook rejected');
  });
});
