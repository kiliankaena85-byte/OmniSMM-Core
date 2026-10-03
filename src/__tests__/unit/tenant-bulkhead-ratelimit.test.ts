import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitService, DualTierRateLimitResult } from '@/services/core/rate-limit.service';

describe('Dual-Tier Tenant Bulkhead Rate Limiter Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows request when both tenant bulkhead and IP are within limits', async () => {
    vi.spyOn(RateLimitService, 'checkCustomKeyDetail')
      .mockResolvedValueOnce({ allowed: true, limit: 1000, remaining: 999, resetSeconds: 60 }) // Tenant check
      .mockResolvedValueOnce({ allowed: true, limit: 100, remaining: 99, resetSeconds: 60 });   // IP check

    const res: DualTierRateLimitResult = await RateLimitService.checkDualTierRateLimit({
      tenantId: 'tenant-alpha',
      ip: '192.168.1.1',
      endpoint: 'catalog',
      ipLimit: 100,
      tenantLimit: 1000,
    });

    expect(res.allowed).toBe(true);
    expect(res.blockedBy).toBe('NONE');
    expect(res.remaining).toBe(99);
    expect(res.limit).toBe(100);
  });

  it('blocks request immediately at Tenant Bulkhead level if tenant capacity is exhausted', async () => {
    vi.spyOn(RateLimitService, 'checkCustomKeyDetail')
      .mockResolvedValueOnce({ allowed: false, limit: 1000, remaining: 0, resetSeconds: 45 }); // Tenant exceeded!

    const res = await RateLimitService.checkDualTierRateLimit({
      tenantId: 'tenant-noisy',
      ip: '10.0.0.99', // Fresh IP, but tenant is overwhelmed
      endpoint: 'catalog',
      ipLimit: 100,
      tenantLimit: 1000,
    });

    expect(res.allowed).toBe(false);
    expect(res.blockedBy).toBe('TENANT_BULKHEAD');
    expect(res.limit).toBe(1000);
    expect(res.remaining).toBe(0);
    expect(res.resetSeconds).toBe(45);
  });

  it('blocks request at IP level when tenant has capacity but IP spamming', async () => {
    vi.spyOn(RateLimitService, 'checkCustomKeyDetail')
      .mockResolvedValueOnce({ allowed: true, limit: 1000, remaining: 500, resetSeconds: 60 }) // Tenant ok
      .mockResolvedValueOnce({ allowed: false, limit: 50, remaining: 0, resetSeconds: 30 });    // IP exceeded!

    const res = await RateLimitService.checkDualTierRateLimit({
      tenantId: 'tenant-beta',
      ip: '192.168.1.55',
      endpoint: 'orders',
      ipLimit: 50,
      tenantLimit: 1000,
    });

    expect(res.allowed).toBe(false);
    expect(res.blockedBy).toBe('IP');
    expect(res.limit).toBe(50);
    expect(res.remaining).toBe(0);
    expect(res.resetSeconds).toBe(30);
  });

  it('correctly constructs isolated Redis keys for tenant bulkhead and per-tenant IP', async () => {
    const spy = vi.spyOn(RateLimitService, 'checkCustomKeyDetail')
      .mockResolvedValue({ allowed: true, limit: 500, remaining: 499, resetSeconds: 60 });

    await RateLimitService.checkDualTierRateLimit({
      tenantId: 'custom-partner',
      ip: '123.45.67.89',
      endpoint: 'orders',
      ipLimit: 30,
      tenantLimit: 300,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    // 1st call: Tenant Global Bulkhead Key
    expect(spy).toHaveBeenNthCalledWith(1, 'sf_bulkhead_tenant_custom-partner_orders', 300, 60, true);
    // 2nd call: Per-Tenant IP Key
    expect(spy).toHaveBeenNthCalledWith(2, 'sf_ratelimit_custom-partner_orders_123.45.67.89', 30, 60, true);
  });
});
