import './setup-env';
import { beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { db } from '@/lib/db';

// Node.js 22 / jsdom localStorage polyfill
if (typeof globalThis !== 'undefined') {
  const memoryStorage = new Map<string, string>();
  const storageMock: Storage = {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStorage.set(key, String(value)); },
    removeItem: (key: string) => { memoryStorage.delete(key); },
    clear: () => { memoryStorage.clear(); },
    key: (index: number) => Array.from(memoryStorage.keys())[index] ?? null,
    get length() { return memoryStorage.size; },
  };
  if (typeof Storage !== 'undefined') {
    Object.setPrototypeOf(storageMock, Storage.prototype);
  }
  if (!globalThis.localStorage || typeof globalThis.localStorage.clear !== 'function') {
    Object.defineProperty(globalThis, 'localStorage', {
      value: storageMock,
      writable: true,
      configurable: true,
    });
  }
}

// Mock nodemailer and resend globally to prevent actual email dispatch during tests
vi.mock('nodemailer', () => {
  return {
    default: {
      createTransport: vi.fn().mockReturnValue({
        sendMail: vi.fn().mockResolvedValue({ messageId: 'mock-email-id' })
      })
    }
  };
});

vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = {
        send: vi.fn().mockResolvedValue({ data: { id: 'mock-resend-id' }, error: null })
      };
    }
  };
});

// Mock Next.js Cache invalidation methods to prevent 'static generation store missing' errors natively
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: (fn: any) => fn
}));

// Mock next/headers to avoid 'headers called outside request scope' errors in server actions
vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'user-agent') return 'vitest';
      if (key === 'x-forwarded-for') return '127.0.0.1';
      return null;
    }),
  }),
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(null),
  }),
}));

// Mock featureFlagService globally to avoid database/redis checks during testing and enable features by default
vi.mock('@/services/system/feature-flag.service', () => {
  return {
    featureFlagService: {
      isEnabled: vi.fn().mockResolvedValue(true),
      getState: vi.fn().mockResolvedValue('ON'),
      setState: vi.fn().mockResolvedValue({}),
      listAll: vi.fn().mockResolvedValue([]),
    }
  };
});

// Mock ioredis globally to prevent attempting actual Redis connections during tests
export const mockRedisStore = new Map<string, any>();

vi.mock('ioredis', () => {
  class MockRedis {
    status = 'ready';
    store = mockRedisStore;
    constructor() {}
    on = vi.fn().mockReturnThis();
    get = vi.fn().mockImplementation(async (key: string) => this.store.get(key) ?? null);
    set = vi.fn().mockImplementation(async (key: string, value: any, ...options: any[]) => {
      const isNx = options.includes('NX') || options.includes('nx');
      if (isNx && this.store.has(key)) {
        return null;
      }
      this.store.set(key, value);
      return 'OK';
    });
    del = vi.fn().mockImplementation(async (key: string | string[]) => {
      if (Array.isArray(key)) {
        let deletedCount = 0;
        for (const k of key) {
          if (this.store.has(k)) {
            this.store.delete(k);
            deletedCount++;
          }
        }
        return deletedCount;
      }
      const exists = this.store.has(key);
      this.store.delete(key);
      return exists ? 1 : 0;
    });
    keys = vi.fn().mockImplementation(async (pattern: string) => {
      const regexPattern = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return Array.from(this.store.keys()).filter(k => regexPattern.test(k));
    });
    scan = vi.fn().mockImplementation(async (_cursor: string, ...args: any[]) => {
      const matchIdx = args.indexOf('MATCH');
      const pattern = matchIdx !== -1 && args[matchIdx + 1] ? args[matchIdx + 1] : '*';
      const regexPattern = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      const matchingKeys = Array.from(this.store.keys()).filter(k => regexPattern.test(k));
      return ['0', matchingKeys];
    });
    quit = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    eval = vi.fn().mockImplementation(async (script: string, numKeys: number, key: string, ...args: any[]) => {
      if (script.includes('del') && script.includes('ARGV[1]')) {
        const stored = this.store.get(key);
        if (stored === args[0]) {
          this.store.delete(key);
          return 1;
        }
        return 0;
      }
      const current = (this.store.get(key) || 0) + 1;
      this.store.set(key, current);
      return current;
    });
    incr = vi.fn().mockImplementation(async (key: string) => {
      const current = (this.store.get(key) || 0) + 1;
      this.store.set(key, current);
      return current;
    });
    incrby = vi.fn().mockImplementation(async (key: string, increment: number) => {
      const current = (this.store.get(key) || 0) + increment;
      this.store.set(key, current);
      return current;
    });
    setex = vi.fn().mockImplementation(async (key: string, seconds: number, value: any) => {
      this.store.set(key, value);
      return 'OK';
    });
    setnx = vi.fn().mockImplementation(async (key: string, value: any) => {
      if (this.store.has(key)) return 0;
      this.store.set(key, value);
      return 1;
    });
    expire = vi.fn().mockResolvedValue(1);
    ping = vi.fn().mockResolvedValue('PONG');
    zremrangebyscore = vi.fn().mockResolvedValue(0);
    zcard = vi.fn().mockResolvedValue(0);
    zadd = vi.fn().mockResolvedValue(1);
    pipeline = vi.fn().mockReturnValue({
      zremrangebyscore: vi.fn().mockReturnThis(),
      zcard: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      hset: vi.fn().mockReturnThis(),
      hget: vi.fn().mockReturnThis(),
      hdel: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      del: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 0], [null, 0], [null, 1], [null, 1]]),
    });
    multi = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue([]),
    });
    publish = vi.fn().mockResolvedValue(1);
    subscribe = vi.fn().mockResolvedValue(undefined);
  }
  return {
    Redis: MockRedis,
    default: MockRedis,
  };
});

