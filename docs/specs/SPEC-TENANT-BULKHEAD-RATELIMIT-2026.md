# SPEC-TENANT-BULKHEAD-RATELIMIT-2026: Multi-Tenant Dual-Tier Bulkhead & Rate Limiting

## 1. Контекст и Проблема
В платформе OmniSMM (SMMplan / SMMflux / White-label тенанты) внешние фронтенды и партнерские витрины подключаются через **Storefront API** (`/api/storefront/v1/*`).
Ранее проверка частоты запросов выполнялась исключительно в связке `(tenantId, clientIp)`.
При распределенной ботнет-атаке или неконтролируемом всплеске трафика с тысяч разных IP-адресов стороннего тенанта (Noisy Neighbor):
1. Каждый отдельный IP укладывался в лимит (например, 120 req/min);
2. Суммарно на сервер обрушивались миллионы паразитных запросов, создавая нагрузку на Redis, CPU воркеров и пул PostgreSQL;
3. Возникал риск деградации скорости ответа для основных витрин платформы (SMMplan и SMMflux).

## 2. Архитектурное Решение (Dual-Tier Bulkhead Isolation)
В соответствии с нормативным стандартом отказоустойчивости `.agents/skills/resilience-bulkhead-circuit/SKILL.md`:
1. Внедрить в `RateLimitService` метод `checkDualTierRateLimit()`:
   - **Уровень 1 (Tenant Bulkhead):** Суммарный глобальный лимит на тенант (`sf_tenant_bulkhead:${tenantId}:${endpoint}`). Если весь тенант суммарно превышает выделенную квоту (например, 600 req/min для каталога, 180 req/min для создания заказов), запросы немедленно отсекаются с `blockedBy: 'TENANT_BULKHEAD'`.
   - **Уровень 2 (Per-IP):** Лимит на конкретный IP клиента тенанта (`sf_ratelimit:${tenantId}:${endpoint}:${ip}`).
2. **Fail-Closed & RFC 9331 стандарты:**
   - Возврат заголовков `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `Retry-After`.
   - При срабатывании Bulkhead возвращать HTTP 429 с четким кодом `TENANT_CAPACITY_EXCEEDED`, изолируя сбой исключительно внутри арендатора-источника трафика.
3. **Обновление эндпоинтов Storefront API:**
   - `/api/storefront/v1/catalog`
   - `/api/storefront/v1/config`
   - `/api/storefront/v1/orders`
   - `/api/storefront/v1/orders/[id]`

## 3. Критерии Приемки (Acceptance Criteria)
1. Если суммарный лимит тенанта превышен, запрос блокируется даже если IP делает первый запрос.
2. Если суммарный лимит тенанта не превышен, но конкретный IP превысил свой лимит — блокируется только этот IP.
3. При `x-stress-bypass` или тестовом окружении без флага лимитер пропускает трафик.
4. Ответ при блокировке содержит RFC 9331 заголовки и структурированный JSON `{ success: false, error: string, code: string }`.
5. 100% прохождение Vitest тестов (`storefront-api-routes.test.ts` и `tenant-bulkhead-ratelimit.test.ts`).
6. `npx tsc --noEmit` — 0 ошибок.
