import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SettingsProvider } from '@/lib/settings';
import { getDatasourceUrl } from '@/lib/db';
import { db } from '@/lib/db';

describe('L1 In-Memory Settings Cache & DB Pool Sizing (P0 Load Optimization)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    SettingsProvider.clearMemoryCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    SettingsProvider.clearMemoryCache();
  });

  it('DATABASE_POOL_SIZE defaults to 50 when DATABASE_POOL_SIZE is unset and APP_ROLE is not worker', () => {
    delete process.env.DATABASE_URL_TEST;
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/smmplan?schema=public';
    delete process.env.DATABASE_POOL_SIZE;
    delete process.env.APP_ROLE;

    const url = getDatasourceUrl();
    expect(url).toBeDefined();
    expect(url).toContain('connection_limit=50');
    expect(url).toContain('pool_timeout=10');
  });

  it('DATABASE_POOL_SIZE uses explicit value when set', () => {
    delete process.env.DATABASE_URL_TEST;
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/smmplan?schema=public';
    process.env.DATABASE_POOL_SIZE = '75';
    delete process.env.APP_ROLE;

    const url = getDatasourceUrl();
    expect(url).toBeDefined();
    expect(url).toContain('connection_limit=75');
  });

  it('serves settings from L1 in-memory cache in production runtime without re-querying DB', async () => {
    // Simulate production runtime where isTestEnvironment() returns false
    const isTestSpy = vi.spyOn(SettingsProvider, 'isTestEnvironment').mockReturnValue(false);

    const mockSettings = {
      id: 'smmplan',
      taxRate: 6.0,
      opexMonthly: 0,
      maintenanceMode: false,
      isTestMode: false,
      siteName: 'SMMplan Production',
      siteDescription: 'Real-time SMM',
      exchangeRateUSD: 95.0,
    } as any;

    const getCachedSpy = vi.spyOn(SettingsProvider, 'getCached').mockResolvedValue(mockSettings);
    const tenantFindSpy = vi.spyOn(db.tenant, 'findUnique').mockResolvedValue({ id: 'smmplan', slug: 'smmplan' } as any);

    // Call 1: Misses L1, fetches from getCached and caches in L1
    const res1 = await SettingsProvider.get('smmplan');
    expect(res1.siteName).toBe('SMMplan Production');
    expect(getCachedSpy).toHaveBeenCalledTimes(1);
    expect(tenantFindSpy).toHaveBeenCalledTimes(1);

    // Call 2: Must be served from L1 fast-path (0 getCached calls, 0 DB calls)
    const res2 = await SettingsProvider.get('smmplan');
    expect(res2.siteName).toBe('SMMplan Production');
    expect(getCachedSpy).toHaveBeenCalledTimes(1); // Unchanged!
    expect(tenantFindSpy).toHaveBeenCalledTimes(1); // Unchanged!

    // Clear L1 memory cache
    SettingsProvider.clearMemoryCache('smmplan');

    // Call 3: Must be a miss again
    const res3 = await SettingsProvider.get('smmplan');
    expect(res3.siteName).toBe('SMMplan Production');
    expect(getCachedSpy).toHaveBeenCalledTimes(2);

    isTestSpy.mockRestore();
  });

  it('invalidates L1 cache on settings mutations (setExchangeRateUSD, setMaintenanceMode, setRefillModuleEnabled)', async () => {
    const isTestSpy = vi.spyOn(SettingsProvider, 'isTestEnvironment').mockReturnValue(false);

    const mockSettings = {
      id: 'smmplan',
      taxRate: 6.0,
      opexMonthly: 0,
      maintenanceMode: false,
      isTestMode: false,
      siteName: 'SMMplan Production',
      exchangeRateUSD: 95.0,
    } as any;

    const getCachedSpy = vi.spyOn(SettingsProvider, 'getCached').mockResolvedValue(mockSettings);
    vi.spyOn(db.tenant, 'findUnique').mockResolvedValue({ id: 'smmplan', slug: 'smmplan' } as any);
    vi.spyOn(db.systemSettings, 'upsert').mockResolvedValue(mockSettings);

    // Warm L1 cache
    await SettingsProvider.get('smmplan');
    expect(getCachedSpy).toHaveBeenCalledTimes(1);

    // Hit L1 cache
    await SettingsProvider.get('smmplan');
    expect(getCachedSpy).toHaveBeenCalledTimes(1);

    // Mutate exchange rate
    await SettingsProvider.setExchangeRateUSD(98.5, 'smmplan');

    // Next get must miss L1 and call getCached
    await SettingsProvider.get('smmplan');
    expect(getCachedSpy).toHaveBeenCalledTimes(2);

    // Mutate maintenance mode
    await SettingsProvider.setMaintenanceMode(true, 'smmplan');

    // Next get must miss L1 again
    await SettingsProvider.get('smmplan');
    expect(getCachedSpy).toHaveBeenCalledTimes(3);

    // Mutate refill module
    await SettingsProvider.setRefillModuleEnabled(false, 'smmplan');

    // Next get must miss L1 again
    await SettingsProvider.get('smmplan');
    expect(getCachedSpy).toHaveBeenCalledTimes(4);

    isTestSpy.mockRestore();
  });
});

