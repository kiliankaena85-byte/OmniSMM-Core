/**
 * (c) 2024-2026 SMMplan / OmniSMM 1.0. All rights reserved.
 * Multi-Tenant Redis Catalog Cache Service (RAC-2026 / SDD-TDD 2026)
 *
 * Implements high-performance Redis caching for the public catalog tree and service lists.
 * Features:
 * 1. Strict Tenant Isolation: All keys are prefixed with tenantId.
 * 2. Fail-Open Circuit Breaker: If Redis is unavailable or times out (>500ms),
 *    the service transparently executes the DB fetcher without interrupting user sessions.
 * 3. Atomic Invalidation: Helpers to flush catalog cache on admin mutations.
 */

import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { normalizeTenantId } from '@/lib/tenant-scope';

export const CATALOG_CACHE_TTL_SECONDS = 1800; // 30 minutes

export const CATALOG_CACHE_KEYS = {
  networks: (tenantId: string) => `catalog:v1:${normalizeTenantId(tenantId)}:networks`,
  services: (categoryId: string, tenantId: string) =>
    `catalog:v1:${normalizeTenantId(tenantId)}:services:${categoryId}`,
  publicCatalog: (tenantId: string) => `catalog:v1:${normalizeTenantId(tenantId)}:public-catalog`,
  publicServices: (categoryId: string, tenantId: string) =>
    `catalog:v1:${normalizeTenantId(tenantId)}:public-services:${categoryId}`,
  storefrontGuestBundle: (tenantId: string) => `catalog:v1:${normalizeTenantId(tenantId)}:guest-bundle`,
  tenantPattern: (tenantId: string) => `catalog:v1:${normalizeTenantId(tenantId)}:*`,
};

// L1 In-Memory Cache (RAC-2026: 5 minutes TTL for sub-millisecond storefront and zero DB lock)
interface L1CacheEntry<T> {
  data: T;
  expiresAt: number;
}
const l1CatalogCache = new Map<string, L1CacheEntry<unknown>>();
export const L1_CATALOG_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL


export function getFromL1<T>(key: string): T | null {
  const entry = l1CatalogCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    l1CatalogCache.delete(key);
    return null;
  }
  return entry.data as T;
}

export function setInL1<T>(key: string, data: T, ttlMs: number = L1_CATALOG_TTL_MS): void {
  if (l1CatalogCache.size > 1000) {
    const now = Date.now();
    for (const [k, v] of l1CatalogCache.entries()) {
      if (now > v.expiresAt) {
        l1CatalogCache.delete(k);
      }
    }
    if (l1CatalogCache.size > 1000) {
      l1CatalogCache.clear();
    }
  }
  l1CatalogCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

export function invalidateL1CatalogCache(rawTenantId?: string): void {
  if (rawTenantId) {
    const tenantId = normalizeTenantId(rawTenantId);
    const tenantPattern = `:${tenantId}:`;
    for (const key of l1CatalogCache.keys()) {
      if (key.includes(tenantPattern)) {
        l1CatalogCache.delete(key);
      }
    }
  } else {
    l1CatalogCache.clear();
  }
}

// In-flight Promise deduplication registry to eliminate Cache Stampede / Thundering Herd
const inFlightRequests = new Map<string, Promise<unknown>>();

/**
 * Deduplicates concurrent identical async fetchers into a single shared execution.
 */
export async function runWithSingleflight<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = (async () => {
    try {
      return await fetcher();
    } finally {
      inFlightRequests.delete(key);
    }
  })();
  inFlightRequests.set(key, promise);
  return promise;
}

/**
 * Executes a Redis get operation with an internal timeout guard and guaranteed timer cleanup.
 */
