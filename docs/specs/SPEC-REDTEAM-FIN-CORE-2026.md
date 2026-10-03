# SPEC-REDTEAM-FIN-CORE-2026 — Idempotency Binding, Escrow Guard, Catalog Resilience

**Tier:** 1 (Деньги / Заказы / Баланс / Каталог) · **Статус:** Approved (review policy) · **Дата:** 2026-10-03
**Источник:** Red Team аудит `red_team_audit_report.md` (блокеры B1, B2, B3, B5, B6). B4 (`referralDebit`) — отложен до бизнес-решения о семантике реферального долга.

## Контекст
Клиентский `idempotencyKey` использовался как основа ключа списания в леджере, а `WalletOps` считал любое совпадение ключа «успехом» без сверки payload → бесплатные заказы и цикл ERROR→refund (B1/B2), BOLA через конфликт ключа (B3). `quarantineApprove` допускал отрицательный баланс (B5). Фоновая сверка цен могла массово выключить витрину при битом курсе, а пост-синк не был tenant-scoped и делал hard delete (B6).

## Инварианты (MUST)
| ID | Инвариант |
|---|---|
| INV-IDEM-01 | Ключ списания баланса при checkout = `IdempotencyKeys.forOrderCharge(order.id)`; клиентский ключ НИКОГДА не входит в ключ леджера. |
| INV-IDEM-02 | Повторное попадание ключа: для списаний (`charge`, отрицательный `adminAdjust`) — только при совпадении `userId` и знаковой суммы; для поступлений (`credit`, `refund`, положительный `adminAdjust`) — только при совпадении `userId` (дрейф суммы логируется: повтор не двигает деньги, а отказ зациклил бы ретраи вебхуков). Иначе `IdempotencyKeyReuseError` (`IDEMPOTENCY_KEY_REUSE`). |
| INV-IDEM-03 | В `charge` idempotency pre-check выполняется ДО проверки баланса (повтор оплаченной операции возвращает `cached`). |
| INV-BOLA-01 | Конфликт `Order.idempotencyKey` обрабатывается только если `existingOrder.userId === user.id && existingOrder.tenantId === tenantId`; иначе — обобщённая ошибка без данных заказа. |
| INV-ESC-01 | `quarantineApprove`: amount ≠ 0; отрицательная сумма применяется только при `balance >= |amount|`, иначе `WalletInsufficientFundsError`. |
| INV-ESC-02 | `quarantineAdd`: amount ≠ 0 и `|amount| <= QUARANTINE_HARD_CEILING_KOPECKS` (1 млрд ₽). Потолок обязан быть выше `ELEVATED_ADJUSTMENT_CAP_KOPECKS`, т.к. карантин — приёмник аномалий OWNER (> 10 млн ₽) из `EscrowService`. |
| INV-CAT-01 | `RECONCILE_PRICES` прерывается (без мутаций) при курсе USD вне `[USD_RUB_SANITY_MIN, USD_RUB_SANITY_MAX]`. |
| INV-CAT-02 | `applyPostSyncRules(tenantId)` мутирует только `Service` своего `tenantId` и никогда не удаляет строки `Service` (blacklist → `isActive:false`). |
| INV-REF-01 | Отзыв комиссии (`referralDebit` с `allowDebt: true`, вызывается только из `reverseCommission`) уменьшает `referralBalance` ровно на сумму записи леджера; недостаток становится реферальным долгом (отрицательный баланс), основной баланс не затрагивается. |
| INV-REF-02 | Вывод реферальных средств (`referralDebit` по умолчанию: перевод на основной, админ-выплата) атомарен (`gte`-guard) и при нехватке бросает `WalletInsufficientFundsError` без записи в леджер; долг не создаётся. Ключи выплаты строятся из одного `payoutId` (не `Date.now()`, не сумма). |

## Edge Cases
- Повтор checkout с тем же ключом при `ERROR`-заказе → новое реальное списание (новый `order.id`).
- Повтор `charge` с тем же ключом после того, как баланс уже потрачен → `cached: true`, не `INSUFFICIENT_FUNDS`.
- Тот же ключ, другой пользователь/сумма → `IdempotencyKeyReuseError`, баланс не меняется.

## Тесты
`src/__tests__/financial/redteam-fin-core-invariants.test.ts` (unit, in-memory tx), `src/__tests__/unit/post-sync-rules-tenant-scope.test.ts`.
