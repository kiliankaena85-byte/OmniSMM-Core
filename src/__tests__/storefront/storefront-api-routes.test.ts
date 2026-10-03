import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getConfigRoute } from '@/app/api/storefront/v1/config/route';
import { GET as getCatalogRoute } from '@/app/api/storefront/v1/catalog/route';
import { POST as postOrdersRoute } from '@/app/api/storefront/v1/orders/route';
import { GET as getOrderByIdRoute } from '@/app/api/storefront/v1/orders/[id]/route';
import { resolveStorefrontContext } from '@/lib/storefront/storefront-auth';
import { RateLimitService } from '@/services/core/rate-limit.service';
import { db } from '@/lib/db';
import { getServicesByCategoryAction } from '@/actions/order/catalog';
import { checkoutAction } from '@/actions/order/checkout';

// Mock dependencies
vi.mock('@/lib/storefront/storefront-auth', () => ({
  resolveStorefrontContext: vi.fn(),
}));

vi.mock('@/services/core/rate-limit.service', () => {
  const checkCustomKeyDetail = vi.fn();
  const checkDualTierRateLimit = vi.fn(async (opts) => {
    const detail = await checkCustomKeyDetail(opts.endpoint, opts.ipLimit, 60);
    return {
      allowed: detail?.allowed ?? true,
      blockedBy: detail?.allowed === false ? (detail.blockedBy || 'IP') : 'NONE',
      limit: detail?.limit ?? opts.ipLimit,
      remaining: detail?.remaining ?? 0,
      resetSeconds: detail?.resetSeconds ?? 60,
    };
  });
  return {
    RateLimitService: {
      checkCustomKeyDetail,
      checkDualTierRateLimit,
    },
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    systemSettings: {
      findUnique: vi.fn(),
    },
    category: {
      findMany: vi.fn(),
    },
    service: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    order: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/tenant-context', () => ({
  runWithTenant: vi.fn(async (_slug, fn) => fn()),
}));

vi.mock('@/actions/order/catalog', () => ({
  getServicesByCategoryAction: vi.fn(),
}));

vi.mock('@/actions/order/checkout', () => ({
  checkoutAction: vi.fn(),
}));

