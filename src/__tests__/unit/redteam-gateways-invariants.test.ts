/**
 * SPEC-REDTEAM-GATEWAYS-2026 — External gateways & queues invariants (pure unit, mocks only).
 * INV-GW-01 IP allowlist · INV-GW-02/03 mandatory YooKassa re-verification · INV-GW-04 replay-key release
 * INV-GW-05 ambiguous provider errors never cascade.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => ({
  clientIp: '185.71.76.5',
  isTestMode: false,
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  confirmPayment: vi.fn(),
  paymentFindUnique: vi.fn(),
  paymentFindFirst: vi.fn(),
  orderUpdate: vi.fn(),
  runSerializableTransaction: vi.fn(),
  proxiedFetch: vi.fn(),
  getWorkerProviderInstance: vi.fn(),
  redisConnDel: vi.fn(),
  redisConnSet: vi.fn(),
  allRoutesFailed: vi.fn(),
}));

vi.mock('@/utils/ip', () => ({ getClientIp: vi.fn(async () => h.clientIp) }));
vi.mock('@/lib/settings', () => ({
  SettingsProvider: { isTestMode: vi.fn(async () => h.isTestMode) },
  SettingsManager: {
    isTestMode: vi.fn(async () => h.isTestMode),
    getPaymentSecrets: vi.fn(async () => ({ yookassaShopId: 'shop', yookassaSecretKey: 'key', yookassaWebhookSecret: undefined })),
  },
}));
vi.mock('@/lib/redis', () => ({ redis: { set: h.redisSet, del: h.redisDel } }));
vi.mock('@/lib/redis-lock', () => ({
  MutexManager: { withLock: vi.fn(async (_k: string, _t: number, _w: number, fn: () => unknown) => fn()) },
}));
vi.mock('@/services/security/security-alert.service', () => ({ SecurityAlertService: { record: vi.fn(async () => undefined) } }));
vi.mock('@/lib/tenant-context', () => ({
  runWithTenant: vi.fn(async (_t: string, fn: () => unknown) => fn()),
  runWithTenantBypass: vi.fn(async (_r: string, fn: () => unknown) => fn()),
}));
vi.mock('@/lib/tenant-resolver-edge', () => ({ sanitizeTenantSlug: (s: string) => s }));
vi.mock('@/lib/db', () => ({
  db: {
    payment: { findUnique: h.paymentFindUnique, findFirst: h.paymentFindFirst },
    order: { update: h.orderUpdate },
  },
}));
vi.mock('@/lib/transactions', () => ({ runSerializableTransaction: h.runSerializableTransaction }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/smtp', () => ({ sendOrderPaidMail: vi.fn() }));
vi.mock('@/services/marketing-utils', () => ({ logPromoCodeUsageIfNeeded: vi.fn() }));
vi.mock('@/services/users/promo-automation.service', () => ({ PromoAutomationService: {} }));
vi.mock('@/services/financial/wallet-ops', () => ({ WalletOps: {} }));
vi.mock('@/lib/circuit-breaker', () => ({
  CircuitBreaker: { check: vi.fn(async () => undefined), recordFailure: vi.fn(async () => undefined), recordSuccess: vi.fn(async () => undefined) },
}));
vi.mock('@/utils/ssrf-guard', () => ({ assertSafeUrl: vi.fn(async () => undefined) }));
vi.mock('@/lib/http/proxy-fetch', () => ({ proxiedFetch: h.proxiedFetch }));
vi.mock('@/lib/queue-manager', () => ({ getRedisConnection: () => ({ del: h.redisConnDel, set: h.redisConnSet }) }));
vi.mock('@/services/providers/provider.service', () => ({ providerService: { getWorkerProviderInstance: h.getWorkerProviderInstance } }));
vi.mock('@/services/providers/smart-routing.service', () => ({ SmartRoutingService: { recordFailoverEvent: vi.fn(async () => undefined) } }));
vi.mock('@/workers/processors/order/order-route-evaluator', () => ({
  OrderRouteEvaluator: { verifyRouteCapabilitiesAndMargin: vi.fn(async () => ({ isCompatible: true })) },
}));
vi.mock('@/workers/processors/order/order-all-routes-failed-handler', () => ({
  OrderAllRoutesFailedHandler: new Proxy({}, { get: () => h.allRoutesFailed }),
}));
vi.mock('@/services/providers/adaptive-rate-limiter.service', () => ({ AdaptiveRateLimiterService: { acquireToken: vi.fn(async () => undefined) } }));
vi.mock('@/lib/notifications', () => ({ sendAdminAlert: vi.fn() }));

import { isYooKassaIp } from '@/lib/security/yookassa-ip';
import { handleYooKassaWebhookRequest } from '@/services/financial/yookassa-webhook.handler';
import { UniversalProvider, ProviderAmbiguousError } from '@/services/providers/universal.provider';
import { OrderDispatchExecutor } from '@/workers/processors/order/order-dispatch-executor';

beforeEach(() => {
  vi.clearAllMocks();
  h.getWorkerProviderInstance.mockReset();
  h.proxiedFetch.mockReset();
  h.clientIp = '185.71.76.5';
  h.isTestMode = false;
  h.redisSet.mockResolvedValue('OK');
  h.redisDel.mockResolvedValue(1);
  h.redisConnDel.mockResolvedValue(1);
  h.redisConnSet.mockResolvedValue('OK');
  h.paymentFindFirst.mockResolvedValue({ tenantId: 'smmplan' });
  h.paymentFindUnique.mockResolvedValue(null);
  h.orderUpdate.mockResolvedValue({});
  h.runSerializableTransaction.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
describe('INV-GW-01: YooKassa official CIDR allowlist', () => {
  it.each(['185.71.76.5', '185.71.77.31', '77.75.153.100', '77.75.154.200', '77.75.156.11', '77.75.156.35', '2a02:5180::1'])(
    'accepts official YooKassa IP %s', (ip) => {
      expect(isYooKassaIp(ip)).toBe(true);
    });

  it.each(['185.75.120.1', '37.110.12.5', '193.106.92.1', '91.232.108.1', '127.0.0.1', '::1', '8.8.8.8', '185.71.76.32', '77.75.156.12', 'garbage', ''])(
    'rejects non-YooKassa IP %s', (ip) => {
      expect(isYooKassaIp(ip)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
function webhookReq(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/webhooks/yookassa', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const succeededBody = {
  event: 'payment.succeeded',
  object: {
    id: '2f1a-real-gateway-id',
    status: 'succeeded',
    amount: { value: '1000.00', currency: 'RUB' },
    metadata: { paymentId: 'pay_1', userId: 'user_1' },
  },
};

describe('Webhook handler gate (INV-GW-01 / INV-GW-04)', () => {
  it('rejects spoof-able loopback IP with 403 (no isLocal bypass)', async () => {
    h.clientIp = '127.0.0.1';
    const res = await handleYooKassaWebhookRequest(webhookReq(succeededBody));
    expect(res.status).toBe(403);
    expect(h.confirmPayment).not.toHaveBeenCalled();
  });

  it('test mode does NOT disable the IP filter', async () => {
    h.isTestMode = true;
    h.clientIp = '8.8.8.8';
    const res = await handleYooKassaWebhookRequest(webhookReq(succeededBody));
    expect(res.status).toBe(403);
  });

  it('official IP passes the gate and reaches confirmPayment', async () => {
    const { paymentService } = await import('@/services/financial/payment.service');
    const spy = vi.spyOn(paymentService, 'confirmPayment').mockResolvedValue(true);
    const res = await handleYooKassaWebhookRequest(webhookReq(succeededBody));
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('releases the anti-replay key when confirmPayment returns false', async () => {
    const { paymentService } = await import('@/services/financial/payment.service');
    vi.spyOn(paymentService, 'confirmPayment').mockResolvedValue(false);
    const res = await handleYooKassaWebhookRequest(webhookReq(succeededBody));
    expect(res.status).toBe(400);
    const replayKey = h.redisSet.mock.calls[0][0] as string;
    expect(replayKey).toMatch(/^webhook:yoo:event:/);
    expect(h.redisDel).toHaveBeenCalledWith(replayKey);
  });
});

// ---------------------------------------------------------------------------
describe('INV-GW-02/03: mandatory YooKassa API re-verification in production', () => {
  async function confirm(gatewayId: string, internalPaymentId = 'pay_1', sandboxFlag = false) {
    const { paymentService } = await import('@/services/financial/payment.service');
    return paymentService.confirmPayment(gatewayId, 100000n, 'user_1', sandboxFlag, 'yookassa', internalPaymentId);
  }

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
  });

  it('mock_ prefix with NULL DB gatewayId does not skip verification', async () => {
    h.paymentFindUnique.mockResolvedValue({ tenantId: 'smmplan', gatewayId: null });
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await confirm('mock_forged');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ok).toBe(false);
    expect(h.runSerializableTransaction).not.toHaveBeenCalled();
  });

  it('caller-supplied sandbox flag is ignored when tenant is not in test mode', async () => {
    h.paymentFindUnique.mockResolvedValue({ tenantId: 'smmplan', gatewayId: 'real-id' });
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await confirm('real-id', 'pay_1', true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ok).toBe(false);
  });

  it('test-mode tenant: real (non-mock) gateway id is still verified', async () => {
    h.isTestMode = true;
    h.paymentFindUnique.mockResolvedValue({ tenantId: 'smmplan', gatewayId: 'real-id' });
    const fetchMock = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchMock);
    const ok = await confirm('real-id');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(ok).toBe(false);
  });

  it('test-mode tenant + server-issued mock id equal to DB value skips the remote call', async () => {
    h.isTestMode = true;
    h.paymentFindUnique.mockResolvedValue({ tenantId: 'smmplan', gatewayId: 'yoo_test_mock_123' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await confirm('yoo_test_mock_123');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.runSerializableTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects when remote metadata.paymentId does not match the internal payment', async () => {
    h.paymentFindUnique.mockResolvedValue({ tenantId: 'smmplan', gatewayId: 'real-id' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'real-id', status: 'succeeded', amount: { value: '1000.00' }, metadata: { paymentId: 'someone_else' } }),
    }));
    const ok = await confirm('real-id', 'pay_1');
    expect(ok).toBe(false);
    expect(h.runSerializableTransaction).not.toHaveBeenCalled();
  });

  it('rejects when remote id does not match the webhook gateway id', async () => {
    h.paymentFindUnique.mockResolvedValue({ tenantId: 'smmplan', gatewayId: 'real-id' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'other-id', status: 'succeeded', amount: { value: '1000.00' }, metadata: { paymentId: 'pay_1' } }),
    }));
    const ok = await confirm('real-id', 'pay_1');
    expect(ok).toBe(false);
  });

  it('verified matching payment proceeds to the atomic transaction', async () => {
    h.paymentFindUnique.mockResolvedValue({ tenantId: 'smmplan', gatewayId: 'real-id' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'real-id', status: 'succeeded', amount: { value: '1000.00' }, metadata: { paymentId: 'pay_1' } }),
    }));
    await confirm('real-id', 'pay_1');
    expect(h.runSerializableTransaction).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
describe('INV-GW-05: UniversalProvider classifies ambiguous outcomes', () => {
  const provider = () => new UniversalProvider('https://provider.example/api/v2', 'k');
  const order = () => provider().createOrder({ service: '1', link: 'https://t.me/x', quantity: 100 } as Parameters<UniversalProvider['createOrder']>[0]);

  function httpResponse(status: number, body: string) {
    return { status, ok: status >= 200 && status < 300, headers: new Headers(), text: async () => body };
  }

  it('network failure (undici TypeError "fetch failed") → ProviderAmbiguousError', async () => {
    h.proxiedFetch.mockRejectedValue(new TypeError('fetch failed'));
    await expect(order()).rejects.toBeInstanceOf(ProviderAmbiguousError);
  });

  it('HTTP 502 → ProviderAmbiguousError (message preserved)', async () => {
    h.proxiedFetch.mockResolvedValue(httpResponse(502, 'Bad Gateway'));
    const err = await order().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderAmbiguousError);
    expect((err as Error).message).toBe('Provider HTTP Error: 502');
  });

  it('HTTP 200 with HTML body → ProviderAmbiguousError', async () => {
    h.proxiedFetch.mockResolvedValue(httpResponse(200, '<html>oops</html>'));
    await expect(order()).rejects.toBeInstanceOf(ProviderAmbiguousError);
  });

  it('definitive business rejection {error} → plain Error (cascade allowed)', async () => {
    h.proxiedFetch.mockResolvedValue(httpResponse(200, JSON.stringify({ error: 'Invalid link' })));
    const err = await order().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ProviderAmbiguousError);
  });

  it('HTTP 400 with {error} → plain Error', async () => {
    h.proxiedFetch.mockResolvedValue(httpResponse(400, JSON.stringify({ error: 'Not enough funds' })));
    const err = await order().catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ProviderAmbiguousError);
  });
});

// ---------------------------------------------------------------------------
describe('INV-GW-05: dispatch executor never cascades on ambiguous errors', () => {
  const route = (id: string) => ({
    providerId: id, providerServiceId: `svc-${id}`, failoverMode: 'automatic',
    provider: { id, name: `Provider ${id}` },
  });
  const ctx = () => ({
    order: { id: 'ord_1', numericId: 1, serviceId: 's1', link: 'https://t.me/x', quantity: 100, isDripFeed: false, customData: null, service: { name: 'Подписчики' } },
    candidateRoutes: [route('A'), route('B')],
    primaryProviderId: 'A',
    redisKey: 'order:dispatched:ord_1',
  }) as unknown as Parameters<typeof OrderDispatchExecutor.executeDispatchLoop>[0];

  it.each([
    ['ProviderAmbiguousError', () => new ProviderAmbiguousError('Provider HTTP Error: 504')],
    ['undici fetch failed', () => new TypeError('fetch failed')],
  ])('%s → PENDING_CHECK, UnrecoverableError, provider B never called', async (_n, mkErr) => {
    const createA = vi.fn().mockRejectedValue(mkErr());
    const createB = vi.fn().mockResolvedValue({ order: 999 });
    h.getWorkerProviderInstance
      .mockResolvedValueOnce({ createOrder: createA })
      .mockResolvedValueOnce({ createOrder: createB });

    await expect(OrderDispatchExecutor.executeDispatchLoop(ctx())).rejects.toMatchObject({ name: 'UnrecoverableError' });
    expect(createB).not.toHaveBeenCalled();
    expect(h.orderUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_CHECK' }) }));
  });

  it('definitive rejection cascades to provider B', async () => {
    const createA = vi.fn().mockRejectedValue(new Error('Invalid link'));
    const createB = vi.fn().mockResolvedValue({ order: 999 });
    h.getWorkerProviderInstance
      .mockResolvedValueOnce({ createOrder: createA })
      .mockResolvedValueOnce({ createOrder: createB });

    await OrderDispatchExecutor.executeDispatchLoop(ctx());
    expect(createB).toHaveBeenCalledTimes(1);
    expect(h.orderUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'IN_PROGRESS', externalId: '999' }) }));
  });
});
