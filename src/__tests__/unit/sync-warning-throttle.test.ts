import { describe, it, expect } from 'vitest';
import { createWarnThrottle, describeError } from '@/workers/processors/sync-warning-throttle';

describe('SPEC-POSTDEPLOY-POOL-SYNC-2026 · SyncProcessor log hygiene', () => {
  it('INV-SYNC-02: first warning passes, repeats within the window are suppressed', () => {
    let now = 1_000_000;
    const throttle = createWarnThrottle({ windowMs: 3_600_000, maxKeys: 100, now: () => now });
    expect(throttle.shouldWarn('order-1')).toBe(true);
    expect(throttle.shouldWarn('order-1')).toBe(false);
    now += 3_599_999;
    expect(throttle.shouldWarn('order-1')).toBe(false);
    now += 2;
    expect(throttle.shouldWarn('order-1')).toBe(true);
  });

  it('INV-SYNC-02: keys are independent', () => {
    const throttle = createWarnThrottle({ windowMs: 1000, maxKeys: 100, now: () => 0 });
    expect(throttle.shouldWarn('a')).toBe(true);
    expect(throttle.shouldWarn('b')).toBe(true);
  });

  it('INV-SYNC-02: map size is bounded (no memory leak)', () => {
    const throttle = createWarnThrottle({ windowMs: 1000, maxKeys: 3, now: () => 0 });
    for (let i = 0; i < 50; i++) throttle.shouldWarn(`k${i}`);
    expect(throttle.size()).toBeLessThanOrEqual(3);
  });

  it('INV-SYNC-01: describeError turns Error/unknown into a readable string', () => {
    expect(describeError(new Error('PROVIDER_TIMEOUT'))).toBe('PROVIDER_TIMEOUT');
    expect(describeError('boom')).toBe('boom');
    expect(describeError({ code: 1 })).toContain('code');
    expect(describeError(undefined)).toBe('unknown error');
  });
});
