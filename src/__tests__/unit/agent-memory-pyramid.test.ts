/**
 * agent-memory-pyramid.test.ts
 *
 * Unit tests for OmniSMM 4-Tier Memory Pyramid (L1 Atomic Invariants, L2 Scenario Recipes, RRF Ranking).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  AtomicInvariantSchema,
  ScenarioRecipeSchema,
  computeRrfScore,
  UniversalMemoryItem,
} from '@/lib/memory/agent-memory-schema';
import { SmmplanMemoryClient } from '../../../scripts/memory-client';

describe('OmniSMM Memory Pyramid & RRF Engine (TencentDB Architecture Adaptation)', () => {
  const testCacheDir = path.resolve(process.cwd(), '.planning/test_memory');
  const testCacheFile = path.join(testCacheDir, 'test_memory_cache.json');

  beforeEach(() => {
    if (!fs.existsSync(testCacheDir)) {
      fs.mkdirSync(testCacheDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testCacheFile)) {
      fs.unlinkSync(testCacheFile);
    }
    if (fs.existsSync(testCacheDir)) {
      try {
        fs.rmdirSync(testCacheDir);
      } catch {
        // Ignore if not empty
      }
    }
  });

  describe('1. Zod Validation for L1 Invariants and L2 Scenario Recipes', () => {
    it('validates a valid L1 Atomic Invariant', () => {
      const validL1 = {
        id: 'INV-FIN-001',
        category: 'billing',
        rule: 'All financial calculations MUST use ExactMath with BigInt kopecks and 1 kop floor',
        rationale: 'Eliminates float rounding errors in 54-FZ fiscalization and wallet mutations',
        severity: 'CRITICAL_BLOCKING',
        affectedFiles: ['src/lib/exact-math.ts', 'src/services/billing/wallet-ops.ts'],
        tags: ['fintech', 'exactmath', 'bigint', 'ledger'],
        createdAt: '2026-10-02T12:00:00.000Z',
      };

      const result = AtomicInvariantSchema.safeParse(validL1);
      expect(result.success).toBe(true);
    });

    it('rejects an invalid L1 Invariant with wrong ID format', () => {
      const invalidL1 = {
        id: 'BAD_ID',
        category: 'billing',
        rule: 'Short',
        rationale: 'Short',
        tags: [],
        createdAt: 'invalid-date',
      };

      const result = AtomicInvariantSchema.safeParse(invalidL1);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errorFields = result.error.errors.map((e) => e.path[0]);
        expect(errorFields).toContain('id');
        expect(errorFields).toContain('rule');
        expect(errorFields).toContain('tags');
      }
    });

    it('validates a valid L2 Scenario Recipe', () => {
      const validL2 = {
        id: 'SCEN-CACHE-001',
        title: 'Single-Flight Coalescing Mutex for SSR Ingress Microcache',
        triggerContext: 'When experiencing Thundering Herd / Cache Stampede under 500+ rps on cold SSR cache',
        actionSteps: [
          'Capture incoming requests by hash key in activeInflight Mutex map',
          'First request generates SSR response; subsequent requests attach to waiters queue',
          'On completion, broadcast cached buffer to all waiters in 0.1ms without calling React 19 SSR',
        ],
        failureModes: ['Client connection abort without cleanup', 'Caching 500 error responses'],
        verification: ['npx vitest run src/__tests__/unit/cluster-microcache-engine.test.ts'],
        tags: ['microcache', 'single-flight', 'thundering-herd', 'ssr'],
        successCount: 3,
        updatedAt: '2026-10-02T12:00:00.000Z',
      };

      const result = ScenarioRecipeSchema.safeParse(validL2);
      expect(result.success).toBe(true);
    });
  });

  describe('2. Reciprocal Rank Fusion (RRF) Mathematical Ranking', () => {
    it('ranks items matching multiple signals (lexical + tags + severity) higher than single-signal items', () => {
      const itemBoth: UniversalMemoryItem = {
        id: 'INV-1',
        layer: 'L1',
        title: 'Ledger-First WalletOps',
        content: 'Wallet balance update with Ledger-First',
        tags: ['fintech', 'wallet'],
        severityWeight: 1.5,
        rawItem: {},
      };

      const itemOnlyLexical: UniversalMemoryItem = {
        id: 'INV-2',
        layer: 'L1',
        title: 'Ledger docs',
        content: 'Overview of ledger terminology',
        tags: ['docs'],
        severityWeight: 1.0,
        rawItem: {},
      };

      // itemBoth ranks #0 in lexical, #0 in tags, #0 in severity
      const scoreBoth = computeRrfScore(itemBoth, 0, 0, 0);

      // itemOnlyLexical ranks #1 in lexical, but unranked (-1) in tags and unranked in severity
      const scoreLexicalOnly = computeRrfScore(itemOnlyLexical, 1, -1, -1);

      expect(scoreBoth).toBeGreaterThan(scoreLexicalOnly);
      expect(scoreBoth).toBeCloseTo(1.0 / 60 + 1.5 / 60 + 1.2 / 60, 4);
      expect(scoreLexicalOnly).toBeCloseTo(1.0 / 61, 4);
    });
  });

  describe('3. SmmplanMemoryClient Pyramid Storage & Retrieval', () => {
    it('records and retrieves L1 Atomic Invariants and L2 Scenario Recipes', async () => {
      const client = new SmmplanMemoryClient('http://localhost:99999', testCacheFile);

      await client.recordAtomicInvariant({
        id: 'INV-DB-001',
        category: 'database',
        rule: 'Never call deleteMany on Category or Service in smmplan_lite production DB',
        rationale: 'CatalogLockGuard protects against rogue seeder resets and wiping 400 services',
        severity: 'CRITICAL_BLOCKING',
        affectedFiles: ['src/lib/db.ts', 'src/lib/catalog-lock.ts'],
        tags: ['database', 'catalog-lock', 'inviolable'],
        createdAt: '2026-10-02T12:00:00.000Z',
      });

      await client.recordScenarioRecipe({
        id: 'SCEN-TEST-001',
        title: 'Vitest Database Isolation from Production',
        triggerContext: 'When running integration tests that could accidentally mutate smmplan_lite database',
        actionSteps: [
          'Place setup-env.ts as first entry in vitest config setupFiles',
          'Enforce DATABASE_URL to smmplan_test before importing @/lib/db',
        ],
        failureModes: ['ESM module hoisting importing db before dotenv.config'],
        verification: ['npx vitest run src/__tests__/unit/catalog-lock-guard.test.ts'],
        tags: ['testing', 'vitest', 'database-isolation'],
        successCount: 1,
        updatedAt: '2026-10-02T12:00:00.000Z',
      });

      const invariants = client.getAtomicInvariants();
      expect(invariants.length).toBe(1);
      expect(invariants[0].id).toBe('INV-DB-001');

      const recipes = client.getScenarioRecipes();
      expect(recipes.length).toBe(1);
      expect(recipes[0].id).toBe('SCEN-TEST-001');

      // Search with layer filter 'L1'
      const l1Results = await client.searchPyramid('smmplan_lite database', { layer: 'L1' });
      expect(l1Results.length).toBeGreaterThan(0);
      expect(l1Results[0].id).toBe('INV-DB-001');

      // Search with layer filter 'L2'
      const l2Results = await client.searchPyramid('vitest setup-env', { layer: 'L2' });
      expect(l2Results.length).toBeGreaterThan(0);
      expect(l2Results[0].id).toBe('SCEN-TEST-001');

      // Universal search across ALL layers
      const allResults = await client.searchPyramid('database');
      expect(allResults.length).toBeGreaterThanOrEqual(1);
    });
  });
});
