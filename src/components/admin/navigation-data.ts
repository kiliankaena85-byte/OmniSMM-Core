/**
 * Domain alias map: maps sub-routes that are NOT directly listed in ADMIN_NAVIGATION
 * to their logical sidebar parent domain. This prevents "ghost page" disappearance
 * (sidebar losing all highlights) when navigating to these routes.
 *
 * Key   = route prefix (or exact path)
 * Value = the sidebar href that should be highlighted
 */
export const SIDEBAR_DOMAIN_ALIASES: Record<string, string> = {
  // Operations domain
  '/admin/refills':       '/admin/orders',
  '/admin/smart':         '/admin/orders',
  '/admin/docs':          '/admin/orders',
  // Clients domain
  '/admin/testers':       '/admin/clients',
  // Finance domain
  '/admin/marketing':     '/admin/finance',
  '/admin/fraud-monitor': '/admin/finance',
  // Catalog domain
  '/admin/services':      '/admin/catalog',
  // Analytics domain
  '/admin/economics':     '/admin/analytics',
  // Settings domain
  '/admin/tenants':       '/admin/settings',
  '/admin/pages':         '/admin/settings',
  '/admin/knowledge':     '/admin/settings',
  '/admin/system':        '/admin/settings',
  '/admin/staff':         '/admin/settings',
  '/admin/cms':           '/admin/settings',
  '/admin/manual':        '/admin/settings',
};

/**
 * Resolves the canonical sidebar href for the current pathname.
 * For routes in SIDEBAR_DOMAIN_ALIASES, returns the aliased parent sidebar href.
 * Otherwise returns the clean pathname unchanged.
 */
export function resolveSidebarDomain(pathname: string | null | undefined): string {
  if (!pathname) return '';
  const [cleanPath] = pathname.split('?');
  if (SIDEBAR_DOMAIN_ALIASES[cleanPath]) return SIDEBAR_DOMAIN_ALIASES[cleanPath];
  // Prefix match — longest match wins
  let bestMatch = '';
  for (const prefix of Object.keys(SIDEBAR_DOMAIN_ALIASES)) {
    if ((cleanPath.startsWith(prefix + '/') || cleanPath === prefix) && prefix.length > bestMatch.length) {
      bestMatch = prefix;
    }
  }
  return bestMatch ? SIDEBAR_DOMAIN_ALIASES[bestMatch] : cleanPath;
}

/**
 * Calculates whether a navigation item is active using the Best Match Rule.
 * Pass resolvedPathname (from resolveSidebarDomain) to support ghost-page aliasing.
 */
export function isNavTabActive(
  pathname: string | null | undefined,
  tabHref: string,
  allHrefs: string[],
  resolvedPathname?: string,
): boolean {
  if (!pathname) return false;

  // Use the domain-resolved pathname if provided
  const effectivePathname = resolvedPathname ?? pathname;

  if (effectivePathname === tabHref) return true;

  const [cleanTabPath] = tabHref.split('?');
  const [cleanCurrentPath] = effectivePathname.split('?');
  if (cleanCurrentPath === cleanTabPath && !tabHref.includes('?')) {
    const hasSpecificQueryMatch = allHrefs.some((otherHref) => otherHref !== tabHref && otherHref === effectivePathname);
    if (hasSpecificQueryMatch) return false;
    const hasAnyQueryVariantInTabs = allHrefs.some((otherHref) => otherHref.startsWith(cleanTabPath + '?'));
    if (hasAnyQueryVariantInTabs && effectivePathname.includes('?')) return false;
    return true;
  }
  if (cleanTabPath === '/admin/dashboard' || cleanTabPath === '/admin') return cleanCurrentPath === cleanTabPath;

  const isPrefixMatch = cleanCurrentPath.startsWith(cleanTabPath + '/');
  if (!isPrefixMatch) return false;

  const hasMoreSpecificMatch = allHrefs.some((otherHref) => {
    if (otherHref === tabHref) return false;
    const [cleanOther] = otherHref.split('?');
    if (cleanOther === cleanTabPath) return false;
    const isChild = cleanOther.startsWith(cleanTabPath + '/');
    if (!isChild) return false;
    return cleanCurrentPath === cleanOther || cleanCurrentPath.startsWith(cleanOther + '/');
  });

  return !hasMoreSpecificMatch;
}