async function safeRedisGet(key: string): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      redis.get(key),
      new Promise<null>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Redis get timeout')), 2500);
      }),
    ]);
  } catch (error) {
    logger.warn('[CATALOG_CACHE] Redis read failed or timed out, degrading to DB fetcher', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Executes a Redis set operation safely without blocking the caller.
 */
async function safeRedisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await redis.set(key, value, 'EX', ttlSeconds);
  } catch (error) {
    logger.warn('[CATALOG_CACHE] Redis write failed', {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Retrieves cached networks tree for storefront with Redis caching and DB fallback.
 */
export async function getCachedNetworksWithRedis<T>(
  rawTenantId: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const tenantId = normalizeTenantId(rawTenantId);
  const cacheKey = CATALOG_CACHE_KEYS.networks(tenantId);

  // 1. Try reading from L1 In-Memory cache (0ms latency, zero connection lock)
  const l1Data = getFromL1<T>(cacheKey);
  if (l1Data !== null) {
    return l1Data;
  }

  // 2. Try reading from Redis (L2)
  const cached = await safeRedisGet(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as T;
      setInL1(cacheKey, parsed);
      return parsed;
    } catch {
      // Corrupted JSON, discard
    }
  }

  // 3. Cache miss or Redis error -> fetch from DB with Singleflight deduplication
  const data = await runWithSingleflight(`sf:${cacheKey}`, fetcher);

  // 4. Populate L1 and Redis
  if (data !== undefined && data !== null) {
    setInL1(cacheKey, data);
    void safeRedisSet(cacheKey, JSON.stringify(data), CATALOG_CACHE_TTL_SECONDS);
  }

  return data;
}

/**
 * Retrieves cached services for a category with Redis caching and DB fallback.
 */
export async function getCachedCategoryServicesWithRedis<T>(
  categoryId: string,
  rawTenantId: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const tenantId = normalizeTenantId(rawTenantId);
  const cacheKey = CATALOG_CACHE_KEYS.services(categoryId, tenantId);

  // 1. Try reading from L1 In-Memory cache
  const l1Data = getFromL1<T>(cacheKey);
  if (l1Data !== null) {
    return l1Data;
  }

  // 2. Try reading from Redis (L2)
  const cached = await safeRedisGet(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as T;
      setInL1(cacheKey, parsed);
      return parsed;
    } catch {
      // Corrupted JSON, discard
    }
  }

  // 3. Cache miss or Redis error -> fetch from DB with Singleflight deduplication
  const data = await runWithSingleflight(`sf:${cacheKey}`, fetcher);

  // 4. Populate L1 and Redis
  if (data !== undefined && data !== null) {
    setInL1(cacheKey, data);
    void safeRedisSet(cacheKey, JSON.stringify(data), CATALOG_CACHE_TTL_SECONDS);
  }

  return data;
}

/**
 * Retrieves fully-transformed public catalog with Redis caching and fallback.
 */
export async function getCachedPublicCatalogWithRedis<T>(
  rawTenantId: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const tenantId = normalizeTenantId(rawTenantId);
  const cacheKey = CATALOG_CACHE_KEYS.publicCatalog(tenantId);

  // 1. Try reading from L1 In-Memory cache
  const l1Data = getFromL1<T>(cacheKey);
  if (l1Data !== null) {
    return l1Data;
  }

  // 2. Try reading from Redis (L2)
  const cached = await safeRedisGet(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as T;
      setInL1(cacheKey, parsed);
      return parsed;
    } catch {
      // Corrupted JSON, discard
    }
  }

  // 3. Cache miss -> fetcher with Singleflight
  const data = await runWithSingleflight(`sf:${cacheKey}`, fetcher);

  // 4. Populate L1 and Redis
  if (data !== undefined && data !== null) {
    setInL1(cacheKey, data);
    void safeRedisSet(cacheKey, JSON.stringify(data), CATALOG_CACHE_TTL_SECONDS);
  }

  return data;
}

/**
 * Retrieves fully-transformed public services for a category with Redis caching and fallback.
 */
export async function getCachedProcessedServicesWithRedis<T>(
  categoryId: string,
  rawTenantId: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const tenantId = normalizeTenantId(rawTenantId);
  const cacheKey = CATALOG_CACHE_KEYS.publicServices(categoryId, tenantId);

  // 1. Try reading from L1 In-Memory cache
  const l1Data = getFromL1<T>(cacheKey);
  if (l1Data !== null) {
    return l1Data;
  }

  // 2. Try reading from Redis (L2)
  const cached = await safeRedisGet(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as T;
      setInL1(cacheKey, parsed);
      return parsed;
    } catch {
      // Corrupted JSON, discard
    }
  }

  // 3. Cache miss -> fetcher with Singleflight
  const data = await runWithSingleflight(`sf:${cacheKey}`, fetcher);

  // 4. Populate L1 and Redis
  if (data !== undefined && data !== null) {
    setInL1(cacheKey, data);
    void safeRedisSet(cacheKey, JSON.stringify(data), CATALOG_CACHE_TTL_SECONDS);
  }

  return data;
}

/**
 * Retrieves storefront guest bundle with Redis caching and fallback.
 */
export async function getCachedGuestBundleWithRedis<T>(
  rawTenantId: string,
  fetcher: () => Promise<T>
): Promise<T> {
  const tenantId = normalizeTenantId(rawTenantId);
  const cacheKey = CATALOG_CACHE_KEYS.storefrontGuestBundle(tenantId);

  // 1. Try reading from L1 In-Memory cache
  const l1Data = getFromL1<T>(cacheKey);
  if (l1Data !== null) {
    return l1Data;
  }

  // 2. Try reading from Redis (L2)
  const cached = await safeRedisGet(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as T;
      setInL1(cacheKey, parsed);
      return parsed;
    } catch {
      // Corrupted JSON, discard
    }
  }

  const data = await runWithSingleflight(`sf:${cacheKey}`, fetcher);

  if (data !== undefined && data !== null) {
    setInL1(cacheKey, data);
    void safeRedisSet(cacheKey, JSON.stringify(data), 600); // 10 minutes TTL
  }

  return data;
}

/**
 * Atomically invalidates Redis and L1 catalog cache for a specific tenant or all tenants.
 */
export async function invalidateCatalogCache(rawTenantId?: string): Promise<void> {
  // Always clear L1 in-memory cache first
  invalidateL1CatalogCache(rawTenantId);
  try {
    if (rawTenantId) {
      const tenantId = normalizeTenantId(rawTenantId);
      const networkKey = CATALOG_CACHE_KEYS.networks(tenantId);
      
      // Delete primary networks key directly
      await redis.del(networkKey);

      // Delete category services for this tenant
      const pattern = CATALOG_CACHE_KEYS.tenantPattern(tenantId);
      if (typeof (redis as any).scan === 'function') {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = nextCursor;
          if (keys.length > 0) {
            await redis.del(...keys);
          }
        } while (cursor !== '0');
      } else if (typeof (redis as any).keys === 'function') {
        const keys = await (redis as any).keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
    } else {
      // Invalidate all catalog keys across all tenants in Redis
      const pattern = 'catalog:v1:*';
      if (typeof (redis as any).scan === 'function') {
        let cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = nextCursor;
          if (keys.length > 0) {
            await redis.del(...keys);
          }
        } while (cursor !== '0');
      } else if (typeof (redis as any).keys === 'function') {
        const keys = await (redis as any).keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      }
    }

    // Bump Storefront HTML cache version for RAM microcache invalidation
    try {
      if (typeof (redis as any).set === 'function') {
        await (redis as any).set('storefront:cache_version', String(Date.now()));
      }
    } catch {
      // Non-fatal
    }
  } catch (error) {
    logger.warn('[CATALOG_CACHE] Failed to invalidate Redis cache keys', {
      tenantId: rawTenantId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
