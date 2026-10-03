# SPEC-TYPEFIX-TESTER-INVITES-AUTH-2026 — RBAC bypass in tester-invite Server Actions + type regressions of 908bba0

**Tier:** 1 (Безопасность / Баланс-смежное: `isTester` открывает тестовые пополнения и заказы) · **Дата:** 2026-10-03

## Контекст
Коммит `908bba0` добавил `src/actions/admin/tester-invites.ts`, где `requireStaffPermission('clients', 'edit')` вызывается **без** третьего аргумента (колбэка). Контракт функции: `(section, mode, action) → T | { success:false, error }`.
Следствия (подтверждено чтением `src/lib/server/rbac.ts`):
- Неавторизованный/недостаточно привилегированный вызов получает `{ success:false, error }` **и код продолжает выполнение** (результат трактуется как `admin`) → создание инвайтов, отзыв, `db.user.update({ isTester })` для произвольного `userId` без проверки прав.
- Для легитимного стаффа `await action(...)` бросает `TypeError` (action undefined), `rbac` ловит и тоже отдаёт `{ success:false }`.
Server Actions — публичные POST-эндпоинты, ID действий лежат в статических чанках → это реальный вектор BFLA/OWASP A01.

Попутно `tsc --noEmit` на HEAD падает: `depin/auth` (`tokenResolver` не существует → при каждом вызове молча уходим на env-токен, мульти-тенантный токен не используется), `order.wizard` (`idempotencyKey` не в типе), `tester-invites.service` (неверная сигнатура `logger`), `testers/page.tsx` (union-тип результата).

## Инварианты (MUST)
| ID | Инвариант |
|---|---|
| INV-RBAC-01 | Каждое тело Server Action в `tester-invites.ts` исполняется ТОЛЬКО внутри колбэка `requireStaffPermission(section, mode, async (admin, role, tenantId) => …)`. |
| INV-RBAC-02 | Если `requireStaffPermission` вернул `{ success:false }` — действие возвращает тот же `{ success:false, error }`, `TesterInvitesService`/`db` НЕ вызываются. |
| INV-RBAC-03 | Исполнитель и tenant берутся из аргументов колбэка (`admin.id`, `admin.email`, `tenantId`), не из «результата» RBAC. |
| INV-RBAC-04 | Аудит пишется через `auditAdminAwaitable` с валидным контрактом (`targetType`, детали — в `newValue`). |
| INV-RBAC-05 | `toggleUserTesterStatusAction` меняет `isTester` только у пользователя того же tenant, что и активный tenant админа (BOLA). |
| INV-TG-01 | `depin/auth` резолвит токен бота через `resolveTelegramToken(tenantId)`; env-токен — только fallback. |
| INV-TYPE-01 | `tsc --noEmit` — 0 ошибок. |

## Edge Cases
- Неавторизованный вызов: `{ success:false }`, 0 записей в БД, 0 вызовов сервиса.
- Стафф без права `edit` на `clients`: то же.
- Попытка изменить `isTester` пользователя другого tenant → `{ success:false }`.

## Тесты
`src/__tests__/security/tester-invites-rbac.test.ts` (мок `requireStaffPermission`, проверка отсутствия побочных эффектов при отказе).
