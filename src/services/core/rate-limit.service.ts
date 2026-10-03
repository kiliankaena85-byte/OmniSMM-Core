import { db } from "@/lib/db";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { headers } from "next/headers";
import { redis } from "@/lib/redis";

export class RateLimitService {
  /**
   * Enforces a rate limit for a given action using the request IP.
   * Uses Redis for high-performance distributed rate limiting,
   * falling back to PostgreSQL if Redis is unavailable.
   * 
   * @param endpoint ID of the protected resource
   * @param maxHits Maximum attempts allowed
   * @param windowSeconds Window length in seconds
   * @returns boolean true if allowed, false if blocked
   */
  static async check(
    endpoint: string, 
    maxHits: number = 10, 
    windowSeconds: number = 60,
    failClosed: boolean = true // Secure by default: block traffic if rate limiter fails
  ): Promise<boolean> {
    try {
      if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
        const { SettingsProvider } = await import('@/lib/settings');
        if (SettingsProvider.isTestEnvironment() && process.env.ENABLE_RATE_LIMIT_TEST !== 'true') {
          return true;
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      if (process.env.NODE_ENV === 'test' && process.env.ENABLE_RATE_LIMIT_TEST !== 'true') return true;
    }
    try {
      const { getClientIp } = await import('@/utils/ip');
      const ip = await getClientIp();
      const now = new Date();
      const redisKey = `ratelimit:${endpoint}:${ip}`;

      // 1. Try Redis First
      try {
        if (redis.status === 'wait') {
          await redis.connect();
        }
        if (redis.status === 'ready' || redis.status === 'connecting') {
          // Lua script for atomic INCR + EXPIRE
          const script = `
            local current = redis.call('INCR', KEYS[1])
            if current == 1 then
              redis.call('EXPIRE', KEYS[1], ARGV[1])
            end
            return current
          `;
          
          const hits = await redis.eval(script, 1, redisKey, windowSeconds) as number;
          
          if (hits > maxHits) {
             console.warn(`[RATE_LIMIT:REDIS] Blocked ${ip} on ${endpoint} (${hits}/${maxHits})`);
             return false;
          }
          return true;
        }
      } catch (redisError: unknown) {
        console.warn("[RATE_LIMIT:REDIS] Redis check failed, falling back to PostgreSQL:", (redisError as Error).message);
      }

      // 2. Fallback to Postgres with atomic UPSERT (Zero Race Condition)
      const newExpiry = new Date(now.getTime() + windowSeconds * 1000);
      const rows = await db.$queryRaw<Array<{ hits: number }>>`
        INSERT INTO "RateLimit" ("id", "ip", "endpoint", "hits", "expiresAt", "createdAt")
        VALUES (gen_random_uuid()::text, ${ip}, ${endpoint}, 1, ${newExpiry}, NOW())
        ON CONFLICT ("ip", "endpoint") DO UPDATE SET
          "hits" = CASE WHEN "RateLimit"."expiresAt" <= NOW() THEN 1 ELSE "RateLimit"."hits" + 1 END,
          "expiresAt" = CASE WHEN "RateLimit"."expiresAt" <= NOW() THEN ${newExpiry} ELSE "RateLimit"."expiresAt" END
        RETURNING "hits";
      `;

      const hits = rows[0]?.hits ?? 1;
      if (hits > maxHits) {
         console.warn(`[RATE_LIMIT:PG] Blocked ${ip} on ${endpoint} (${hits}/${maxHits})`);
         return false;
      }

      return true;
    } catch (e: unknown) {
      console.error("[RATE_LIMIT] Fatal Failure:", e);
      if (failClosed) {
        console.warn(`[RATE_LIMIT] Failing CLOSED for endpoint ${endpoint}`);
        return false;
      }
      console.warn(`[RATE_LIMIT] Failing OPEN for endpoint ${endpoint}`);
      return true;
    }
  }
  
  /**
   * Enforces a rate limit for a custom key and returns full RFC 9331 details
   */
  static async checkCustomKeyDetail(
    key: string,
    maxHits: number = 10,
    windowSeconds: number = 60,
    failClosed: boolean = true
  ): Promise<{ allowed: boolean; limit: number; remaining: number; resetSeconds: number }> {
    try {
      if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
        const { SettingsProvider } = await import('@/lib/settings');
        if (SettingsProvider.isTestEnvironment() && process.env.ENABLE_RATE_LIMIT_TEST !== 'true') {
          return { allowed: true, limit: maxHits, remaining: maxHits - 1, resetSeconds: windowSeconds };
        }
      }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      if (process.env.NODE_ENV === 'test' && process.env.ENABLE_RATE_LIMIT_TEST !== 'true') {
        return { allowed: true, limit: maxHits, remaining: maxHits - 1, resetSeconds: windowSeconds };
      }
    }
    try {
      // W6-1 SECURITY FIX: Prevent Redis OOM or DB bloat from huge custom keys
      if (!key || key.length > 256) {
        console.warn(`[RATE_LIMIT_CUSTOM] Blocked key exceeding max length or empty`);
        return { allowed: false, limit: maxHits, remaining: 0, resetSeconds: windowSeconds };
      }
      
      const now = new Date();
      const redisKey = `ratelimit:custom:${key}`;

      // 1. Try Redis First
      try {
        if (redis.status === 'wait') {
          await redis.connect();
        }
        if (redis.status === 'ready' || redis.status === 'connecting') {
          const script = `
            local current = redis.call('INCR', KEYS[1])
            if current == 1 then
              redis.call('EXPIRE', KEYS[1], ARGV[1])
            end
            local ttl = redis.call('TTL', KEYS[1])
            if ttl < 0 then
              ttl = tonumber(ARGV[1])
            end
            return { current, ttl }
          `;
          const res = await redis.eval(script, 1, redisKey, windowSeconds) as [number, number] | number[];
          const hits = Array.isArray(res) ? Number(res[0]) : Number(res);
          const rawTtl = Array.isArray(res) && res[1] !== undefined ? Number(res[1]) : windowSeconds;
          const resetSeconds = Math.max(1, rawTtl > 0 ? rawTtl : windowSeconds);
          const remaining = Math.max(0, maxHits - hits);
          const allowed = hits <= maxHits;

          if (!allowed) {
             console.warn(`[RATE_LIMIT_CUSTOM:REDIS] Blocked key ${key} (${hits}/${maxHits})`);
          }
          return { allowed, limit: maxHits, remaining, resetSeconds };
        }
      } catch (redisError: unknown) {
        console.warn("[RATE_LIMIT_CUSTOM:REDIS] Redis check failed, falling back to PostgreSQL:", (redisError as Error).message);
      }

      // 2. Fallback to Postgres with atomic UPSERT (Zero Race Condition)
      const ip = "CUSTOM_KEY";
      const endpoint = key;
      const newExpiry = new Date(now.getTime() + windowSeconds * 1000);
      const rows = await db.$queryRaw<Array<{ hits: number; expiresAt: Date }>>`
        INSERT INTO "RateLimit" ("id", "ip", "endpoint", "hits", "expiresAt", "createdAt")
        VALUES (gen_random_uuid()::text, ${ip}, ${endpoint}, 1, ${newExpiry}, NOW())
        ON CONFLICT ("ip", "endpoint") DO UPDATE SET
          "hits" = CASE WHEN "RateLimit"."expiresAt" <= NOW() THEN 1 ELSE "RateLimit"."hits" + 1 END,
          "expiresAt" = CASE WHEN "RateLimit"."expiresAt" <= NOW() THEN ${newExpiry} ELSE "RateLimit"."expiresAt" END
        RETURNING "hits", "expiresAt";
      `;

      const hits = rows[0]?.hits ?? 1;
      const expiresAt = rows[0]?.expiresAt ? new Date(rows[0].expiresAt) : newExpiry;
      const resetSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
      const remaining = Math.max(0, maxHits - hits);
      const allowed = hits <= maxHits;

      if (!allowed) {
         console.warn(`[RATE_LIMIT_CUSTOM:PG] Blocked key ${key} (${hits}/${maxHits})`);
      }
      return { allowed, limit: maxHits, remaining, resetSeconds };
    } catch (e: unknown) {
      console.error("[RATE_LIMIT_CUSTOM] Fatal Failure:", e);
      if (failClosed) {
        console.warn(`[RATE_LIMIT_CUSTOM] Failing CLOSED for key ${key}`);
        return { allowed: false, limit: maxHits, remaining: 0, resetSeconds: windowSeconds };
      }
      console.warn(`[RATE_LIMIT_CUSTOM] Failing OPEN for key ${key}`);
      return { allowed: true, limit: maxHits, remaining: maxHits - 1, resetSeconds: windowSeconds };
    }
  }

