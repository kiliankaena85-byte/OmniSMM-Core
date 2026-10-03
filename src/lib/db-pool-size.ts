/**
 * Cluster-aware расчёт размера пула соединений Prisma (SPEC-POSTDEPLOY-POOL-SYNC-2026).
 *
 * Проблема: `connection_limit` применяется на КАЖДЫЙ процесс. При `scripts/cluster-server.js`
 * с N воркерами суммарный потолок = N × limit, что при `max_connections=60` на PostgreSQL
 * приводит к риску `too many clients`. Здесь бюджет делится между воркерами кластера.
 */

/**
 * Читаемые переменные: APP_ROLE, DATABASE_POOL_SIZE, DATABASE_POOL_BUDGET, CLUSTER_WORKERS.
 * Тип намеренно совместим с `process.env` (NodeJS.ProcessEnv).
 */
export type PoolEnv = Readonly<Record<string, string | undefined>>;

/** Пул фонового воркера BullMQ (без изменений относительно прежнего поведения). */
export const WORKER_POOL_SIZE = 5;
/** Пул одиночного процесса (прежнее значение по умолчанию). */
export const SINGLE_PROCESS_POOL_SIZE = 50;
/** Нижняя граница пула на воркер кластера. */
export const MIN_CLUSTER_POOL_SIZE = 5;
/** Суммарный бюджет соединений web-кластера по умолчанию (из max_connections=60 оставляем запас на worker, bot, admin, миграции). */
export const DEFAULT_WEB_POOL_BUDGET = 36;

function parsePositiveInt(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return null;
  const value = parseInt(raw.trim(), 10);
  return value > 0 ? value : null;
}

export function resolvePoolLimit(env: PoolEnv): string {
  if (env.APP_ROLE === 'worker') return String(WORKER_POOL_SIZE);

  const explicit = parsePositiveInt(env.DATABASE_POOL_SIZE);
  if (explicit !== null) return String(explicit);

  const workers = parsePositiveInt(env.CLUSTER_WORKERS);
  if (workers === null || workers <= 1) return String(SINGLE_PROCESS_POOL_SIZE);

  const budget = parsePositiveInt(env.DATABASE_POOL_BUDGET) ?? DEFAULT_WEB_POOL_BUDGET;
  const perWorker = Math.floor(budget / workers);
  return String(Math.min(SINGLE_PROCESS_POOL_SIZE, Math.max(MIN_CLUSTER_POOL_SIZE, perWorker)));
}