// Mock bullmq globally to prevent BullMQ queue initializations from attempting Redis connections
vi.mock('bullmq', () => {
  class MockQueue {
    name: string;
    jobs = new Map<string, any>();
    defaultJobOptions = { attempts: 3, backoff: { type: 'exponential' } };

    constructor(name: string) {
      this.name = name;
    }

    add = vi.fn().mockImplementation(async (name: string, data: any, opts?: any) => {
      const jobId = opts?.jobId || `mock-job-${Date.now()}-${Math.random()}`;
      const job = {
        id: jobId,
        name,
        data,
        opts,
        getState: async () => {
          if (opts?.delay) return 'delayed';
          return 'waiting';
        }
      };
      this.jobs.set(jobId, job);
      return job;
    });

    close = vi.fn().mockImplementation(async () => {
      this.jobs.clear();
    });

    getJob = vi.fn().mockImplementation(async (jobId: string) => {
      return this.jobs.get(jobId);
    });

    getDelayedCount = vi.fn().mockImplementation(async () => {
      let count = 0;
      for (const job of this.jobs.values()) {
        if (job.opts?.delay) count++;
      }
      return count;
    });

    getWaitingCount = vi.fn().mockImplementation(async () => {
      let count = 0;
      for (const job of this.jobs.values()) {
        if (!job.opts?.delay) count++;
      }
      return count;
    });

    obliterate = vi.fn().mockImplementation(async (opts?: any) => {
      this.jobs.clear();
    });
  }
  class MockWorker {
    constructor() {}
    close = vi.fn().mockResolvedValue(undefined);
  }
  class MockUnrecoverableError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'UnrecoverableError';
    }
  }
  return {
    Queue: MockQueue,
    Worker: MockWorker,
    UnrecoverableError: MockUnrecoverableError,
  };
});

