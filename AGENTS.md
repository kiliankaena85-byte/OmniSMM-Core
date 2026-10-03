# AGENTS.md — Smmplan AI Developer Contract (v4.2)
# Этот файл — единый источник правды для ЛЮБОГО AI-ассистента (Antigravity, Cursor, Claude Code, Gemini).
# Все генерируемые изменения ОБЯЗАНЫ строго соблюдать эти правила.

## 0. ⛔ SESSION INIT — ОБЯЗАТЕЛЬНЫЙ ПЕРВЫЙ ШАГ (BLOCKING)

> ❌ **ЗАПРЕЩЕНО** начинать любую работу без выполнения этого раздела.
> Это не рекомендация — это блокирующее требование контракта.

### При каждом старте сессии в этом проекте:

1. **Прочитай файл-якорь** → `CURRENT_STATE.md`
   - Убедись, что знаешь текущую активную задачу и список завершённых этапов.
   - Выведи 1-строчное резюме: "Активная задача: X. Завершено: A, B, C."

2. **Запроси RAG-память** (для нетривиальных задач) → `http://localhost:8100/api/search`
   ```bash
   npx tsx scripts/memory-client.ts searchContext "<тема задачи>"
   ```
   Или через curl: `POST http://localhost:8100/api/search` с `{"query": "...", "collections": ["architecture_decisions","business_rules"], "top_k": 5}`

3. **После завершения задачи — немедленно обнови:**
   - `CURRENT_STATE.md` — статус текущей задачи
   - `MEMORY.md` — раздел 2, если задача существенная
   - GraphRAG: `POST http://localhost:8100/api/decision` — если принято архитектурное решение

---

## 0.5. 🛑 ZERO-DEFECT BLUE-GREEN STAGE & DEPLOYMENT GATE (CRITICAL RULE — BGS-2026)
> ⚠️ **КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО напрямую пересобирать или перезапускать рабочий боевой контейнер (In-Place Production Rebuild).**
> **Любое изменение обязано проходить 5-шаговый пайплайн безопасного релиза (Blue-Green Deployment Protocol):**
> 1. **Изоляция и сборка в Stage-контуре (Port 3005):** Боевой контейнер (`:3000`) неприкосновенен. Кандидат собирается в `smmplan_stage` (`:3005`).
> 2. **Автоматический визуальный аудит в браузере (Puppeteer MCP):** Авторизация (`USER`, `SUPPORT`, `OWNER`) на `:3005`, скриншоты экранов (`/dashboard`, `/admin/dashboard`, `/add-funds`), проверка верстки и утечек данных.
> 3. **Отчет для человека с визуальными доказательствами (Human Approval Gate):** Детали изменений, скриншоты, аудит секретов (`check-bundle-secrets.mjs`), 100% тестов OWASP Top 10, чистый Git-статус.
> 4. **Прямое подтверждение пользователя:** ❌ **ЗАПРЕЩЕНО** переключать боевой контейнер до явного сообщения пользователя: *«Одобряю»*, *«Выкатывай»*.
> 5. **Мгновенное переключение (Zero-Downtime Cutover) & Гарантия отката (5s Instant Rollback):** Переключение трафика с сохранением предыдущего образа как `smmplan_backup`.

## 0.6. 📋 RELEASE ACCEPTANCE CRITERIA (RAC-2026 STANDARDS GATE — CRITICAL)
> 🛡️ **Каждое обновление платформы ОБЯЗАНО соответствовать действующим стандартам 2025–2026 гг., зафиксированным в `docs/RELEASE_ACCEPTANCE_CRITERIA_2026.md`:**
> 1. **Кибербезопасность & Pentest Immunity:** OWASP Top 10:2025 (A01-A10), OWASP ASVS v4.0.3 Level 2, PCI DSS v4.0.1 (Req 3.4, 6.4, 8.3, 10.2), RFC 9116 (`security.txt`), RFC 9331 (`RateLimit`), 152-ФЗ / GDPR.
> 2. **Финтех, Биллинг & Фискализация:** 54-ФЗ + 176-ФЗ/425-ФЗ (НДС 22%, порог УСН 20 млн ₽, `vat_code`), чистый `BigInt` (копейки, ExactMath), Ledger-First принцип, `idempotencyKey`.
> 3. **UX/UI, Дизайн-система & Доступность:** W3C WCAG 2.2 Level AA (Touch Target $\ge 44\text{px}$, Контраст $\ge 4.5:1$), ISO 9241-110:2020, NN/g 10 эвристик (Best Match Rule, единая витрина шлюзов, Zero Horizontal Scroll).
> 4. **Бизнес-логика & Multi-Tenant:** OmniSMM 1.0 (SMMplan / SMMflux), Drip-Feed Floor Invariant ($\lfloor Q/N \rfloor \ge \text{minQty}$), Shadow Catalog buffer.
> 5. **Качество кода & CI/CD:** Server Actions typed `{ success, error }`, TypeScript strict (0 errors), Vitest (100% pass), CI-гейты секретов.