export const OPERATIONS_TABS = [
  { label: 'Сводка дашборда', href: '/admin/dashboard' },
  { label: 'Заказы клиентов', href: '/admin/orders' },
  { label: 'Заявки на докрутку', href: '/admin/refills' },
  { label: 'Умный Dripfeed', href: '/admin/smart' },
  { label: 'Тикеты поддержки', href: '/admin/tickets' },
];

export const CLIENTS_TABS = [
  { label: 'База клиентов', href: '/admin/clients' },
  { label: 'Тестировщики (Инвайты)', href: '/admin/testers' },
];

export const FINANCE_TABS = [
  { label: 'Финансы & P&L', href: '/admin/finance' },
  { label: 'Транзакции (Ledger)', href: '/admin/transactions' },
  { label: 'Казначейство & Банк', href: '/admin/finance/treasury' },
  { label: 'Заявки на баланс', href: '/admin/finance/balance-requests' },
  { label: 'Маркетинг и промокоды', href: '/admin/marketing' },
];

export const CATALOG_TABS = [
  { label: 'Каталог услуг', href: '/admin/catalog' },
  { label: 'Категории & Соцсети', href: '/admin/catalog/categories' },
  { label: 'Паттерны ссылок', href: '/admin/catalog/patterns' },
  { label: 'Карантин & Дрифт цен', href: '/admin/catalog/quarantine' },
];

// ✅ FIX [ADMIN-NAV-DOMAIN-2026]: Removed cross-domain link `/admin/settings?tab=proxy`.
// Proxy management lives under Настройки → Платежи и Каналы (SYSTEM_TABS).
// Replaced with in-domain Мониторинг tab so operators stay in Providers context.
export const PROVIDERS_TABS = [
  { label: 'Провайдеры API', href: '/admin/providers' },
  { label: 'Импорт услуг', href: '/admin/providers/import' },
  { label: 'Мониторинг & Здоровье', href: '/admin/providers/health' },
];

export const SYSTEM_TABS = [
  { label: 'Глобальные настройки', href: '/admin/settings' },
  { label: 'Telegram Бот', href: '/admin/settings?tab=telegram' },
  { label: 'Прокси провайдеров', href: '/admin/settings?tab=proxy' },
  { label: 'Роли и права', href: '/admin/settings/roles' },
  { label: 'Бренды & Домены', href: '/admin/tenants' },
  { label: 'CMS Страницы', href: '/admin/pages' },
  { label: 'Статьи блога', href: '/admin/knowledge' },
  { label: 'Фичи (Flags)', href: '/admin/system/features' },
  { label: 'Системные логи', href: '/admin/system/logs' },
  { label: 'Учебник & Инструкция', href: '/admin/manual' },
];