// Mock admin audit module globally to prevent concurrent background DB writes from causing deadlocks during TRUNCATE.
vi.mock('@/lib/admin-audit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/admin-audit')>();
  const { db } = await import('@/lib/db');
  
  return {
    ...original,
    auditAdmin: (params: any) => {
      // In testing, we turn fire-and-forget into a tracked promise that we can await before each TRUNCATE.
      const promise = db.adminAuditLog.create({
        data: {
          tenantId: params.tenantId || 'smmplan',
          adminId: params.adminId,
          adminEmail: params.adminEmail,
          action: params.action,
          target: params.target,
          targetType: params.targetType,
          oldValue: original.safeSerialize(params.oldValue),
          newValue: original.safeSerialize(params.newValue),
          ipAddress: params.ipAddress ?? null,
        },
      }).catch((err) => {
        console.error('[AdminAudit Mock] Failed to write log:', err);
      });

      const g = globalThis as any;
      g.__pendingAuditPromises = g.__pendingAuditPromises || [];
      g.__pendingAuditPromises.push(promise);
    },
    auditAdminAwaitable: async (params: any) => {
      const client = params.tx || db;
      return client.adminAuditLog.create({
        data: {
          tenantId: params.tenantId || 'smmplan',
          adminId: params.adminId,
          adminEmail: params.adminEmail,
          action: params.action,
          target: params.target,
          targetType: params.targetType,
          oldValue: original.safeSerialize(params.oldValue),
          newValue: original.safeSerialize(params.newValue),
          ipAddress: params.ipAddress ?? null,
        },
      });
    }
  };
});