## 0.7. 🛡️ ZERO-REGRESSION & IMPACT RADIUS PROTOCOL (CRITICAL)
> ⚠️ **КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО вносить изменения без картирования радиуса поражения и анализа на 3 шага вперёд:**
> 1. **Оценка радиуса поражения (Impact Radius):** Поиск всех зависимостей. Правка общего кода обязана быть 100% обратно-совместимой.
> 2. **Мозговой штурм на 3 шага вперёд (Pre-Mortem Failure Simulation):** Моделирование влияния на auth, баланс/леджер, кэш, визард чекаута, вебхуки, мульти-тенантность. Fail-Closed guards ДО правки.
> 3. **Сквозная верификация всей системы (Full-Spectrum Regression Gate):** Прогон полного набора: `npx tsc --noEmit`, тесты и аудит секретов.

## 0.8. 🚀 MANDATORY PRODUCTION HARDENING GATE (PROD-SEC-2026 — CRITICAL GATE)
> ⚠️ **ОБЯЗАТЕЛЬНО ПЕРЕД ВЫКАТКОЙ В ПРОДАКШН:**
> 1. **[SEC-001] Redis Auth & Encryption:** `REDIS_URL` с явным защищенным протоколом и паролем (`rediss://...` или `redis://:<PWD>@...`).
> 2. **[SEC-002] CSP Strict-Dynamic:** Зачистка `'unsafe-inline'` / `'unsafe-eval'` из `script-src` в `src/proxy.ts`, Nonce-совместимость.
> 3. **[SEC-003] Production Direct SMTP:** Прямая доставка почты по порту 465 (Яндекс/Mail.ru) без локальных прокси/TUN-адаптеров.

## 0.9. 🛑 MANDATORY FULLSTACK ANALYST & HUMAN APPROVAL PROTOCOL (CRITICAL RULE — FA-2026)
> ⚠️ **КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО вносить изменения без предварительного аудита и одобрения пользователя:**
> 1. **Fullstack Анализ:** Комплексный разбор архитектуры, безопасности, суверенной доступности в РФ/ТСПУ, UX и рисков.
> 2. **Согласование (Human Approval Gate):** Предоставление плана и ожидание прямого подтверждения («Делай», «Согласовано»).
> 3. **Запрет самовольных действий:** ❌ **ЗАПРЕЩЕНО** самовольно менять DNS, прокси, туннели или выходить за рамки согласованного скоупа.

## 0.10. 🏛️ MANDATORY ARCHITECTURAL SKILLS SUITE GATE (ARCH-SKILLS-2026 — CRITICAL CONTRACT)
> ⚠️ **КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО вносить архитектурные изменения без сверки с профильным скиллом из единого реестра `.agents/skills/INDEX.md`:**
> 1. `arch-boundary-guard` — Clean Architecture, разделение слоев, запрет `"use server"` в `page.tsx`, лимит $\le 200$ строк.
> 2. `ddd-aggregate-invariants` — «1 транзакция = 1 агрегат», Drip-Feed Floor, Shadow Catalog в Redis.
> 3. `adr-architect` — Архитектурные решения MADR 3.0, контекст и последствия.
> 4. `concurrency-acid-guard` — TOCTOU, Row-Level Locking, Ledger-First, ExactMath BigInt, защита от Transaction Escape (`db` vs `tx`).
> 5. `db-evolution-zero-downtime` — Expand/Contract pattern, `CREATE INDEX CONCURRENTLY`, лимиты `lock_timeout`.
> 6. `event-driven-reliability` — Transactional Outbox (защита от Dual-Write), идемпотентные очереди BullMQ.
> 7. `resilience-bulkhead-circuit` — Circuit Breaker (Redis), Per-Tenant Bulkhead, таймауты `AbortSignal.timeout()`.
> 8. `multi-tenant-isolation-arch` — Изоляция OmniSMM (SMMplan / SMMflux), tenant-aware кэши, барьер ст. 54.1 НК РФ.
> 9. `api-contract-evolver` — Contract-First (Zod), Zero Breaking Changes, RFC 8594 Deprecation.
> 10. `impact-blast-radius` — Картирование зависимостей, моделирование отказа на 3 шага вперед.
> 11. `nfr-performance-budget` — P95/P99 latency budgets, детекция N+1 в Prisma, Keyset пагинация.

