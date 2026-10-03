/**
 * SPEC-REDTEAM-FIN-CORE-2026 · INV-CAT-02 — post-sync rules are tenant-scoped and never hard-delete storefront rows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { calls, rec, isLocked } = vi.hoisted(() => {
  const calls: Array<{ op: string; args: { where?: Record<string, unknown> } }> = [];
  const rec = (op: string) => async (args: { where?: Record<string, unknown> }) => {
    calls.push({ op, args });
    if (op.endsWith('findMany')) return [];
    return { count: 0 };
  };
  const isLocked = { value: false };
  return { calls, rec, isLocked };
});

vi.mock('@/lib/catalog-lock', () => ({ CatalogLockGuard: { isLocked: async () => isLocked.value } }));
vi.mock('@/lib/db', () => ({
  db: {
    service: {
      updateMany: rec('service.updateMany'),
      deleteMany: rec('service.deleteMany'),
      findMany: rec('service.findMany'),
      update: rec('service.update'),
    },
    category: { findMany: rec('category.findMany'), create: rec('category.create') },
    network: { findMany: rec('network.findMany') },
  },
}));

import { applyPostSyncRules } from '@/services/providers/post-sync-rules';

describe('INV-CAT-02 · applyPostSyncRules tenant isolation', () => {
  beforeEach(() => { calls.length = 0; });

  it('unlocked catalog: every Service query is scoped to the tenant and nothing is hard-deleted', async () => {
    isLocked.value = false;
    await applyPostSyncRules('flux');

    expect(calls.some(c => c.op === 'service.deleteMany')).toBe(false);
    const serviceCalls = calls.filter(c => c.op.startsWith('service.'));
    expect(serviceCalls.length).toBeGreaterThan(0);
    for (const c of serviceCalls) {
      expect(c.args.where?.tenantId).toBe('flux');
    }
  });

  it('locked catalog: maxQty cap is scoped to the tenant', async () => {
    isLocked.value = true;
    await applyPostSyncRules('smmplan');
    const serviceCalls = calls.filter(c => c.op.startsWith('service.'));
    expect(serviceCalls).toHaveLength(1);
    expect(serviceCalls[0].args.where?.tenantId).toBe('smmplan');
  });
});