export const ONBOARDING_CONFIGS = {
  dashboard: {
    description: 'Оперативный центр мониторинга платформы. Здесь выводятся ключевые финансовые метрики (выручка, чистая прибыль, обязательства), активность заказов и статус балансов у провайдеров API.',
    faqs: [
      { q: 'Что такое Обязательства (Liability)?', a: 'Сумма балансов всех клиентов в рублях. Это деньги, которые пользователи завели на платформу, но еще не потратили.' },
      { q: 'Как рассчитывается Чистая прибыль?', a: 'Выручка (Gross) минус комиссии эквайринга (3%), минус себестоимость у провайдеров (COGS) и налог УСН.' },
    ],
    docLink: '/admin/manual#5-административная-панель'
  },
  orders: {
    description: 'Реестр всех заказов на платформе. Вы можете искать заказы по номеру ID, ссылке, email клиента или фильтровать по статусу.',
    faqs: [
      { q: 'Что делать, если статус заказа "ERROR"?', a: 'Это значит, что провайдер отклонил запрос или вернул ошибку. Вы можете отменить заказ (средства вернутся клиенту) или перезапустить его.' },
      { q: 'Как работает частичный возврат (Partial)?', a: 'Если заказ выполнен частично, при смене статуса на PARTIAL или COMPLETE система автоматически вернет клиенту сдачу за недолитые единицы.' },
    ],
    docLink: '/admin/manual#3-система-заказов'
  },
  refills: {
    description: 'Управление заявками на докрутку (Refill) при списании показателей. Клиент может запросить докрутку по гарантии прямо из своего кабинета.',
    faqs: [
      { q: 'Зачем нужны кнопки действий?', a: '🔄 Перезапустить отправляет запрос провайдеру повторно. ✅ Выполнить и 🚫 Отклонить позволяют закрыть заявку вручную, если авто-задача зависла.' },
      { q: 'Почему кнопка Перезапустить недоступна?', a: 'Кнопка скрыта для докруток, которые уже находятся в статусе COMPLETED (успешно завершены).' },
    ],
    docLink: '/admin/manual#3-система-заказов'
  },
  tickets: {
    description: 'Рабочая панель службы поддержки. Позволяет операторам отвечать на вопросы клиентов и начислять компенсации в случае сбоев.',
    faqs: [
      { q: 'Как работают компенсации?', a: 'Оператор может начислить бонусные рубли клиенту прямо в тикете. Общая сумма трат за день ограничена лимитом (supportLimitCents) оператора.' },
      { q: 'Что такое шаблоны ответов?', a: 'Быстрые заготовки ответов для частых вопросов. Их можно редактировать в настройках.' },
    ],
    docLink: '/admin/manual#8-техподдержка-полный-регламент'
  },
  clients: {
    description: 'Список зарегистрированных пользователей платформы. Вы можете редактировать балансы, выдавать персональные скидки и банить нарушителей.',
    faqs: [
      { q: 'Как работает кнопка "Войти как клиент"?', a: 'Вы авторизуетесь под учетной записью клиента в отдельной вкладке, чтобы увидеть интерфейс платформы его глазами.' },
      { q: 'Как начислить или списать баланс?', a: 'Используйте блок Корректировка баланса. Сумма указывается в копейках. Для списания введите отрицательное число (например, -5000 = списать 50 ₽).' },
    ],
    docLink: '/admin/manual#5-административная-панель'
  },
  finance: {
    description: 'Журнал транзакций, реестр всех пополнений баланса через платежные шлюзы и ручные корректировки.',
    faqs: [
      { q: 'Что такое Карантин транзакций?', a: 'Все начисления или списания свыше установленного лимита безопасности уходят в карантин и требуют ручного подтверждения Владельцем.' },
      { q: 'Где посмотреть статус платежа YooKassa?', a: 'Статус синхронизируется автоматически по вебхукам. В таблице вы можете увидеть исходный transaction ID и детали шлюза.' },
    ],
    docLink: '/admin/manual#4-платёжная-система'
  },
  marketing: {
    description: 'Управление маркетинговыми инструментами: создание купонов на скидку (DISCOUNT) или ваучеров на баланс (VOUCHER).',
    faqs: [
      { q: 'В чем разница между ваучером и скидкой?', a: 'Ваучер начисляет фиксированную сумму в рублях на баланс клиента при активации. Скидка снижает розничную цену на услуги на заданный процент.' },
      { q: 'Как работают лимиты использований?', a: 'maxUses ограничивает, сколько раз суммарно все пользователи могут активировать данный промокод.' },
    ],
    docLink: '/admin/manual#10-внутренние-процессы'
  },
  catalog: {
    description: 'Каталог розничных услуг платформы. Вы можете настраивать наценки, менять привязанные категории и отключать услуги.',
    faqs: [
      { q: 'Как работает автокалькуляция цены?', a: 'Цена за 1 шт = (Цена провайдера за 1000 * наценка * курс USD) / 1000. В каталоге всегда отображается цена за 1 единицу.' },
      { q: 'Что такое Пакетное обновление наценки?', a: 'Вы можете выбрать категорию услуг и установить единую наценку в процентах для всех активных услуг в этой категории.' },
    ],
    docLink: '/admin/manual#6-провайдеры-и-каталог'
  },
  quarantine: {
    description: 'Карантин цен услуг. Сюда попадают услуги, у которых при автоматической синхронизации цена у провайдера резко подскочила.',
    faqs: [
      { q: 'Почему услуга попала в карантин?', a: 'Либо у провайдера цена выросла более чем на 20% (Price Spike), либо маржа упала ниже безопасного порога (Margin Floor Breach).' },
      { q: 'Как выпустить услугу из карантина?', a: 'Нажмите "Одобрить цену", чтобы принять новый тариф и автоматически пересчитать розничную стоимость для клиентов.' },
    ],
    docLink: '/admin/manual#6-провайдеры-и-каталог'
  },
  providers: {
    description: 'Интеграция с оптовыми SMM панелями по API. Система автоматически запрашивает у них тарифы, размещает заказы и проверяет статусы.',
    faqs: [
      { q: 'Как импортировать новые услуги?', a: 'Перейдите на вкладку Импорт, выберите провайдера, отметьте нужные галочки в теневом каталоге Redis и запустите пакетный импорт.' },
      { q: 'Что делать при ошибке баланса провайдера?', a: 'Если баланс провайдера близок к нулю, заказы будут падать в статус ERROR. Пополните баланс на стороне провайдера.' },
    ],
    docLink: '/admin/manual#6-провайдеры-и-каталог'
  },
  settings: {
    description: 'Глобальная панель настроек SMMplan. Конфигурация платежных ключей, SMTP-сервера, курсов валют и ролей доступа персонала.',
    faqs: [
      { q: 'Как работает привязка StaffRole?', a: 'Для менеджеров и саппортов можно создать роль с гранулярными правами (только просмотр заказов, или только биллинг).' },
      { q: 'Зачем нужен курс доллара (exchangeRateUSD)?', a: 'Используется для пересчета USD-тарифов провайдеров в рубли при синхронизации каталога. Изменение курса вызовет фоновый пересчет цен.' },
    ],
    docLink: '/admin/manual#5-административная-панель'
  },
  smart: {
    description: 'Система постепенной отправки заказов провайдерам (Drip-feed). Разделяет крупные заказы на небольшие порции (чанки) с заданным интервалом для симуляции естественного роста.',
    faqs: [
      { q: 'Как работает интервал Drip-feed?', a: 'Каждый чанк отправляется провайдеру по расписанию с указанной задержкой (например, каждые 30 минут).' },
      { q: 'Что происходит при ошибке чанка?', a: 'Если один из чанков завершается с ошибкой у провайдера, кампания приостанавливается, а администратор получает уведомление.' },
    ],
    docLink: '/admin/manual#3-система-заказов'
  },
  pages: {
    description: 'Интерфейс управления текстовыми страницами сайта. Вы можете создавать и редактировать информационные страницы, такие как Условия использования, Оферта или Контакты.',
    faqs: [
      { q: 'Как изменить главную страницу?', a: 'Главная страница рендерится из шаблона, но ее разделы могут ссылаться на CMS страницы с конкретными slug (например, "privacy").' },
      { q: 'Поддерживается ли HTML/Markdown?', a: 'Да, при создании и редактировании страниц доступен текстовый редактор с поддержкой разметки.' },
    ],
    docLink: '/admin/manual#5-административная-панель'
  },
  knowledge: {
    description: 'Панель управления встроенным блогом и базой знаний. Здесь вы публикуете новости платформы, руководства по продвижению в соцсетях и инструкции для клиентов.',
    faqs: [
      { q: 'Что такое статус Черновик?', a: 'Статья в статусе черновика видна только администраторам в этой панели и скрыта с публичного сайта.' },
      { q: 'Как отслеживать просмотры?', a: 'Каждое посещение страницы статьи клиентом увеличивает счетчик viewCount в реальном времени.' },
    ],
    docLink: '/admin/manual#5-административная-панель'
  },
  features: {
    description: 'Панель управления фича-флагами. Позволяет мгновенно включать или отключать технические разделы платформы (например, Dripfeed, авто-докрутки или регистрацию) без необходимости деплоя.',
    faqs: [
      { q: 'Что будет, если отключить фичу?', a: 'Функционал мгновенно блокируется на уровне API / Server Actions и скрывается из пользовательского интерфейса.' },
      { q: 'Безопасно ли переключать флаги?', a: 'Да, это стандартный механизм безопасного выкатывания фич (Canary/Dark Launches). При обнаружении багов фичу можно отключить одной кнопкой.' },
    ],
    docLink: '/admin/manual#5-административная-панель'
  },
  logs: {
    description: 'Централизованный аудит, журнал системных логов и событий безопасности платформы. Включает мониторинг аномалий, историю авторизаций, журнал действий администраторов и сбои Telegram-шлюза.',
    faqs: [
      { q: 'Как часто обновляются логи?', a: 'Логи пишутся напрямую в базу данных в реальном времени. Кнопка «Обновить» перезапрашивает свежие данные без перезагрузки всей страницы.' },
      { q: 'Маскируются ли пароли и токены в деталях?', a: 'Да, все чувствительные данные (пароли, Bearer токены, API ключи) автоматически очищаются и заменяются на [REDACTED] перед выводом.' },
      { q: 'Что означает статус CRITICAL в безопасности?', a: 'Критическое нарушение безопасности (например, подделка HMAC-подписи платежного вебхука или попытка replay-атаки). Требует немедленного внимания.' },
    ],
    docLink: '/admin/manual#5-административная-панель'
  }
};
