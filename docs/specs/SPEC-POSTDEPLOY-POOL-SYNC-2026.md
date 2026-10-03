# SPEC-POSTDEPLOY-POOL-SYNC-2026 — Cluster-aware Prisma pool & SyncProcessor log hygiene

**Tier:** 1 (инфраструктура БД / BullMQ) · **Дата:** 2026-10-03
**Источник:** Post-Deployment SRE аудит прода (20:13 MSK).

## Контекст
1. `pg_stat_activity` = 49 из `max_connections=60` (43 idle, 0 active). Причина: `src/lib/db.ts` задаёт `connection_limit=50` **на процесс**, а `scripts/cluster-server.js` поднимает N процессов Next.js (prod: 4). Теоретический потолок 4×50=200 при лимите сервера 60 → риск `too many clients` при всплеске.
2. `SyncProcessor` каждые 5 минут пишет `Batch status polling failed ... error: {}` (объект `Error` не сериализуется — причина сбоя не видна) и `Invalid multi-status response` по одним и тем же заказам (провайдер отвечает `Incorrect order ID`) → шум в логах, скрывающий реальные ошибки.

## Инварианты (MUST)
| ID | Инвариант |
|---|---|
| INV-POOL-01 | Явный `connection_limit` в `DATABASE_URL` и явный `DATABASE_POOL_SIZE` имеют приоритет (обратная совместимость). |
| INV-POOL-02 | `APP_ROLE=worker` → пул 5 (без изменений). |
| INV-POOL-03 | Без явных настроек и `CLUSTER_WORKERS<=1` (или не задан) → пул 50 (без изменений). |
| INV-POOL-04 | Без явных настроек и `CLUSTER_WORKERS=N>1` → `clamp(floor(BUDGET/N), MIN=5, 50)`, где `BUDGET = DATABASE_POOL_BUDGET` (по умолчанию 36). Суммарно по кластеру ≤ max(BUDGET, N×MIN). |
| INV-POOL-05 | Мусорные значения (`NaN`, ≤0, дробные строки) не ломают расчёт — падаем на значение по умолчанию. |
| INV-SYNC-01 | Причина сбоя batch-опроса логируется как строка (`message`), не как `{}`. |
| INV-SYNC-02 | Повторное предупреждение `Invalid multi-status response` по одному заказу — не чаще 1 раза в час на процесс; сообщение содержит `providerName` и `externalId` для ручного разбора. |
| INV-SYNC-03 | Логика статусов/возвратов/леджера НЕ меняется: заказ с невалидным ответом провайдера остаётся в `IN_PROGRESS` (авто-отмена и авто-возврат запрещены — решение принимает человек). |

## Edge Cases
- `CLUSTER_WORKERS=20` → пул не опускается ниже 5.
- `DATABASE_POOL_SIZE=abc` → игнорируется, считается по умолчанию.
- Throttle-карта ограничена по размеру (защита от утечки памяти).

## Тесты
`src/__tests__/unit/db-pool-size.test.ts`, `src/__tests__/unit/sync-warning-throttle.test.ts`.
