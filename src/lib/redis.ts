import { Redis } from 'ioredis';
import { redactSensitiveTokens } from '@/lib/logger/sensitive-data-filter';

const globalForRedis = global as unknown as { redis: Redis };

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export interface RedisValidationResult {
  valid: boolean;
  warning?: string;
  error?: string;
}

/**
 * Validates Redis connection string security per PROD-SEC-2026 (SEC-001).
 * In production:
 * 1. Connection string MUST contain explicit authentication credentials (@ or password).
 * 2. If non-local host is used, TLS (rediss://) is recommended to prevent plaintext transit.
 */
export function validateRedisUrl(
  url: string,
  env: string = process.env.NODE_ENV || 'development',
  explicitPassword?: string
): RedisValidationResult {
  if (env === 'production') {
    // In production, ALL Redis connections must explicitly contain authentication credentials.
    // NOTE: Only the URL itself and the explicitly passed explicitPassword are checked.
    // We do NOT fall back to process.env.REDIS_PASSWORD here — that would make unit tests
    // non-deterministic and allow misconfigured URLs to pass silently in CI.
    // Callers at startup (redis.ts module level) must pass the env var explicitly if needed.
    const hasAuth = url.includes('@') || Boolean(explicitPassword);
    if (!hasAuth) {
      return {
        valid: false,
        error: 'FATAL [SECURITY]: SEC-001 Violation! Redis is running in production without explicit authentication in the connection string (e.g. redis://:<STRONG_PASSWORD>@host:port or rediss://...).',
      };
    }

    const isLocal =
      url.includes('localhost') ||
      url.includes('127.0.0.1') ||
      url.includes('0.0.0.0') ||
      url.includes('@redis:') ||
      url.includes('//redis:') ||
      url.includes('smmplan_redis') ||
      url.includes('host.docker.internal');

    if (!isLocal && !url.startsWith('rediss://')) {
      return {
        valid: true,
        warning: '🚨 [SECURITY WARNING] Redis in production is not using TLS (rediss://). Transit encryption recommended!',
      };
    }
  }

  return { valid: true };
}

// Enforce SEC-001 Hardening at startup (pass env password explicitly so URL+envPass combo is accepted)
const isBuildTime =
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.npm_lifecycle_event === 'build' ||
  process.env.IS_NEXT_BUILD === 'true' ||
  process.env.NEXT_RUNTIME === 'edge';

const redisCheck = validateRedisUrl(redisUrl, process.env.NODE_ENV, process.env.REDIS_PASSWORD);
if (!redisCheck.valid) {
  if (isBuildTime) {
    // During next build static page collection, Redis is not connected. Log warning instead of halting build.
    console.warn('[REDIS] Build-time SEC-001 notice (skipped during compilation):', redisCheck.error);
  } else {
    throw new Error(redisCheck.error);
  }
} else if (redisCheck.warning) {
  console.warn(redisCheck.warning);
}

/**
 * Calculates exponential reconnect backoff delay in ms.
 * In production, caps at 3000ms and NEVER returns null to prevent connection drop (P0-REDIS-RESILIENCE).
 */
export function calculateRedisRetryDelay(times: number, env: string = process.env.NODE_ENV || 'development'): number {
  if (env === 'test') {
    return Math.min(times * 50, 500);
  }
  return Math.min(times * 100, 3000);
}

export const redis =
  globalForRedis.redis ||
  new Redis(redisUrl, {
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: process.env.NODE_ENV === 'test' ? null : 3,
    connectTimeout: 5000,
    lazyConnect: true,
    enableAutoPipelining: true, // Batch concurrent commands within the same event loop tick (P95 < 1ms)
    noDelay: true,              // Disable Nagle's algorithm for sub-millisecond TCP packet dispatch
    keepAlive: 10000,           // Retain persistent TCP keep-alive probe
    retryStrategy: (times) => calculateRedisRetryDelay(times, process.env.NODE_ENV),
  });

// Unconditionally preserve singleton across Next.js server actions / standalone chunks to prevent connection leaks
globalForRedis.redis = redis;

// Fire and forget error handler to prevent unhandled rejection crashes
redis.on('error', (err) => {
  console.error('[REDIS] Connection error:', redactSensitiveTokens(err.message));
});