## 0.11. 📐 MANDATORY SPEC-DRIVEN & TEST-DRIVEN PIPELINE (SDD-TDD 2026 — CRITICAL GATE)
> ⚠️ **КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать продуктовый код без предварительной спецификации в `docs/specs/` и падающих тестов (Red Phase):**
> 1. **Tier 1 (Critical — Деньги, Заказы, Баланс, Миграции БД, BullMQ, Безопасность):**
>    - Спецификация `docs/specs/SPEC-*.md` $\to$ Согласование $\to$ Тесты в `src/__tests__/` (Red Phase) $\to$ Минимальный код (Green Phase) $\to$ `tsc --noEmit` & аудит секретов.
> 2. **Tier 2 (Standard — Новые страницы админки, Server Actions, API, сложные формы):**
>    - Light-SDD: Спецификация Zod DTOs + Edge Cases $\to$ Согласование $\to$ Тесты контракта $\to$ Реализация.
> 3. **Tier 3 (Cosmetic — Стили Tailwind, тексты, замена иконок):**
>    - Прямая реализация с визуальным аудитом в браузере (Puppeteer MCP) без избыточного оверхеда спек.

## 0.12. ⚡ AUTONOMOUS ACTION ARBITRATION & DECOMPOSITION PROTOCOL (AAA-2026 — CRITICAL INVARIANT)
> ⚠️ **КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО запрашивать у пользователя подтверждение («делать / не делать», «вариант 1 или 2»), если действие уже санкционировано Моделью Принятия Решений (`ActionArbiter`):**
> 1. **Zero-Friction Autonomous Flow:** Если `ActionArbiter.decide()` вынес вердикт `PROCEED` или `REDIRECT_SAFE`, агент **ОБЯЗАН немедленно приступать к реализации выбранного варианта** без переспросов пользователя. Запрос подтверждения на санкционированных решениях является нарушением контракта (Analysis Paralysis / TOC Bottleneck).
> 2. **Эскалация строго по вердикту `ESCALATE_TO_HUMAN`:** Пользователь привлекается ИСКЛЮЧИТЕЛЬНО при вердикте `ESCALATE_TO_HUMAN` (боевой деплой BGS-2026, деструктивные операции с БД без бекапа).
> 3. **Атомарная Декомпозиция (WBS Rule):** Любая крупная задача обязана декомпозироваться на атомарные шаги ($\le 2$ файлов на шаг). Каждый шаг автоматически проходит через Арбитра и исполняется по TDD (Red $\to$ Green $\to$ DDE-2026 $\to$ Commit) до полного завершения без остановки конвейера.

## 0.13. 🗺️ EPHEMERAL REPO-MAP & NAVIGATION PROTOCOL (ERM-2026 — CRITICAL INVARIANT)
> ⚠️ **КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО запускать рекурсивный поиск по всему проекту или запрашивать статические дампы AST. Работа с кодовой базой строго регламентирована:**
> 1. **Старт задачи:** Всегда начинайте навигацию с чтения корневого индекса `docs/maps/SYSTEM_MAP.md`. Определите целевой бизнес-домен.
> 2. **Динамический радиус (LSP Blast Radius):** Используйте подключенный MCP-сервер `typescript-lsp` (инструмент `find_references`) для мгновенного определения всех зависимых файлов.
> 3. **AST Pruning:** Используйте `generate_dts` для извлечения чистых API-контрактов и Inferred-типов без загрузки тел функций в контекст.
> 4. **Инварианты и Исключения:** При внесении правок соблюдайте инварианты (Contextual Inject). Единственный способ обойти устаревшее правило в legacy-коде — использовать прагму `// @agent-ignore-invariant: <ID> - <Reason>`.
> 5. **Ground Truth:** Карта нужна только для GPS-навигации. Перед изменением строк кода АГЕНТ ОБЯЗАН прочитать целевые файлы целиком через `view_file`.

