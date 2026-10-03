import { describe, it, expect } from 'vitest';
import { resolvePoolLimit } from '@/lib/db-pool-size';

describe('SPEC-POSTDEPLOY-POOL-SYNC-2026 · resolvePoolLimit', () => {
  it('INV-POOL-02: worker role keeps pool of 5', () => {
    expect(resolvePoolLimit({ APP_ROLE: 'worker', CLUSTER_WORKERS: '4' })).toBe('5');
  });

  it('INV-POOL-01: explicit DATABASE_POOL_SIZE wins over cluster math', () => {
    expect(resolvePoolLimit({ DATABASE_POOL_SIZE: '20', CLUSTER_WORKERS: '4' })).toBe('20');
  });

  it('INV-POOL-03: single process keeps legacy default 50', () => {
    expect(resolvePoolLimit({})).toBe('50');
    expect(resolvePoolLimit({ CLUSTER_WORKERS: '1' })).toBe('50');
    expect(resolvePoolLimit({ CLUSTER_WORKERS: '0' })).toBe('50');
  });

  it('INV-POOL-04: cluster of 4 splits default budget 36 into 9 per worker', () => {
    expect(resolvePoolLimit({ CLUSTER_WORKERS: '4' })).toBe('9');
    expect(resolvePoolLimit({ CLUSTER_WORKERS: '3' })).toBe('12');
  });

  it('INV-POOL-04: custom budget is honoured', () => {
    expect(resolvePoolLimit({ CLUSTER_WORKERS: '4', DATABASE_POOL_BUDGET: '48' })).toBe('12');
  });

  it('INV-POOL-04: never drops below the minimum of 5 and never exceeds 50', () => {
    expect(resolvePoolLimit({ CLUSTER_WORKERS: '20' })).toBe('5');
    expect(resolvePoolLimit({ CLUSTER_WORKERS: '2', DATABASE_POOL_BUDGET: '500' })).toBe('50');
  });

  it('INV-POOL-05: garbage values fall back to defaults', () => {
    expect(resolvePoolLimit({ DATABASE_POOL_SIZE: 'abc' })).toBe('50');
    expect(resolvePoolLimit({ DATABASE_POOL_SIZE: '-3' })).toBe('50');
    expect(resolvePoolLimit({ CLUSTER_WORKERS: 'x' })).toBe('50');
    expect(resolvePoolLimit({ CLUSTER_WORKERS: '4', DATABASE_POOL_BUDGET: 'zzz' })).toBe('9');
  });
});
