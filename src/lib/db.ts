import { PrismaClient, Prisma } from '@prisma/client';
import { createTenantEnforcerExtension } from './prisma-tenant-enforcer';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  rawPrisma: PrismaClient | undefined;
};

export function getDatasourceUrl(): string | undefined {
  const isTestMode = process.env.CONTOUR === 'test' || process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
  let url = process.env.DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (isTestMode && process.env.DATABASE_URL_TEST) {
    url = process.env.DATABASE_URL_TEST;
  } else if (process.env.CONTOUR === 'prod' && process.env.DATABASE_URL_PROD) {
    url = process.env.DATABASE_URL_PROD;
  }
  if (url && url.startsWith('prisma://')) {
    url = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_URL || url.replace(/^prisma:\/\//, 'postgresql://');
  }

  // Fail-closed test isolation: If tests are running, NEVER let Prisma connect to production smmplan_lite
  if (isTestMode && url && url.includes('/smmplan_lite')) {
    const testFallback = 'postgresql://postgres:postgres@127.0.0.1:5435/smmplan_test?schema=public';
    console.warn('🛡️ [DB ISOLATION] Prevented test runner from connecting to production database (smmplan_lite). Redirected to smmplan_test.');
    url = testFallback;
  }
  if (url) {
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has('connection_limit')) {
        const poolLimit = process.env.APP_ROLE === 'worker' ? '5' : (process.env.DATABASE_POOL_SIZE || '50');
        parsed.searchParams.set('connection_limit', poolLimit);
      }
      if (!parsed.searchParams.has('pool_timeout')) {
        parsed.searchParams.set('pool_timeout', '10');
      }
      if (!parsed.searchParams.has('connect_timeout')) {
        parsed.searchParams.set('connect_timeout', '5');
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }
  return url;
}

export function getBasePrismaClient(): PrismaClient {
  const datasourceUrl = getDatasourceUrl();
  const rawPrisma =
    globalForPrisma.rawPrisma ??
    new PrismaClient({
      ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
      log: process.env.DEBUG_PRISMA === 'true'
        ? ['query', 'error', 'warn']
        : ['error', 'warn'],
    });

  if (process.env.NEXT_RUNTIME !== 'edge') {
    globalForPrisma.rawPrisma = rawPrisma;
  }
  return rawPrisma;
}

export function createPrismaClient(): PrismaClient {
  if (typeof window !== 'undefined' || process.env.NEXT_RUNTIME === 'edge') {
    // Return mock proxy for Browser/Edge Runtime to prevent native binary evaluation crashes
    return new Proxy({} as PrismaClient, {
      get() {
        throw new Error('PrismaClient cannot be executed in Browser or Next.js Edge Runtime. Use Server Components or Server Actions.');
      }
    });
  }

  const rawPrisma = getBasePrismaClient();

  const guarded = (rawPrisma as unknown as {
    $extends: (extension: unknown) => PrismaClient;
  }).$extends({
    query: {
      service: {
        async deleteMany({ args, query }: { args: Prisma.ServiceDeleteManyArgs; query: (args: Prisma.ServiceDeleteManyArgs) => Promise<Prisma.BatchPayload> }) {
          const dsUrl = getDatasourceUrl() || '';
          if (dsUrl.includes('/smmplan_lite')) {
            throw new Error('🚨 [SAFE-GUARD] Service.deleteMany() is STRICTLY FORBIDDEN on production database (smmplan_lite)!');
          }
          if (!args?.where || Object.keys(args.where).length === 0) {
            if (process.env.NODE_ENV === 'production') {
              throw new Error('🚨 [SAFE-GUARD] Unconditional Service.deleteMany() is strictly blocked in production!');
            }
            if (process.env.APP_ENV !== 'test' && process.env.ALLOW_UNSAFE_PURGE !== 'true') {
              throw new Error('🚨 [SAFE-GUARD] Unconditional Service.deleteMany() is blocked to prevent catalog loss!');
            }
            console.warn('⚠️ [AUDIT WARNING] Unconditional Service purge executed!');
          }
          return query(args);
        },
      },
      category: {
        async deleteMany({ args, query }: { args: Prisma.ServiceDeleteManyArgs; query: (args: Prisma.ServiceDeleteManyArgs) => Promise<Prisma.BatchPayload> }) {
          const dsUrl = getDatasourceUrl() || '';
          if (dsUrl.includes('/smmplan_lite')) {
            throw new Error('🚨 [SAFE-GUARD] Category.deleteMany() is STRICTLY FORBIDDEN on production database (smmplan_lite)!');
          }
          if (!args?.where || Object.keys(args.where).length === 0) {
            if (process.env.NODE_ENV === 'production') {
              throw new Error('🚨 [SAFE-GUARD] Unconditional Category.deleteMany() is strictly blocked in production!');
            }
            if (process.env.APP_ENV !== 'test' && process.env.ALLOW_UNSAFE_PURGE !== 'true') {
              throw new Error('🚨 [SAFE-GUARD] Unconditional Category.deleteMany() is blocked to prevent catalog loss!');
            }
            console.warn('⚠️ [AUDIT WARNING] Unconditional Category purge executed!');
          }
          return query(args);
        },
      },
      network: {
        async deleteMany({ args, query }: { args: Prisma.ServiceDeleteManyArgs; query: (args: Prisma.ServiceDeleteManyArgs) => Promise<Prisma.BatchPayload> }) {
          const dsUrl = getDatasourceUrl() || '';
          if (dsUrl.includes('/smmplan_lite')) {
            throw new Error('🚨 [SAFE-GUARD] Network.deleteMany() is STRICTLY FORBIDDEN on production database (smmplan_lite)!');
          }
          if (!args?.where || Object.keys(args.where).length === 0) {
            if (process.env.NODE_ENV === 'production') {
              throw new Error('🚨 [SAFE-GUARD] Unconditional Network.deleteMany() is strictly blocked in production!');
            }
            if (process.env.APP_ENV !== 'test' && process.env.ALLOW_UNSAFE_PURGE !== 'true') {
              throw new Error('🚨 [SAFE-GUARD] Unconditional Network.deleteMany() is blocked to prevent catalog loss!');
            }
            console.warn('⚠️ [AUDIT WARNING] Unconditional Network purge executed!');
          }
          return query(args);
        },
      },
      ledgerEntry: {
        async delete() {
          throw new Error('🚨 [SAFE-GUARD] LedgerEntry delete is strictly forbidden (Financial Audit Trail)!');
        },
        async deleteMany() {
          throw new Error('🚨 [SAFE-GUARD] LedgerEntry deletion is strictly forbidden (Financial Audit Trail)!');
        },
        async update() {
          throw new Error('🚨 [SAFE-GUARD] LedgerEntry update is strictly forbidden (Financial Audit Trail)!');
        },
        async updateMany() {
          throw new Error('🚨 [SAFE-GUARD] LedgerEntry update is strictly forbidden (Financial Audit Trail)!');
        },
      },
    },
  }) as unknown as PrismaClient;

  const tenantGuarded = (guarded as unknown as {
    $extends: (extension: unknown) => PrismaClient;
  }).$extends(createTenantEnforcerExtension(guarded)) as unknown as PrismaClient;

  return tenantGuarded;
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

// Strictly preserve singleton across Next.js Server Actions & standalone chunks to prevent pool proliferation
if (process.env.NEXT_RUNTIME !== 'edge') {
  globalForPrisma.prisma = db;
}