beforeAll(async () => {
  const rawPath = expect.getState().testPath || '';
  const testPath = rawPath.replace(/\\/g, '/').toLowerCase();
  const isPureUnitTest = (
    testPath.includes('/unit/') ||
    testPath.includes('src/__tests__/unit') ||
    testPath.includes('/architecture/') ||
    testPath.includes('src/__tests__/architecture') ||
    testPath.includes('/security/') ||
    testPath.includes('src/__tests__/security') ||
    testPath.includes('/telemetry/') ||
    testPath.includes('src/__tests__/telemetry') ||
    testPath.includes('multitenant-staff-isolation') ||
    testPath.includes('multitenant-isolation') ||
    testPath.includes('multitenant-e2e-matrix') ||
    testPath.includes('packages/') ||
    testPath.includes('admin-audit.test.ts') ||
    testPath.includes('load-stability-prisma-pool')
  ) && ![
    'marketing.test.ts',
    'smart-feedback-loop.test.ts',
    'wallet.race.test.ts',
    'smart-drip.test.ts',
    'audit-log.test.ts',
    'pricing-invariants.test.ts'
  ].some(t => testPath.includes(t));

  // Provide test encryption key so EncryptionService doesn't fail
  process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || '0000000000000000000000000000000000000000000000000000000000000000';
  
  // Use the default Docker port for Redis
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

  if (!isPureUnitTest) {
    // OMNI-AUDIT: Block accidental truncation of the development database
    const dbUrl = process.env.DATABASE_URL || '';
    if (!dbUrl.includes('test') && !dbUrl.includes('smmplan_test')) {
      throw new Error(
        `[FATAL] Accidental DB wipe protection triggered! ` +
        `DATABASE_URL points to a non-test database: "${dbUrl}". ` +
        `Vitest was about to truncate your entire development database. ` +
        `Please run tests using "npm run test" or ensure "dotenv -e .env.test" is active.`
      );
    }

    // Patch block_ledger_mutation trigger function to use IS NOT DISTINCT FROM for nullable fields
    try {
      await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION block_ledger_mutation()
      RETURNS TRIGGER AS $$
      BEGIN
        IF (TG_OP = 'UPDATE' AND OLD.status = 'QUARANTINE') THEN
          -- Strict security check: only the "status" field may change
          IF (NEW.id = OLD.id AND
              NEW."userId" = OLD."userId" AND
              NEW."adminId" IS NOT DISTINCT FROM OLD."adminId" AND
              NEW.amount = OLD.amount AND
              NEW.reason = OLD.reason AND
              NEW."idempotencyKey" IS NOT DISTINCT FROM OLD."idempotencyKey" AND
              NEW."transactionType" = OLD."transactionType" AND
              NEW."createdAt" = OLD."createdAt") THEN
            RETURN NEW;
          ELSE
            RAISE EXCEPTION 'Financial Ledger is immutable. When status is QUARANTINE, only status updates are permitted.';
          END IF;
        END IF;
        RAISE EXCEPTION 'Financial Ledger is immutable. UPDATE and DELETE actions are strictly forbidden.';
      END;
      $$ LANGUAGE plpgsql;
    `);
  } catch (err) {
    console.error('[setup.ts] Failed to patch block_ledger_mutation function:', err);
  }
}
  
  // Mock external fetch to avoid real network requests to YooKassa/CryptoBot
  vi.stubGlobal('fetch', vi.fn());
});

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function resetTestDb() {
  const MAX_RETRIES = 3;
  const ALL_TABLES = [
    'LedgerEntry', 'Order', 'Payment', 'TicketMessage', 'Ticket', 'Commission',
    'SmartTask', 'SmartCampaign', 'ServiceSmartConfig', 'ServiceRoute',
    'Service', 'Category', 'Provider', 'Article', 'RateLimit', 'AuditLog', 'LoginLog', 'Invoice', 'User'
  ];

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await db.$executeRawUnsafe(`TRUNCATE TABLE "LedgerEntry", "SupportLimitUsage", "SupportHourlyUsage", "SupportFinancialAction", "ManualBalanceAdjustment", "EmployeeResponsibilityConsent", "BalanceAdjustmentPolicy", "Order", "Payment", "TicketMessage", "Ticket", "Commission", "SmartTask", "SmartCampaign", "ServiceSmartConfig", "ServiceRoute", "Service", "Category", "Provider", "Article", "RateLimit", "AuditLog", "LoginLog", "Invoice", "User", "Network", "UrlPattern", "CustomerGroup", "ServiceDraft", "ServiceCustomerAccess", "ServiceLinkCheck", "ServiceEditHistory" CASCADE;`);

      for (const tId of ["smmplan", "lovable", "global"]) {
        await db.tenant.upsert({
          where: { id: tId },
          update: { name: tId, slug: tId, domain: `${tId}.local` },
          create: { id: tId, name: tId, slug: tId, domain: `${tId}.local`, vaultSalt: "test-salt" }
        });

        await db.systemSettings.upsert({
          where: { id: tId },
          update: {
            taxRate: 6.0,
            opexMonthly: 0,
            maintenanceMode: false,
            isTestMode: false,
            siteName: tId === 'lovable' ? 'SMMflux' : 'SMMplan',
            siteDescription: "",
            exchangeRateUSD: 95.0
          },
          create: {
            id: tId,
            taxRate: 6.0,
            opexMonthly: 0,
            maintenanceMode: false,
            isTestMode: false,
            siteName: tId === 'lovable' ? 'SMMflux' : 'SMMplan',
            siteDescription: "",
            exchangeRateUSD: 95.0
          }
        });
      }
      
      return;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const isTransient =
        /deadlock|write conflict|could not serialize|timeout|Can't reach database server|connection/i.test(msg);

      if (!isTransient || attempt === MAX_RETRIES) {
        console.warn(`[setup.ts] resetTestDb warning on attempt ${attempt}:`, msg);
        if (attempt === MAX_RETRIES) return;
      }

      await sleep(150 * attempt);
    }
  }
}

beforeEach(async () => {
  mockRedisStore.clear();
  let shouldReset = true;
  try {
    const testPath = expect.getState().testPath;
    if (testPath) {
      const skipPatterns = [
        'admin-audit',
        'utils',
        'parser',
        'format-eta',
        'link-normalizer',
        'balance-verifier',
        'ledger-reconciliation',
        'link-analyzer',
        'category-matcher',
        'eta.fuzzing',
        'smtp.test.ts',
        'smart-analyzer',
        'abtest',
        'ab-test',
        'client-crm-balance',
        'services-lifecycle',
        'price-reconciler',
        'pricing-hardening',
        'pricing-order-and-marketing',
        'pricing-invariants',
        'pricing-import-guardrails',
        'catalog-ui',
        'sync-provider-catalog',
        'bot-order-real-execution',
        'bot-negative-and-cross-platform',
        'user-login-and-logout-resilience',
        'order-actions-and-support-ops',
        'balance-autoflush-resilience',
        'yookassa',
        'financial-security-audit',
        'production-hardening',
        'logout-and-proxy',
        'ddos-shield',
        'safe-svg',
        'dark-mode',
        'table-density',
        'mobile-',
        'dom-inspector',
        'qa-sentinel',
        'transaction-classifier',
        'sensitive-data-filter',
        'security-alert-escaping',
        'insecure-secret-startup-guard',
        'session-cookie-hardening',
        'auth-payload-hardening',
        'actionable-error',
        'admin-nav-active',
        'maintenance-screens',
        'ai-response-sanitizer',
        'zero-start-detector',
        'pending-check-resolution',
        'order-wizard-',
        'category-slug-and-icon-hygiene',
        'empty-categories-cleanup',
        'order-token-and-typo-guard',
        'service-route-validator',
        'service-mutation-detector',
        'services-mutation',
        'admin-user-sorting',
        'client-ledger-and-notes',
        'settings-cluster-navigation',
        'redis-tls-production-check',
        'db-purge-production-guard',
        'csp-style-nonce',
        'jwt-staff-role-exclusion',
        'telegram-bot-security-invariants',
        'auth-verify-rate-limit',
        'wallet-ops-safety-cap',
        'redteam-fin-core-invariants',
        'redteam-gateways-invariants',
        'tester-invites-and-yookassa-guard',
        'post-sync-rules-tenant-scope',
        'logout-security-and-blacklist',
        'b2b-vault-encryption',
        'server-only-and-url-bounds',
        'swarm-100-percent-hardening',
        'auditor-findings-remediation',
        'telegram-proxy-agent',
        'dashboard-bugs-fix-verification',
        'direct-emergency-alert',
        'watchdog-daemon',
        'tickets-layout-viewport',
        'plan-slide-order-client',
        'plan-fullscreen-checkout',
        'quarantine-api-diff',
        'multitenant-legal-fiscal-isolation',
        'multitenant-staff-isolation',
        'transactional-bulkhead-dlq',
        'wave3-fintech-fiscal',
        'immutable-ledger-reconciliation',
        'storefront-keys-action',
        'storefront',
        'architecture',
        'arch-',
        'provider-form',
        'smart-analyzer',
        'badge-and-warranty',
        'checkout-promo',
        'admin-ai-manual',
        'gemini-key-pool',
        'r1-advanced',
        'promo-case',
        'multi-channel-alert-cascade',
        'smart-alert-deduplication',
        'multitenant-alerts',
        'proxy-tenant-override-auth',
        'mobile-trust-header',
        'llm-prompt-sanitizer',
        'client-dashboard-master',
        'vulnerability-vectors-remediation',
        'unified-link-engine',
        'link-validator-stress',
        'link-analyzer.comprehensive',
        'api-v2-link-validation',
        'telegram-boost-link-recognition',
        'checkout.test.ts',
        'checkout-decomposition',
        'drip-feed-floor',
        'ai-harnesses',
        'stage1-economic',
        'harness',
        'ast-transaction-escape',
        'load-stability-prisma-pool'
      ];
      const normalizedPath = testPath.replace(/\\/g, '/').toLowerCase();
      if (skipPatterns.some(pattern => normalizedPath.includes(pattern.toLowerCase()))) {
        shouldReset = false;
      }
      
      // Skip unit/ and packages/ tests
      if (normalizedPath.includes('packages/')) {
        shouldReset = false;
      }

      // Skip unit/ except for marketing, smart-feedback-loop, wallet.race, smart-drip, audit-log, pricing-invariants
      if (normalizedPath.includes('unit/')) {
        const allowedUnitTests = [
          'marketing.test.ts',
          'smart-feedback-loop.test.ts',
          'wallet.race.test.ts',
          'smart-drip.test.ts',
          'audit-log.test.ts',
          'pricing-invariants.test.ts'
        ];
        if (!allowedUnitTests.some(testName => normalizedPath.includes(testName))) {
          shouldReset = false;
        }
      }
    }
  } catch (e) {
    // Fallback if expect.getState() is not available or throws
  }

  if (shouldReset) {
    await resetTestDb();
  }
});

afterEach(async () => {
  const promises = (globalThis as any).__pendingAuditPromises || [];
  if (promises.length > 0) {
    await Promise.all(promises);
    (globalThis as any).__pendingAuditPromises = [];
  }
});

afterAll(async () => {
  try {
    await db.$disconnect();
  } catch {
    // Silently ignore in jsdom/browser test environments
  }
});