describe('Storefront API v1 Routes Suite', () => {
  const mockSecretCtx = {
    tenantId: 'tenant_test_1',
    tenantSlug: 'test-slug',
    tenantName: 'Test Tenant',
    keyType: 'secret' as const,
    rateLimit: 120,
  };

  const mockPublicCtx = {
    tenantId: 'tenant_test_1',
    tenantSlug: 'test-slug',
    tenantName: 'Test Tenant',
    keyType: 'publishable' as const,
    rateLimit: 60,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Rate Limiting enforcement across all 4 routes', () => {
    const rateLimitBlocked = {
      allowed: false,
      limit: 60,
      remaining: 0,
      resetSeconds: 45,
    };

    it('GET /config returns 429 when rate limit is exceeded', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockPublicCtx);
      vi.mocked(RateLimitService.checkCustomKeyDetail).mockResolvedValueOnce(rateLimitBlocked);

      const req = new NextRequest('http://localhost/api/storefront/v1/config', {
        headers: { 'x-storefront-key': 'pk_live_123' },
      });

      const res = await getConfigRoute(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Too Many Requests');
      expect(res.headers.get('RateLimit-Remaining')).toBe('0');
      expect(res.headers.get('RateLimit-Reset')).toBe('45');
    });

    it('GET /catalog returns 429 when rate limit is exceeded', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockPublicCtx);
      vi.mocked(RateLimitService.checkCustomKeyDetail).mockResolvedValueOnce(rateLimitBlocked);

      const req = new NextRequest('http://localhost/api/storefront/v1/catalog', {
        headers: { 'x-storefront-key': 'pk_live_123' },
      });

      const res = await getCatalogRoute(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Too Many Requests');
    });

    it('POST /orders returns 429 when rate limit is exceeded', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockSecretCtx);
      vi.mocked(RateLimitService.checkCustomKeyDetail).mockResolvedValueOnce(rateLimitBlocked);

      const req = new NextRequest('http://localhost/api/storefront/v1/orders', {
        method: 'POST',
        headers: { 'x-storefront-key': 'sk_live_123' },
        body: JSON.stringify({ serviceId: 'srv_1' }),
      });

      const res = await postOrdersRoute(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Too Many Requests');
    });

    it('GET /orders/[id] returns 429 when rate limit is exceeded', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockSecretCtx);
      vi.mocked(RateLimitService.checkCustomKeyDetail).mockResolvedValueOnce(rateLimitBlocked);

      const req = new NextRequest('http://localhost/api/storefront/v1/orders/12345', {
        headers: { 'x-storefront-key': 'sk_live_123' },
      });

      const res = await getOrderByIdRoute(req, { params: Promise.resolve({ id: '12345' }) });
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Too Many Requests');
    });

    it('GET /catalog returns 429 with TENANT_CAPACITY_EXCEEDED when tenant bulkhead is exhausted', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockPublicCtx);
      vi.mocked(RateLimitService.checkDualTierRateLimit).mockResolvedValueOnce({
        allowed: false,
        blockedBy: 'TENANT_BULKHEAD',
        limit: 600,
        remaining: 0,
        resetSeconds: 30,
      });

      const req = new NextRequest('http://localhost/api/storefront/v1/catalog', {
        headers: { 'x-storefront-key': 'pk_live_123' },
      });

      const res = await getCatalogRoute(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('TENANT_CAPACITY_EXCEEDED');
      expect(data.error).toContain('Bulkhead Protection');
      expect(res.headers.get('Retry-After')).toBe('30');
    });

    it('POST /orders returns 429 with TENANT_CAPACITY_EXCEEDED when tenant order capacity is exhausted', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockSecretCtx);
      vi.mocked(RateLimitService.checkDualTierRateLimit).mockResolvedValueOnce({
        allowed: false,
        blockedBy: 'TENANT_BULKHEAD',
        limit: 180,
        remaining: 0,
        resetSeconds: 20,
      });

      const req = new NextRequest('http://localhost/api/storefront/v1/orders', {
        method: 'POST',
        headers: { 'x-storefront-key': 'sk_live_123' },
        body: JSON.stringify({ serviceId: 'srv_1' }),
      });

      const res = await postOrdersRoute(req);
      expect(res.status).toBe(429);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.code).toBe('TENANT_CAPACITY_EXCEEDED');
      expect(res.headers.get('Retry-After')).toBe('20');
    });
  });

  describe('2. Secret Key Guard on POST /orders', () => {
    it('rejects order creation with publishable key (403 Forbidden)', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockPublicCtx);

      const req = new NextRequest('http://localhost/api/storefront/v1/orders', {
        method: 'POST',
        headers: {
          'x-storefront-key': 'pk_live_some_publishable_key',
          'host': 'smmplan.pro', // Even with host header present, must reject
        },
        body: JSON.stringify({
          serviceId: 'srv_1',
          link: 'https://t.me/test_channel',
          quantity: 100,
          email: 'test@example.com',
        }),
      });

      const res = await postOrdersRoute(req);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Forbidden: Secret key required for orders');
      expect(checkoutAction).not.toHaveBeenCalled();
    });
  });

  describe('3. Order Creation via Secret Key and totalRub return', () => {
    it('creates order with secret key, preserves tenantId, and returns correct totalRub', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockSecretCtx);
      vi.mocked(RateLimitService.checkCustomKeyDetail).mockResolvedValueOnce({
        allowed: true,
        limit: 30,
        remaining: 29,
        resetSeconds: 60,
      });

      vi.mocked(checkoutAction).mockResolvedValueOnce({
        success: true,
        data: {
          orderId: 'cly_order_999',
          numericId: 77889,
          totalKopecks: 25050, // 250.50 RUB
          paymentUrl: 'https://payment.gateway.com/pay/123',
        },
      } as any);

      vi.mocked(db.service.findUnique).mockResolvedValueOnce({
        name: 'Telegram Real Followers',
      } as any);
      vi.mocked(db.service.findFirst).mockResolvedValueOnce({
        name: 'Telegram Real Followers',
      } as any);

      const req = new NextRequest('http://localhost/api/storefront/v1/orders', {
        method: 'POST',
        headers: {
          'x-storefront-key': 'sk_live_secret_key_123',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          serviceId: 'srv_tg_101',
          link: 'https://t.me/crypto_channel',
          quantity: 500,
          email: 'investor_customer@example.com',
          promoCode: 'SALE10',
          idempotencyKey: 'idemp_key_12345',
        }),
      });

      const res = await postOrdersRoute(req);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.orderId).toBe('cly_order_999');
      expect(body.data.numericId).toBe(77889);
      expect(body.data.totalRub).toBe(250.5); // 25050 kopecks / 100
      expect(body.data.paymentRequired).toBe(true);
      expect(body.data.paymentUrl).toBe('https://payment.gateway.com/pay/123');

      // Verify tenantId was forwarded to checkoutAction
      expect(checkoutAction).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceId: 'srv_tg_101',
          tenantId: 'tenant_test_1',
          email: 'investor_customer@example.com',
        })
      );
    });

    it('returns 400 with structured fieldErrors when invalid payload is sent to POST /orders', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockSecretCtx);
      vi.mocked(RateLimitService.checkCustomKeyDetail).mockResolvedValueOnce({
        allowed: true,
        limit: 30,
        remaining: 29,
        resetSeconds: 60,
      });

      const req = new NextRequest('http://localhost/api/storefront/v1/orders', {
        method: 'POST',
        headers: {
          'x-storefront-key': 'sk_live_secret_key_123',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          serviceId: '', // invalid empty
          link: '', // invalid empty
          quantity: -5, // invalid negative
          email: 'not-an-email',
        }),
      });

      const res = await postOrdersRoute(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.fieldErrors).toBeDefined();
      expect(body.fieldErrors.serviceId).toBeDefined();
      expect(body.fieldErrors.link).toBeDefined();
      expect(body.fieldErrors.quantity).toBeDefined();
      expect(body.fieldErrors.email).toBeDefined();
      expect(checkoutAction).not.toHaveBeenCalled();
    });
  });

  describe('4. Order Lookup by numericId vs id in GET /orders/[id]', () => {
    it('performs search by numericId when parameter contains only digits', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockSecretCtx);
      vi.mocked(RateLimitService.checkCustomKeyDetail).mockResolvedValueOnce({
        allowed: true,
        limit: 120,
        remaining: 119,
        resetSeconds: 60,
      });

      const mockOrder = {
        id: 'cly_internal_id',
        numericId: 14022,
        status: 'IN_PROGRESS',
        link: 'https://t.me/channel',
        quantity: 1000,
        remains: 250,
        startCount: 100,
        createdAt: new Date('2026-09-17T12:00:00Z'),
        updatedAt: new Date('2026-09-17T12:05:00Z'),
        service: { name: 'Telegram Subscribers' },
        user: { email: 'customer@domain.com' },
      };

      vi.mocked(db.order.findFirst).mockResolvedValueOnce(mockOrder as any);

      const req = new NextRequest('http://localhost/api/storefront/v1/orders/14022', {
        headers: { 'x-storefront-key': 'sk_live_123' },
      });

      const res = await getOrderByIdRoute(req, { params: Promise.resolve({ id: '14022' }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.numericId).toBe(14022);
      expect(body.data.orderId).toBe('cly_internal_id');

      expect(db.order.findFirst).toHaveBeenCalledWith({
        where: { numericId: 14022, tenantId: 'tenant_test_1' },
        include: { service: true, user: true },
      });
    });

    it('performs search by id when parameter is alphanumeric CUID', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockSecretCtx);
      vi.mocked(RateLimitService.checkCustomKeyDetail).mockResolvedValueOnce({
        allowed: true,
        limit: 120,
        remaining: 119,
        resetSeconds: 60,
      });

      const mockOrder = {
        id: 'cly1234567890abcdef',
        numericId: 9911,
        status: 'COMPLETED',
        link: 'https://vk.com/post1',
        quantity: 50,
        remains: 0,
        startCount: 10,
        createdAt: new Date('2026-09-17T10:00:00Z'),
        updatedAt: new Date('2026-09-17T10:10:00Z'),
        service: { name: 'VK Likes' },
        user: { email: 'user@test.ru' },
      };

      vi.mocked(db.order.findFirst).mockResolvedValueOnce(mockOrder as any);

      const req = new NextRequest('http://localhost/api/storefront/v1/orders/cly1234567890abcdef', {
        headers: { 'x-storefront-key': 'sk_live_123' },
      });

      const res = await getOrderByIdRoute(req, { params: Promise.resolve({ id: 'cly1234567890abcdef' }) });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.orderId).toBe('cly1234567890abcdef');

      expect(db.order.findFirst).toHaveBeenCalledWith({
        where: { id: 'cly1234567890abcdef', tenantId: 'tenant_test_1' },
        include: { service: true, user: true },
      });
    });

    it('requires matching email when querying via publishable key', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockPublicCtx);
      vi.mocked(RateLimitService.checkCustomKeyDetail).mockResolvedValueOnce({
        allowed: true,
        limit: 60,
        remaining: 59,
        resetSeconds: 60,
      });

      const mockOrder = {
        id: 'ord_pub_1',
        numericId: 555,
        status: 'PENDING',
        link: 'https://t.me/chan',
        quantity: 100,
        remains: 100,
        startCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        service: { name: 'TG Subs' },
        user: { email: 'realowner@example.com' },
      };

      vi.mocked(db.order.findFirst).mockResolvedValueOnce(mockOrder as any);

      const req = new NextRequest('http://localhost/api/storefront/v1/orders/555?email=hacker@wrong.com', {
        headers: { 'x-storefront-key': 'pk_live_123' },
      });

      const res = await getOrderByIdRoute(req, { params: Promise.resolve({ id: '555' }) });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Order not found');
    });
  });

  describe('5. RULE 4.1 TargetType Mapping in GET /catalog', () => {
    it('resolves semantic targetType for channel services defaulting to POST in DB', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockPublicCtx);
      vi.mocked(RateLimitService.checkCustomKeyDetail).mockResolvedValueOnce({
        allowed: true,
        limit: 60,
        remaining: 59,
        resetSeconds: 60,
      });

      vi.mocked(db.category.findMany).mockResolvedValueOnce([
        {
          id: 'cat_tg',
          name: 'Telegram',
          slug: 'telegram',
          icon: 'telegram',
          sort: 1,
          network: { name: 'TELEGRAM', icon: 'tg' },
        },
      ] as any);

      // Service has legacy/default DB targetType 'POST', but name clearly says "Подписчики в канал"
      const services = [
        {
          id: 'srv_sub_channel',
          name: 'Живые подписчики в канал РФ',
          description: 'Качественные подписчики',
          minQty: 100,
          maxQty: 10000,
          pricePerUnitRub: 0.5,
          pricePer1kRub: 500,
          isDripFeedEnabled: true,
          targetType: 'POST', // Default in schema
          speed: 'Быстро',
          startTime: '0-1 ч',
          qualityLabel: 'HQ',
          warrantyDays: 30,
          badge: 'HOT',
        },
        {
          id: 'srv_post_likes',
          name: 'Лайки на публикацию',
          description: 'Быстрые лайки',
          minQty: 50,
          maxQty: 5000,
          pricePerUnitRub: 0.1,
          pricePer1kRub: 100,
          isDripFeedEnabled: false,
          targetType: 'POST',
          speed: 'Мгновенно',
          startTime: '5 мин',
          qualityLabel: 'Standard',
          warrantyDays: 0,
          badge: null,
        },
      ];

      vi.mocked(getServicesByCategoryAction).mockResolvedValueOnce(services as any);

      // 1. Without targetType filter -> both returned with resolved targetType
      const req = new NextRequest('http://localhost/api/storefront/v1/catalog', {
        headers: { 'x-storefront-key': 'pk_live_123' },
      });

      const res = await getCatalogRoute(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.categories).toHaveLength(1);
      const catServices = body.data.categories[0].services;
      expect(catServices).toHaveLength(2);

      // Verify resolveServiceTargetType was applied in DTO
      const channelService = catServices.find((s: any) => s.id === 'srv_sub_channel');
      expect(channelService.targetType).toBe('CHANNEL');

      const postService = catServices.find((s: any) => s.id === 'srv_post_likes');
      expect(postService.targetType).toBe('POST');
    });

    it('filters services using resolveServiceTargetType when filterTargetType param is present', async () => {
      vi.mocked(resolveStorefrontContext).mockResolvedValueOnce(mockPublicCtx);
      vi.mocked(RateLimitService.checkCustomKeyDetail).mockResolvedValueOnce({
        allowed: true,
        limit: 60,
        remaining: 59,
        resetSeconds: 60,
      });

      vi.mocked(db.category.findMany).mockResolvedValueOnce([
        {
          id: 'cat_tg',
          name: 'Telegram',
          slug: 'telegram',
          icon: 'telegram',
          sort: 1,
          network: { name: 'TELEGRAM', icon: 'tg' },
        },
      ] as any);

      const services = [
        {
          id: 'srv_sub_channel',
          name: 'Живые подписчики в канал РФ',
          description: 'Качественные подписчики',
          minQty: 100,
          maxQty: 10000,
          pricePerUnitRub: 0.5,
          pricePer1kRub: 500,
          isDripFeedEnabled: true,
          targetType: 'POST', // In DB it is POST, but semantically CHANNEL
        },
        {
          id: 'srv_post_likes',
          name: 'Лайки на публикацию',
          description: 'Быстрые лайки',
          minQty: 50,
          maxQty: 5000,
          pricePerUnitRub: 0.1,
          pricePer1kRub: 100,
          isDripFeedEnabled: false,
          targetType: 'POST',
        },
      ];

      vi.mocked(getServicesByCategoryAction).mockResolvedValueOnce(services as any);

      // Query specifically for targetType=CHANNEL
      const req = new NextRequest('http://localhost/api/storefront/v1/catalog?targetType=CHANNEL', {
        headers: { 'x-storefront-key': 'pk_live_123' },
      });

      const res = await getCatalogRoute(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      const catServices = body.data.categories[0].services;
      // Only the channel service should match
      expect(catServices).toHaveLength(1);
      expect(catServices[0].id).toBe('srv_sub_channel');
      expect(catServices[0].targetType).toBe('CHANNEL');
    });
  });
});