---

## 1. Стек и окружение
- **Framework**: Next.js 16.x (App Router, Turbopack)
- **UI**: React 19.x
- **Styling**: Tailwind CSS 4.0.0 (`@theme` в `src/app/globals.css`, CSS-first config)
- **Component Library**: HeroUI v3 (dot notation API: `<Table.Header>`, `<Table.Column>`)
- **ORM**: Prisma 5 (PostgreSQL)
- **Language**: TypeScript 5.7+ (strict mode)
- **AI Models**: `gemini-3-flash` или `gemini-3-flash-preview`
- **Linting & Testing**: ESLint 10 (Flat Config — `eslint.config.mjs`) | Vitest 4
- **CI / GitHub Actions**: Node.js 24 runner standard (`actions/checkout@v7`, `actions/setup-node@v7`)

---

## 2. Архитектурные границы и безопасность (Сводный обзор)
Полные нормативные инварианты зафиксированы в [`.agents/rules/architecture-and-security.md`](.agents/rules/architecture-and-security.md):
- **Server/Client:** Server Components по умолчанию; `"use server"` строго в `src/actions/` (запрещен в `page.tsx`); возврат typed `{ success, error }`.
- **Multi-Tenant OmniSMM 1.0:** Платформа OmniSMM обслуживает бренды **SMMplan** (`smmplan.pro`) и **SMMflux** (`smmflux.ru`). Брендов Lovable и SMMboost не существует. Переключение сайтов оператором — глобально в шапке (`<GlobalSiteSwitcher />`).
- **Сетевой биндинг:** Tailscale Funnel (`https://desktop-25m6el7.tailbb9d28.ts.net` $\to$ `http://127.0.0.1:3000`). Сервер Next.js запускается с `HOSTNAME="0.0.0.0"` и `PORT="3000"`.
- **Финансовая безопасность & Ledger:** Все изменения баланса — строго через `WalletOps` в BigInt (копейки) с `idempotencyKey` и `auditAdminAwaitable()`. Ledger-First: запись в леджер ДО мутации баланса. Запрещен Transaction Escape (`tx.*` внутри транзакций).
- **Безопасность секретов & Webhooks:** Fail-Closed (500 при отсутствии секрета, 401/403 при несовпадении подписи). Сравнение строго через `crypto.timingSafeEqual`. Запрещены секреты в клиентском бандле.
- **Zero-Trust & RBAC:** Guest-Proof проверки IDOR. Гранулярный RBAC через `requireStaffPermission()`. Зафиксирован `src/proxy.ts` (не `src/middleware.ts`).
- **Каталог & Shadow Catalog:** Сырые каталоги провайдеров буферизуются в Redis (`provider:{id}:catalog`). В PostgreSQL попадает только одобренное админом (Cherry-Pick). Розничные цены в UI — строго за 1 шт (`₽ / шт`).

---

## 3. Реестр модульных правил платформы (`.agents/rules/`)
Подробные нормативные регламенты платформы вынесены в специализированные модульные файлы (до 24 KB каждый для 100% совместимости с Google Antigravity без усечения контекста):
- 🏛️ [`.agents/rules/architecture-and-security.md`](.agents/rules/architecture-and-security.md) — Серверные границы, мульти-тенантность, леджер, вебхуки, Zero-Trust и Shadow Catalog.
- 🎨 [`.agents/rules/ui-ux-design-system.md`](.agents/rules/ui-ux-design-system.md) — Токены UI Forge Harness, UX форм, визард чекаута, Drip-Feed Floor, каталог, таблицы 100% ширины, фискализация 54-ФЗ.
- 🧹 [`.agents/rules/code-hygiene-lint.md`](.agents/rules/code-hygiene-lint.md) — Strict Types, No-Crutch Policy (анти-костыли), Server Actions, React 19 / Next.js 16.
- 🧠 [`.agents/rules/memory-and-swarms.md`](.agents/rules/memory-and-swarms.md) — 4-Tier Memory, GraphRAG (:8100), Состязательный аудит Red Team, Zero-Hallucination 3-Tier Hierarchy.
- 🛡️ [`.agents/rules/security-and-postmortem.md`](.agents/rules/security-and-postmortem.md) — Pentest Immunity (OWASP Top 10:2025, PCI DSS 4.0), RFC 9116/9331, Production Post-Mortem Hard Invariants.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
