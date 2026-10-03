/**
 * agent-memory-schema.ts
 *
 * Strict Zod DTOs for OmniSMM 4-Tier Memory Pyramid (L0 -> L1 -> L2 -> L3)
 * Inspired by TencentDB-Agent-Memory architecture, adapted for OmniSMM FinTech & AST Guardrails.
 *
 * Layer Hierarchy:
 * - L0: Raw Conversation & Execution Episodes (.planning/episodes/*.jsonl)
 * - L1: Atomic Invariants & Hard Constraints (ExactMath, DB Inviolability, ACID)
 * - L2: Scenario Recipes & Workflows (Microcache Single-Flight, Vitest Setup-Env)
 * - L3: System Constitution & Meta-Rules (AGENTS.md, MEMORY.md, RAC-2026)
 */

import { z } from 'zod';

export const InvariantSeverityEnum = z.enum([
  'CRITICAL_BLOCKING', // P0: Breaches cause instant build/test failure
  'REQUIRED',          // P1: Must be implemented before production release
  'RECOMMENDED',       // P2: Best practice / optimization
]);
export type InvariantSeverity = z.infer<typeof InvariantSeverityEnum>;

export const InvariantCategoryEnum = z.enum([
  'billing',
  'database',
  'security',
  'cache',
  'routing',
  'legal_54fz',
  'multi_tenant',
  'testing',
]);
export type InvariantCategory = z.infer<typeof InvariantCategoryEnum>;

/**
 * L1: Atomic Invariant (Fine-grained, non-negotiable architectural invariant)
 */
export const AtomicInvariantSchema = z.object({
  id: z.string().regex(/^INV-[A-Z0-9_-]+-[0-9]{3,}$/, 'ID must match INV-<CATEGORY>-<NUM>'),
  category: InvariantCategoryEnum,
  rule: z.string().min(10, 'Rule must be a clear non-empty statement'),
  rationale: z.string().min(10, 'Rationale must justify the invariant'),
  severity: InvariantSeverityEnum.default('CRITICAL_BLOCKING'),
  affectedFiles: z.array(z.string()).default([]),
  tags: z.array(z.string()).min(1, 'At least one tag required'),
  createdAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
});
export type AtomicInvariant = z.infer<typeof AtomicInvariantSchema>;

/**
 * L2: Scenario Recipe (Reusable procedure / workflow for specific technical challenge)
 */
export const ScenarioRecipeSchema = z.object({
  id: z.string().regex(/^SCEN-[A-Z0-9_-]+-[0-9]{3,}$/, 'ID must match SCEN-<DOMAIN>-<NUM>'),
  title: z.string().min(5, 'Scenario title required'),
  triggerContext: z.string().min(10, 'Trigger condition describing when to apply'),
  actionSteps: z.array(z.string()).min(1, 'At least one action step required'),
  failureModes: z.array(z.string()).default([]),
  verification: z.array(z.string()).min(1, 'At least one verification command required'),
  tags: z.array(z.string()).min(1),
  successCount: z.number().int().nonnegative().default(1),
  updatedAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
});
export type ScenarioRecipe = z.infer<typeof ScenarioRecipeSchema>;

/**
 * Reciprocal Rank Fusion (RRF) Ranking Config
 */
export const RrfConfigSchema = z.object({
  k: z.number().positive().default(60), // Standard Lucene/TREC constant
  weights: z.object({
    lexical: z.number().positive().default(1.0),
    tags: z.number().positive().default(1.5),
    recencyOrSeverity: z.number().positive().default(1.2),
  }).default({
    lexical: 1.0,
    tags: 1.5,
    recencyOrSeverity: 1.2,
  }),
});
export type RrfConfig = z.infer<typeof RrfConfigSchema>;

/**
 * Universal Memory Item (Unified representation for RRF ranking)
 */
export interface UniversalMemoryItem {
  id: string;
  layer: 'L1' | 'L2' | 'ADR';
  title: string;
  content: string;
  tags: string[];
  severityWeight: number; // 1.0 to 2.0
  rawItem: unknown;
}

/**
 * Calculate RRF score across multiple ranked lists
 * Formula: RRF_score(d) = SUM_m [ weight_m / (k + rank_m(d)) ]
 */
export function computeRrfScore(
  item: UniversalMemoryItem,
  lexicalRank: number,
  tagRank: number,
  severityRank: number,
  config: RrfConfig = { k: 60, weights: { lexical: 1.0, tags: 1.5, recencyOrSeverity: 1.2 } }
): number {
  const k = config.k;
  const w = config.weights;

  const scoreLexical = lexicalRank >= 0 ? w.lexical / (k + lexicalRank) : 0;
  const scoreTag = tagRank >= 0 ? w.tags / (k + tagRank) : 0;
  const scoreSeverity = severityRank >= 0 ? w.recencyOrSeverity / (k + severityRank) : 0;

  return scoreLexical + scoreTag + scoreSeverity;
}