  static async checkCustomKey(
    key: string,
    maxHits: number = 10,
    windowSeconds: number = 60,
    failClosed: boolean = true // Secure by default: block traffic if rate limiter fails
  ): Promise<boolean> {
    const detail = await this.checkCustomKeyDetail(key, maxHits, windowSeconds, failClosed);
    return detail.allowed;
  }

  /**
   * Dual-Tier Multi-Tenant Bulkhead Rate Limiter (BGS-2026 / RFC 9331).
   * Level 1: Global Tenant Bulkhead (prevents botnet/DDoS from overwhelming shared core)
   * Level 2: Per-Tenant IP Limiter (prevents single-client spam)
   */
  static async checkDualTierRateLimit(options: DualTierRateLimitOptions): Promise<DualTierRateLimitResult> {
    const {
      tenantId,
      ip,
      endpoint,
      ipLimit,
      ipWindowSeconds = 60,
      tenantLimit,
      tenantWindowSeconds = 60,
      failClosed = true,
    } = options;

    // 1. Level 1: Global Tenant Bulkhead check
    const tenantBulkheadKey = `sf_bulkhead_tenant_${tenantId}_${endpoint}`;
    const tenantInfo = await this.checkCustomKeyDetail(
      tenantBulkheadKey,
      tenantLimit,
      tenantWindowSeconds,
      failClosed
    );

    if (!tenantInfo.allowed) {
      console.warn(`[RATE_LIMIT:BULKHEAD] Tenant capacity exceeded for tenant ${tenantId} on ${endpoint}`);
      return {
        allowed: false,
        blockedBy: 'TENANT_BULKHEAD',
        limit: tenantLimit,
        remaining: 0,
        resetSeconds: tenantInfo.resetSeconds,
      };
    }

    // 2. Level 2: Per-Tenant IP check
    const ipKey = `sf_ratelimit_${tenantId}_${endpoint}_${ip}`;
    const ipInfo = await this.checkCustomKeyDetail(
      ipKey,
      ipLimit,
      ipWindowSeconds,
      failClosed
    );

    if (!ipInfo.allowed) {
      console.warn(`[RATE_LIMIT:IP] IP rate limit exceeded for ${ip} on tenant ${tenantId}:${endpoint}`);
      return {
        allowed: false,
        blockedBy: 'IP',
        limit: ipLimit,
        remaining: 0,
        resetSeconds: ipInfo.resetSeconds,
      };
    }

    return {
      allowed: true,
      blockedBy: 'NONE',
      limit: ipLimit,
      remaining: ipInfo.remaining,
      resetSeconds: ipInfo.resetSeconds,
    };
  }
}

export interface DualTierRateLimitResult {
  allowed: boolean;
  blockedBy: 'NONE' | 'IP' | 'TENANT_BULKHEAD';
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export interface DualTierRateLimitOptions {
  tenantId: string;
  ip: string;
  endpoint: string;
  ipLimit: number;
  ipWindowSeconds?: number;
  tenantLimit: number;
  tenantWindowSeconds?: number;
  failClosed?: boolean;
}


