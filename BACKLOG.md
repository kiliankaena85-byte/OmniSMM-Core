# 📋 BACKLOG SMMplan / SMMflux (v1.6)

Полный структурированный бэклог проекта SMMplan / SMMflux, актуализированный по результатам ревизии кодовой базы.

---

## 📊 1. Сводная таблица задач и текущего статуса

| ID | Задача | Эпик | Приоритет | Оценка | Статус |
|---|---|---|---|---|---|
| **LEGAL-001** | Правки оферты v3.0 | Legal | **P0** | S (1-2ч) | ✅ **DONE** (Код + БД) |
| **LEGAL-002** | /legal/refund (Политика возвратов) | Legal | **P0** | M (3-5ч) | ✅ **DONE** (Текст ЗоЗПП/ФПР + БД) |
| **LEGAL-003** | /legal/cookies (Политика Cookies) | Legal | **P0** | S (1-2ч) | ✅ **DONE** (Таблицы session/ym + БД) |
| **LEGAL-004** | /legal/service-rules + тематики | Legal | **P0** | L (1-2д) | ✅ **DONE** (7 категорий + SLA + БД) |
| **LEGAL-005** | /legal/anti-fraud | Legal | P1 | M (3-5ч) | ⏳ IN_BACKLOG |
| **LEGAL-006** | /legal/reseller-terms | Legal | P1 | M (3-5ч) | ⏳ IN_BACKLOG |
| **LEGAL-007** | Fallback для legal pages + Canonical | Legal | **P0** | M (3-5ч) | ✅ **DONE** (DB → TS Fallback + Canonical) |
| **LEGAL-008** | Cookie-баннер | Legal | P1 | M (3-5ч) | ⏳ IN_BACKLOG |
| **LEGAL-009** | MegaFooter ссылки на все /legal/* | Legal | P1 | S (1-2ч) | ✅ **DONE** (Все 5 юридических страниц) |
| **LEGAL-010** | Уведомление Роскомнадзора (152-ФЗ) | Legal | **P0** | S (1-2ч) | ✋ MANUAL_ACTION |
| **LEGAL-011** | Приказ об ответственном ПДн | Legal | P1 | S (1-2ч) | ⏳ IN_BACKLOG |
| **LEGAL-012** | Реестр обработки ПДн | Legal | P1 | M (3-5ч) | ⏳ IN_BACKLOG |
| **LEGAL-013** | Чекбокс ПДн при регистрации | Legal | **P0** | S (1-2ч) | ✅ **DONE** (Варианты LegalCheckbox 152-ФЗ) |
| **LEGAL-014** | Дисклеймер Meta (Instagram/FB) | Legal | **P0** | S (1-2ч) | ✅ **DONE** (Предупреждение 21.03.2022) |
| **LEGAL-015** | Дисклеймер международного сервиса | Legal | P1 | S (1-2ч) | 🟡 IN_PROGRESS |
| **LEGAL-016** | Оплата по расчётному счёту (B2B) | Legal | P2 | L (1-2д) | ⏳ IN_BACKLOG |
| **QA-001** | E2E тесты — Auth Flow | QA | **P0** | M (3-5ч) | ⏳ IN_BACKLOG |
| **QA-002** | E2E тесты — Order Flow | QA | **P0** | L (1-2д) | ⏳ IN_BACKLOG |
| **QA-003** | E2E тесты — Balance Flow | QA | P1 | M (3-5ч) | ⏳ IN_BACKLOG |
| **QA-004** | E2E тесты — Admin Panel | QA | P1 | M (3-5ч) | ⏳ IN_BACKLOG |
| **QA-005** | E2E тесты — SEO Metadata | QA | P1 | M (3-5ч) | ⏳ IN_BACKLOG |
| **QA-006** | E2E тесты — Legal Pages | QA | P1 | S (1-2ч) | ⏳ IN_BACKLOG |
| **QA-007** | Bug Bash (Сквозное тестирование) | QA | P1 | XL (2-5д) | ⏳ IN_BACKLOG |
| **DEPLOY-001** | Docker production compose | Deploy | **P0** | L (1-2д) | 🟡 IN_PROGRESS (БД, RAG, Redis запущены) |
| **DEPLOY-002** | Nginx production config | Deploy | **P0** | M (3-5ч) | ⏳ IN_BACKLOG |
| **DEPLOY-003** | Настройка DNS | Deploy | **P0** | S (1-2ч) | ⏳ IN_BACKLOG |
| **DEPLOY-004** | SSL сертификат (Let's Encrypt) | Deploy | **P0** | S (1-2ч) | ⏳ IN_BACKLOG |
| **DEPLOY-005** | Prisma migrate deploy | Deploy | **P0** | S (1-2ч) | 🟡 IN_PROGRESS |
| **DEPLOY-006** | Seed production данных | Deploy | **P0** | S (1-2ч) | 🟡 IN_PROGRESS |
| **DEPLOY-007** | Yandex Webmaster + GSC | Deploy | P1 | S (1-2ч) | ⏳ IN_BACKLOG |
| **DEPLOY-008** | Monitoring + Backups | Deploy | P1 | L (1-2д) | ⏳ IN_BACKLOG |
| **DEPLOY-009** | Anti-DDoS интеграция | Deploy | P1 | XL (2-5д) | ⏳ IN_BACKLOG |
| **DEPLOY-010** | Penetration Test (OWASP Top 10) | Deploy | P2 | XL (2-5д) | ⏳ IN_BACKLOG |
| **SEO-001** | Pillar pages — наполнение контентом | Growth | P1 | XL (2-5д) | ⏳ IN_BACKLOG |
| **SEO-002** | Cluster articles (20-40 статей) | Growth | P2 | XL (2-5д) | ⏳ IN_BACKLOG |
| **SEO-003** | Glossary — наполнение терминами | Growth | P2 | L (1-2д) | ⏳ IN_BACKLOG |
| **SEO-004** | Case studies (2-3 кейса) | Growth | P2 | M (3-5ч) | ⏳ IN_BACKLOG |
| **SEO-005** | CWV optimization (LCP/INP/CLS) | Growth | P2 | L (1-2д) | ⏳ IN_BACKLOG |
| **SEO-006** | Link building / Digital PR | Growth | P3 | XL (2-5д) | ⏳ IN_BACKLOG |
| **SEO-007** | Контент-план (ежемесячный) | Growth | P3 | M (3-5ч) | ⏳ IN_BACKLOG |
| **PROD-001** | A/B testing landing pages | Product | P3 | L (1-2д) | ⏳ IN_BACKLOG |
| **PROD-002** | Партнёрская программа (расширение) | Product | P3 | L (1-2д) | ⏳ IN_BACKLOG |
| **PROD-003** | Telegram-канал | Product | P3 | M (3-5ч) | ⏳ IN_BACKLOG |
| **PROD-004** | Multi-language (EN) | Product | P3 | XL (2-5д) | ⏳ IN_BACKLOG |
| **PROD-005** | Мобильное приложение (PWA) | Product | P3 | XL (2-5д) | ⏳ IN_BACKLOG |
| **TECH-001** | Убрать ignoreBuildErrors: true | Tech Debt | P1 | L (1-2д) | ⏳ IN_BACKLOG |
| **TECH-002** | Убрать eslint-disable без TODO | Tech Debt | P2 | M (3-5ч) | ⏳ IN_BACKLOG |
| **TECH-003** | Убрать console.log из production | Tech Debt | P2 | M (3-5ч) | 🟡 IN_PROGRESS |
| **TECH-004** | CryptoBot — решение по 54-ФЗ | Tech Debt | P1 | M (3-5ч) | ⏳ IN_BACKLOG |
| **TECH-005** | Переименовать Lovable в UI | Tech Debt | P2 | S (1-2ч) | 🟡 IN_PROGRESS (95% готово) |
| **TECH-006** | Content filter (запрещенные слова) | Tech Debt | P1 | M (3-5ч) | ⏳ IN_BACKLOG |
| **SEC-001** | Redis Auth & TLS Hardening (REDIS_PASSWORD, rediss://) | Security | **P0 (Prod Gate)** | S (1-2ч) | ✅ **DONE** (validateRedisUrl + Fail-Closed) |
| **SEC-002** | CSP Strict-Dynamic Migration (Устранение unsafe-inline/eval) | Security | **P0 (Prod Gate)** | M (3-5ч) | ✅ **DONE** (buildCspHeader + Nonce + 0 unsafe) |
| **SEC-003** | Production Direct SMTP Setup & Verification (Без TUN/прокси) | Security | **P0 (Prod Gate)** | S (1-2ч) | ✅ **DONE** (verifyDirectSmtpConnection + SMTPS 465) |
| **STRAT-001** | Smart Upsell Bundles в UnifiedLinkEngine | Strategy | P1 | M (3-5ч) | ⏳ IN_BACKLOG |
| **STRAT-002** | Виджет экспресс-аудита каналов (/audit) для SEO | Strategy | P1 | L (1-2д) | ⏳ IN_BACKLOG |
| **STRAT-003** | B2B Reseller Portal & API (CustomerGroup) | Strategy | P2 | L (1-2д) | ⏳ IN_BACKLOG |
| **STRAT-004** | Real-time Provider Balance Check в SmartRouting | Strategy | P1 | S (1-2ч) | ⏳ IN_BACKLOG |
| **STRAT-005** | Шардирование воркера sync.processor.ts (>10k orders) | Strategy | P2 | M (3-5ч) | ⏳ IN_BACKLOG |

---

## 📝 2. Детальное описание выполненных и выполняемых задач

### ✅ ВЫПОЛНЕННЫЕ ЗАДАЧИ:

1. **[LEGAL-001] Правки оферты v3.0 (Статус: DONE)**
2. **[LEGAL-002] /legal/refund — Политика возвратов (Статус: DONE)**
3. **[LEGAL-003] /legal/cookies — Политика использования файлов Cookie (Статус: DONE)**
4. **[LEGAL-004] /legal/service-rules — Правила сервиса (Статус: DONE)**
5. **[LEGAL-007] Fallback для legal pages + Absolute Canonical (Статус: DONE)**
6. **[LEGAL-009] MegaFooter ссылки на все /legal/* (Статус: DONE)**
7. **[LEGAL-013] Чекбоксы согласия с ПДн (152-ФЗ) (Статус: DONE)**
8. **[LEGAL-014] Дисклеймер Meta на страницах Instagram/Facebook (Статус: DONE)**

---

### 🔒 ЗАДАЧИ БЕЗОПАСНОСТИ ДЛЯ ВЫКАТКИ В ПРОДАКШН (MANDATORY PRODUCTION ROLLOUT GATE — 100% COMPLETE):

1. **[SEC-001] Redis Authentication & TLS Hardening (Статус: DONE)**
   - **Контекст:** В логах контейнера веб-сервера выводится предупреждение о работе Redis без явного пароля и TLS (`rediss://`).
   - **Что сделать при выкатке:**
     - В `docker-compose.prod.yml` / Kubernetes сконфигурировать защищенный пароль Redis (`requirepass ${REDIS_PASSWORD}`).
     - В `.env.production` прописать `REDIS_URL=rediss://default:${REDIS_PASSWORD}@...` или настроить TLS-терминацию.
     - Убедиться, что `smmplan_web` и `smmplan_lite_worker` подключаются с аутентификацией.

2. **[SEC-002] Content Security Policy (CSP) Strict-Dynamic Migration (Статус: DONE)**
   - **Контекст:** В `src/proxy.ts` директива `script-src` содержит `'unsafe-inline'` и `'unsafe-eval'` для совместимости с бандлером Turbopack и динамическими стилями Recharts/React 19.
   - **Что сделано:**
     - Выделен `buildCspHeader`, из `script-src` полностью устранены `'unsafe-inline'` и `'unsafe-eval'`.
     - Внедрен `'nonce-${nonce}'` и `'strict-dynamic'` с белым списком эквайринга и Cloudflare.

3. **[SEC-003] Production Direct SMTP Setup & Verification (Статус: DONE)**
   - **Контекст:** На локальной Windows-машине активен VPN/TUN-прокси (Mihomo/Clash `198.18.0.1`), который перехватывает исходящий трафик на порт 465 к `smtp.yandex.ru`.
   - **Что сделано:**
     - Реализован `verifyDirectSmtpConnection` для прямого TLS-пробинга SMTPS порта 465 (Yandex / Mail.ru).
     - Доказана прямая доставка и сетевая доступность без прокси (Yandex: 95ms, Mail.ru: 69ms).

---

### 🚀 СТРАТЕГИЧЕСКИЕ ИНИЦИАТИВЫ РОСТА И МОНЕТИЗАЦИИ (STRATEGY & GROWTH BACKLOG):

1. **[STRAT-001] Smart Upsell Bundles при детекции ссылки (Статус: IN_BACKLOG)**
   - **Контекст:** В `src/services/link-engine/unified-link-engine.ts` и `target-type-mapper.ts` уже есть точное распознавание типов сущностей (`POST`, `CHANNEL`, `VIDEO`, `REEL`).
   - **Что сделать:**
     - При вводе ссылки на пост в `SmmplanOrderWizard.tsx` формировать рекомендацию умного комбо-пакета («Вывод в ТОП: 1 500 просмотров + 100 реакций + 25 репостов»).
     - Скидка клиенту 10-15%, валовая маржинальность сервиса $\ge 80\%$.
     - Прогнозируемый рост среднего чека (AOV) на 30–45%.

2. **[STRAT-002] Публичный экспресс-аудит каналов и постов `/audit` (Статус: IN_BACKLOG)**
   - **Контекст:** `IntelligenceLinkAnalyzer` может работать без обязательной авторизации пользователя для проверки открытости профиля, формата контента и доступности.
   - **Что сделать:**
     - Создать открытую SEO-посадочную страницу `/audit` с полем ввода ссылки.
     - Бесплатный анализ параметров канала/поста с кнопкой быстрого чекаута рекомендованных тарифов.
     - Снижение CAC (стоимости привлечения) на 40–50% за счет органического вирусного трафика.

3. **[STRAT-003] B2B Reseller Portal & API Tier (Статус: IN_BACKLOG)**
   - **Контекст:** В `prisma/schema.prisma` уже присутствуют `ApiConfig` (`apiKeyHash`, `customLimitCents`, `webhookUrl`) и `CustomerGroup`.
   - **Что сделать:**
     - Создать в кабинете `/dashboard/api` интерфейс выпуска API ключей и документации Reseller API v2.
     - Настроить дисконтные сетки в `CustomerGroup` для оптовых реселлеров и агентств.
     - Обеспечить стабильный оборотный поток без маркетинговых затрат.

4. **[STRAT-004] Real-time Provider Balance Check в SmartRoutingService (Статус: IN_BACKLOG)**
   - **Контекст:** В `src/workers/processors/order.processor.ts` при сбое основного поставщика `SmartRoutingService` переключает заказ на резервный маршрут, но не проверяет остаток на аккаунте целевого поставщика.
   - **Что сделать:**
     - Сохранять кэшированный баланс провайдера в Redis с TTL 60 сек.
     - Перед переключением маршрута проверять достаточность баланса; при нулевом балансе пропускать маршрут к следующему вендору.

5. **[STRAT-005] Шардирование воркера статусов `sync.processor.ts` (Статус: IN_BACKLOG)**
   - **Контекст:** При росте количества одновременных заказов свыше 10 000 лимит `take: 1000` в `sync.processor.ts` может создавать задержку смены статусов.
   - **Что сделать:**
     - Реализовать распределение очередей BullMQ по провайдерам (`sync-provider-{id}`) для параллельной обработки.


---

## 🚨 5. Критические находки пост-деплой аудита (2026-10-03, v1.7)

| ID | Задача | Эпик | Приоритет | Статус |
|---|---|---|---|---|
| **SEC-001** | RBAC-bypass в `src/actions/admin/tester-invites.ts`: `requireStaffPermission` вызывался без callback, отказ игнорировался → любой мог генерировать/отзывать инвайты и выставлять `isTester`. | Security | **P0** | 🟡 Исправлено в ветке `fix/post-deploy-db-pool-and-sync-noise` (e15d0f2), **не смёрджено**. Проверить, был ли код в проде (образ собран ~18:13, до `908bba0`). |
| **TECH-001** | `main` (коммит `908bba0`) не компилируется (TS1005 в `provider-balance.service.ts`, `order-timeseries.service.ts`). Пересборка из `main` упадёт. | Tech Debt | **P0** | 🟡 Исправлено в ветке (5eeea27), ждёт merge. |
| **OPS-001** | Пул Prisma: 49/60 соединений PG при 4 cluster-воркерах. | Ops | P1 | 🟡 Исправлено в ветке (`db-pool-size.ts`, бюджет 36). Нужен нагрузочный тест на Stage `:3005` по BGS-2026. |
| **OPS-002** | Stream-Promotion: `Incorrect order ID` для заказов `cmur67n3d0009vainvulm8g85`, `cmur67n3r000bvainbpio1bmp`, `cmur67n7t000vvain561wzlwp` — зависли в `IN_PROGRESS`, опрос каждые 5 мин. | Ops | P1 | ✋ MANUAL_ACTION (решение: отмена/возврат). Шум логов снижен троттлингом. |
| **SEC-002** | `src/app/api/depin/auth/route.ts`: вызывался несуществующий `tokenResolver.resolveBotToken`, TypeError глотался → всегда env-токен. Теперь `resolveTelegramToken(tenantId)` (смена поведения). | Security | P1 | 🟡 В ветке. Проверить токены тенантов перед выкаткой. |
| **QA-008** | `scripts/smoke-live-container.ts` пишет в БД (isTester, заказ #158125, `WalletOps.charge` 100 ₽). Сделать read-only или направить на тестовую БД; проверить/очистить тестовые данные, если `.env` указывал на прод. | QA | P1 | ⏳ IN_BACKLOG |
| **TECH-002** | `lint-zero-any`: 55 нарушений в ~13 файлах (UI `tester-invites*`, `catalog-cache.service.ts`, тесты). | Tech Debt | P1 | ⏳ IN_BACKLOG |
| **FIN-001** | B4 `referralDebit`: семантика реферального овердрафта (из `SPEC-REDTEAM-FIN-CORE-2026`). | Finance | P1 | ⏳ IN_BACKLOG |
| **QA-009** | Тесты с `test/setup.ts` бьют в БД: 5–35 с на тест, `Hook timed out`/таймауты в `provider-balance` (stress-тесты) при нагрузке CPU. | QA | P2 | ⏳ IN_BACKLOG |
| **SEC-003** | HSTS не подтверждён на публичном домене (на `127.0.0.1` отсутствует). | Security | P2 | ⏳ IN_BACKLOG |
