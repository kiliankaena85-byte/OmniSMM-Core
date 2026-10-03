/**
 * seed-memory-pyramid.ts
 *
 * Seed canonical L1 Atomic Invariants and L2 Scenario Recipes
 * into OmniSMM 4-Tier Memory Pyramid (.planning/memory_cache.json).
 */

import { SmmplanMemoryClient } from './memory-client';
import { AtomicInvariant, ScenarioRecipe } from '../src/lib/memory/agent-memory-schema';

const l1Invariants: AtomicInvariant[] = [
  {
    id: 'INV-FIN-001',
    category: 'billing',
    rule: 'All financial calculations (pricing, balances, refunds, margins) MUST be computed in BigInt integer kopecks using ExactMath with Bankers Rounding and a minimum 1 kopeck floor.',
    rationale: 'Eliminates fractional float drift, cumulative rounding leakages in mass checkouts, and guarantees 100% compliance with 54-FZ fiscalization.',
    severity: 'CRITICAL_BLOCKING',
    affectedFiles: ['src/lib/exact-math.ts', 'src/services/billing/wallet-ops.ts'],
    tags: ['fintech', 'exactmath', 'bigint', 'billing', '54_fz'],
    createdAt: '2026-10-02T12:00:00.000Z',
  },
  {
    id: 'INV-DB-002',
    category: 'database',
    rule: 'Direct deleteMany calls on Category, Service, and Network models are strictly forbidden on production databases (smmplan_lite). Catalog modifications require ADMIN/OWNER permissions and CatalogLockGuard validation.',
    rationale: 'Protects production catalog and curated services from rogue seeder resets, accidental worker sweeps, and test environment pollution.',
    severity: 'CRITICAL_BLOCKING',
    affectedFiles: ['src/lib/db.ts', 'src/lib/catalog-lock.ts', 'test/setup-env.ts'],
    tags: ['database', 'catalog-lock', 'inviolability', 'prisma'],
    createdAt: '2026-10-02T12:00:00.000Z',
  },
  {
    id: 'INV-CACHE-003',
    category: 'cache',
    rule: 'SSR ingress microcache MUST implement a Single-Flight Coalescing Mutex to eliminate Thundering Herd on cache misses, and MUST NEVER cache 5xx/4xx/redirect responses or leak Set-Cookie headers.',
    rationale: 'Guarantees 0.1ms cache hits under 1000+ rps spikes, prevents error response poisoning from corrupting cache, and protects user session cookies.',
    severity: 'CRITICAL_BLOCKING',
    affectedFiles: ['scripts/microcache-engine.js', 'src/lib/cache/redis-cache.service.ts'],
    tags: ['microcache', 'single-flight', 'thundering-herd', 'cache-poisoning'],
    createdAt: '2026-10-02T12:00:00.000Z',
  },
  {
    id: 'INV-SEC-004',
    category: 'security',
    rule: 'Every balance modification MUST write an immutable audit ledger entry inside the transaction BEFORE incrementing/decrementing user balance. Inside prisma.$transaction, calling external db.* is strictly forbidden.',
    rationale: 'Eliminates race conditions (TOCTOU), transaction escape bugs, and ensures double-entry accounting audit trail.',
    severity: 'CRITICAL_BLOCKING',
    affectedFiles: ['src/services/billing/wallet-ops.ts', 'src/lib/db.ts'],
    tags: ['security', 'ledger', 'transaction', 'acid', 'audit'],
    createdAt: '2026-10-02T12:00:00.000Z',
  },
  {
    id: 'INV-MT-005',
    category: 'multi_tenant',
    rule: 'All queries, cache keys, Redis pub/sub channels, and background jobs MUST be scoped by tenantId (smmplan / smmflux). Cross-tenant queries are blocked by Prisma RLS and AST Guardrails.',
    rationale: 'Prevents cross-tenant data leakage between brands SMMplan and SMMflux, maintaining separate financial ledgers and brand trust.',
    severity: 'CRITICAL_BLOCKING',
    affectedFiles: ['src/lib/tenant/context.ts', 'scripts/lint-tenant-isolation.ts'],
    tags: ['multi_tenant', 'tenant_isolation', 'smmplan', 'smmflux'],
    createdAt: '2026-10-02T12:00:00.000Z',
  },
];

const l2Recipes: ScenarioRecipe[] = [
  {
    id: 'SCEN-INGRESS-001',
    title: 'Hardened SSR Ingress Microcache with Weak ETag & Next.js 16 Prefetch Support',
    triggerContext: 'When handling high-concurrency public storefront traffic (/, /services, /faq, /terms) requiring sub-millisecond response times without overloading React 19 SSR.',
    actionSteps: [
      'Compute cache key distinguishing standard navigation from RSC prefetch headers (next-router-prefetch vs :rsc-pref).',
      'Check active inflight map: if key is pending, join waiters queue without invoking SSR.',
      'If key is fresh, intercept res.end to capture body buffer, stripping Set-Cookie.',
      'Verify res.statusCode < 400 before caching to prevent Error Response Poisoning.',
      'On completion, broadcast buffer to all waiters and send RFC 9110 Weak ETag.',
    ],
    failureModes: ['Client socket aborted before render', 'Caching 500 server error', 'Cookie leakage across guests'],
    verification: ['npx vitest run src/__tests__/unit/cluster-microcache-engine.test.ts'],
    tags: ['microcache', 'single-flight', 'nextjs16', 'etag', 'thundering-herd'],
    successCount: 5,
    updatedAt: '2026-10-02T12:00:00.000Z',
  },
  {
    id: 'SCEN-TEST-ENV-002',
    title: 'Vitest Database Isolation & ESM Hoisting Protection',
    triggerContext: 'When writing or running integration tests with Prisma ORM that could accidentally connect to or mutate production database.',
    actionSteps: [
      'Create test/setup-env.ts as first entry in vitest config setupFiles.',
      'Set process.env.DATABASE_URL to smmplan_test before any module imports db.',
      'Add Prisma extension throwing fatal error on deleteMany for production catalog models.',
    ],
    failureModes: ['ESM import hoisting db before dotenv initializes', 'Accidental deleteMany on smmplan_lite'],
    verification: [
      'npx vitest run src/__tests__/unit/catalog-lock-guard.test.ts',
      'npx vitest run src/__tests__/unit/categories-ops.test.ts',
    ],
    tags: ['testing', 'vitest', 'database-isolation', 'prisma'],
    successCount: 3,
    updatedAt: '2026-10-02T12:00:00.000Z',
  },
];

async function seed() {
  console.log('🌱 [Seed Memory Pyramid] Seeding canonical L1 Invariants and L2 Scenario Recipes...');
  const client = new SmmplanMemoryClient();

  await client.recordPyramidBatch(l1Invariants, l2Recipes);

  console.log(`✅ Successfully seeded ${l1Invariants.length} L1 Invariants and ${l2Recipes.length} L2 Scenario Recipes.`);
}

seed().catch(console.error);
