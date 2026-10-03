/**
 * Гигиена логов SyncProcessor (SPEC-POSTDEPLOY-POOL-SYNC-2026).
 * Не влияет на бизнес-логику статусов, возвратов и леджера.
 */

export interface WarnThrottleOptions {
  /** Окно подавления повторов для одного ключа. */
  windowMs: number;
  /** Верхняя граница числа ключей (защита от утечки памяти). */
  maxKeys: number;
  now?: () => number;
}

export interface WarnThrottle {
  shouldWarn(key: string): boolean;
  size(): number;
}

export function createWarnThrottle(opts: WarnThrottleOptions): WarnThrottle {
  const now = opts.now ?? Date.now;
  const lastWarnedAt = new Map<string, number>();

  return {
    shouldWarn(key: string): boolean {
      const ts = now();
      const prev = lastWarnedAt.get(key);
      if (prev !== undefined && ts - prev <= opts.windowMs) return false;

      if (!lastWarnedAt.has(key) && lastWarnedAt.size >= opts.maxKeys) {
        // Map сохраняет порядок вставки: вытесняем самый старый ключ.
        const oldest = lastWarnedAt.keys().next().value;
        if (oldest !== undefined) lastWarnedAt.delete(oldest);
      }
      lastWarnedAt.set(key, ts);
      return true;
    },
    size: () => lastWarnedAt.size,
  };
}

/** Error не сериализуется в JSON (`{}`), поэтому достаём читаемую причину явно. */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  if (err === undefined || err === null) return 'unknown error';
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
