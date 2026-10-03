import { PrismaClient } from '@prisma/client';
import { VaultService } from '../src/lib/vault';

const prisma = new PrismaClient();

const USD_TO_RUB = 95.0;

export interface ServiceSeedItem {
  name: string;
  categoryName: string;
  networkSlug: string;
  retailUnitRub: number;
  rateUsd: number;
  markup: number;
  minQty: number;
  maxQty: number;
  isRefillEnabled: boolean;
  targetType: 'CHANNEL' | 'POST' | 'PROFILE' | 'STORY' | 'CUSTOM';
  startSpeed: string;
  speedPerDay: string;
  audience: string;
  warranty: string;
  clientReq: string;
  badge?: string;
}

function makeService(
  networkSlug: string,
  categoryName: string,
  name: string,
  retailRub: number,
  rateUsd: number,
  minQty: number,
  maxQty: number,
  targetType: 'CHANNEL' | 'POST' | 'PROFILE' | 'STORY' | 'CUSTOM',
  startSpeed: string,
  speedPerDay: string,
  audience: string,
  warranty: string,
  clientReq: string,
  badge?: string
): ServiceSeedItem {
  const purchaseCostUnitRub = (rateUsd * USD_TO_RUB) / 1000;
  const markup = Math.max(10.0, +(retailRub / Math.max(0.0001, purchaseCostUnitRub)).toFixed(2));
  return {
    name,
    categoryName,
    networkSlug,
    retailUnitRub: +retailRub.toFixed(2),
    rateUsd,
    markup,
    minQty,
    maxQty,
    isRefillEnabled: warranty.toLowerCase().includes('гарант') || warranty.toLowerCase().includes('refill') || warranty.toLowerCase().includes('дней') || warranty.toLowerCase().includes('год'),
    targetType,
    startSpeed,
    speedPerDay,
    audience,
    warranty,
    clientReq,
    badge,
  };
}

export function generateMassiveEnterpriseCatalog(): ServiceSeedItem[] {
  const items: ServiceSeedItem[] = [];

  // ══════════════════════════════════════════════════════════════
  // 1. TELEGRAM (~320 услуг)
  // ══════════════════════════════════════════════════════════════
  const tgGeos = [
    { geo: 'РФ (Россия)', code: 'RU', priceMult: 1.0, rate: 0.65 },
    { geo: 'СНГ (Микс стран)', code: 'CIS', priceMult: 0.85, rate: 0.55 },
    { geo: 'США (USA High Quality)', code: 'USA', priceMult: 1.4, rate: 0.95 },
    { geo: 'Великобритания (UK)', code: 'UK', priceMult: 1.5, rate: 1.05 },
    { geo: 'Германия (DE)', code: 'DE', priceMult: 1.5, rate: 1.05 },
    { geo: 'Франция (FR)', code: 'FR', priceMult: 1.4, rate: 0.98 },
    { geo: 'Испания (ES)', code: 'ES', priceMult: 1.3, rate: 0.90 },
    { geo: 'Италия (IT)', code: 'IT', priceMult: 1.3, rate: 0.90 },
    { geo: 'Узбекистан (UZ)', code: 'UZ', priceMult: 0.9, rate: 0.60 },
    { geo: 'Казахстан (KZ)', code: 'KZ', priceMult: 0.95, rate: 0.62 },
    { geo: 'Иран (IR)', code: 'IR', priceMult: 0.55, rate: 0.35 },
    { geo: 'Индия (IN)', code: 'IN', priceMult: 0.45, rate: 0.28 },
    { geo: 'Турция (TR)', code: 'TR', priceMult: 1.1, rate: 0.75 },
    { geo: 'Бразилия (BR)', code: 'BR', priceMult: 0.9, rate: 0.60 },
    { geo: 'Арабские страны (ARAB / ОАЭ)', code: 'ARAB', priceMult: 1.3, rate: 0.85 },
    { geo: 'Египет (EG)', code: 'EG', priceMult: 0.8, rate: 0.50 },
    { geo: 'Вьетнам (VN)', code: 'VN', priceMult: 0.6, rate: 0.38 },
    { geo: 'Индонезия (ID)', code: 'ID', priceMult: 0.6, rate: 0.38 },
    { geo: 'Китай (CN)', code: 'CN', priceMult: 1.2, rate: 0.80 },
    { geo: 'Крипто-аудитория (Crypto Niche)', code: 'CRYPTO', priceMult: 1.8, rate: 1.40 },
  ];

  const tgTiers = [
    { tier: 'Эконом (Быстрый старт, без гарантии)', mult: 0.45, warranty: 'Без гарантии', badge: '⚡️ Эконом', min: 10, max: 100000 },
    { tier: 'Стандарт (Офферы, гарантия 30 дней)', mult: 1.0, warranty: '30 дней Refill', badge: '🛡️ 30d Refill', min: 10, max: 50000 },
    { tier: 'HQ Живые (Низкий отток, гарантия 60 дней)', mult: 1.5, warranty: '60 дней Refill', badge: '💎 HQ 60d', min: 25, max: 30000 },
    { tier: 'Премиум (Реальные профили, гарантия 90 дней)', mult: 2.1, warranty: '90 дней Refill', badge: '👑 Премиум 90d', min: 50, max: 20000 },
    { tier: 'VIP Ultra (0% отписок, гарантия 365 дней / 1 год)', mult: 3.2, warranty: '365 дней 100% гарантия', badge: '⭐️ VIP 1 Год', min: 50, max: 10000 },
    { tier: 'Для Приватных каналов (t.me/+ ссылки)', mult: 1.3, warranty: '30 дней Refill', badge: '🔒 Приватные', min: 10, max: 30000 },
    { tier: 'Женская аудитория (Только девушки)', mult: 1.4, warranty: '30 дней Refill', badge: '👩 Женские', min: 20, max: 15000 },
    { tier: 'Мужская аудитория (Только мужчины)', mult: 1.4, warranty: '30 дней Refill', badge: '👨 Мужские', min: 20, max: 15000 },
    { tier: 'Скоростные (50 000 в сутки для мгновенного буста)', mult: 0.8, warranty: '15 дней Refill', badge: '🚀 50k/день', min: 100, max: 200000 },
    { tier: 'Медленные капельные (Drip-feed 300-500 в сутки)', mult: 1.2, warranty: '30 дней Refill', badge: '💧 Капельные', min: 50, max: 20000 },
  ];

  for (const geo of tgGeos) {
    for (const t of tgTiers) {
      const basePrice = 0.62 * geo.priceMult * t.mult;
      const baseRate = geo.rate * t.mult;
      items.push(
        makeService(
          'telegram',
          'Подписчики',
          `Telegram: Подписчики [${geo.geo}] — ${t.tier}`,
          Math.max(0.18, basePrice),
          Math.max(0.15, baseRate),
          t.min,
          t.max,
          'CHANNEL',
          '5–20 минут',
          'до 5 000 – 50 000 в сутки',
          `Целевые подписчики из региона ${geo.geo}. Высокое качество аккаунтов.`,
          t.warranty,
          'Ссылка на открытый канал/группу (или приватная t.me/+ для закрытых)',
          t.badge
        )
      );
    }
  }

  // Telegram Views & Autoviews
  const tgViewsTypes = [
    { name: '1 пост (Быстрый охват)', target: 'POST' as const, rub: 0.02, rate: 0.001, badge: '⚡️ 1 Пост' },
    { name: '1 пост (С удержанием 15 сек)', target: 'POST' as const, rub: 0.03, rate: 0.002, badge: '⏱ Удержание 15s' },
    { name: '1 пост (С удержанием 30 сек)', target: 'POST' as const, rub: 0.04, rate: 0.003, badge: '⏱ Удержание 30s' },
    { name: '1 пост (С удержанием 60 сек)', target: 'POST' as const, rub: 0.07, rate: 0.005, badge: '⏱ Удержание 60s' },
    { name: '1 пост (С удержанием 5 минут)', target: 'POST' as const, rub: 0.15, rate: 0.012, badge: '⏱ Удержание 5m' },
    { name: '1 пост (С пересылкой в ЛС)', target: 'POST' as const, rub: 0.08, rate: 0.006, badge: '✉️ С пересылкой' },
    { name: 'Последние 3 поста', target: 'CHANNEL' as const, rub: 0.04, rate: 0.003, badge: '📊 3 поста' },
    { name: 'Последние 5 постов', target: 'CHANNEL' as const, rub: 0.05, rate: 0.005, badge: '📊 5 постов' },
    { name: 'Последние 10 постов', target: 'CHANNEL' as const, rub: 0.08, rate: 0.008, badge: '📊 10 постов' },
    { name: 'Последние 20 постов', target: 'CHANNEL' as const, rub: 0.15, rate: 0.015, badge: '📊 20 постов' },
    { name: 'Последние 50 постов', target: 'CHANNEL' as const, rub: 0.35, rate: 0.035, badge: '📊 50 постов' },
    { name: 'Последние 100 постов', target: 'CHANNEL' as const, rub: 0.65, rate: 0.065, badge: '📊 100 постов' },
    { name: 'Автопросмотры на новые посты (1 день)', target: 'CHANNEL' as const, rub: 0.15, rate: 0.15, badge: '🤖 1 день' },
    { name: 'Автопросмотры на новые посты (3 дня)', target: 'CHANNEL' as const, rub: 0.25, rate: 0.25, badge: '🤖 3 дня' },
    { name: 'Автопросмотры на новые посты (7 дней)', target: 'CHANNEL' as const, rub: 0.45, rate: 0.45, badge: '🤖 7 дней' },
    { name: 'Автопросмотры на новые посты (15 дней)', target: 'CHANNEL' as const, rub: 0.75, rate: 0.75, badge: '🤖 15 дней' },
    { name: 'Автопросмотры на новые посты (30 дней)', target: 'CHANNEL' as const, rub: 1.25, rate: 1.25, badge: '🤖 30 дней' },
    { name: 'Автопросмотры на новые посты (60 дней)', target: 'CHANNEL' as const, rub: 2.25, rate: 2.25, badge: '🤖 60 дней' },
    { name: 'Автопросмотры на новые посты (90 дней)', target: 'CHANNEL' as const, rub: 3.15, rate: 3.15, badge: '🤖 90 дней' },
    { name: 'Автопросмотры с постепенным набором (Плавные 24ч)', target: 'CHANNEL' as const, rub: 0.95, rate: 0.95, badge: '📈 Плавные' },
    { name: 'Просмотры РФ аудитория (Geo RU)', target: 'POST' as const, rub: 0.05, rate: 0.004, badge: '🇷🇺 РФ Охват' },
    { name: 'Просмотры США аудитория (Geo USA)', target: 'POST' as const, rub: 0.06, rate: 0.005, badge: '🇺🇸 USA' },
    { name: 'Просмотры Европа (Geo EU)', target: 'POST' as const, rub: 0.06, rate: 0.005, badge: '🇪🇺 EU' },
    { name: 'Просмотры Азия (Geo ASIA)', target: 'POST' as const, rub: 0.03, rate: 0.002, badge: '🌏 ASIA' },
  ];
  for (const v of tgViewsTypes) {
    items.push(
      makeService(
        'telegram',
        'Просмотры',
        `Telegram: Просмотры — ${v.name}`,
        v.rub,
        v.rate,
        100,
        500000,
        v.target,
        '1–5 минут',
        'до 1 000 000 в сутки',
        'Повышение охвата в статистике TGStat, Telemetr и встроенной аналитике Telegram.',
        'Без списаний',
        'Ссылка на пост или канал',
        v.badge
      )
    );
  }

  // Telegram Reactions (35+ single & combos)
  const tgSingleEmojis = [
    { emoji: '👍', name: 'Палец вверх (Thumbs Up)', rub: 0.05 },
    { emoji: '❤️', name: 'Красное сердце (Heart)', rub: 0.05 },
    { emoji: '🔥', name: 'Огонь (Fire)', rub: 0.05 },
    { emoji: '🎉', name: 'Праздник (Party)', rub: 0.05 },
    { emoji: '👏', name: 'Аплодисменты (Clap)', rub: 0.05 },
    { emoji: '😱', name: 'Шок (Scream)', rub: 0.05 },
    { emoji: '⚡️', name: 'Молния (Lightning)', rub: 0.05 },
    { emoji: '🤩', name: 'Восторг (Star-Struck)', rub: 0.05 },
    { emoji: '🥰', name: 'Влюбленность (Love)', rub: 0.05 },
    { emoji: '🤝', name: 'Рукопожатие (Handshake)', rub: 0.05 },
    { emoji: '✍️', name: 'Пишущий (Writing)', rub: 0.05 },
    { emoji: '🫡', name: 'Честь (Salute)', rub: 0.05 },
    { emoji: '🌭', name: 'Хотдог (Hotdog)', rub: 0.05 },
    { emoji: '🍓', name: 'Клубника (Strawberry)', rub: 0.05 },
    { emoji: '🍾', name: 'Шампанское (Champagne)', rub: 0.05 },
    { emoji: '💋', name: 'Поцелуй (Kiss)', rub: 0.05 },
    { emoji: '😇', name: 'Ангел (Angel)', rub: 0.05 },
    { emoji: '😈', name: 'Черт (Devil)', rub: 0.06 },
    { emoji: '💩', name: 'Какашка (Poop)', rub: 0.06 },
    { emoji: '🤮', name: 'Тошнота (Vomit)', rub: 0.06 },
    { emoji: '🤡', name: 'Клоун (Clown)', rub: 0.06 },
    { emoji: '👎', name: 'Дизлайк (Thumbs Down)', rub: 0.06 },
    { emoji: '💔', name: 'Разбитое сердце (Broken Heart)', rub: 0.06 },
    { emoji: '🤬', name: 'Злость (Angry)', rub: 0.06 },
    { emoji: '😭', name: 'Слезы (Crying)', rub: 0.06 },
    { emoji: '🤓', name: 'Ботаник (Nerd)', rub: 0.06 },
    { emoji: '👻', name: 'Призрак (Ghost)', rub: 0.06 },
    { emoji: '💅', name: 'Ногти (Nails)', rub: 0.06 },
    { emoji: '😴', name: 'Спящий (Sleeping)', rub: 0.06 },
    { emoji: '🎅', name: 'Санта (Santa)', rub: 0.06 },
    { emoji: '🎄', name: 'Елка (Tree)', rub: 0.06 },
    { emoji: '🎁', name: 'Подарок (Gift)', rub: 0.06 },
  ];
  for (const e of tgSingleEmojis) {
    items.push(
      makeService(
        'telegram',
        'Реакции',
        `Telegram: Реакции ${e.emoji} ${e.name}`,
        e.rub,
        0.002,
        10,
        100000,
        'POST',
        'Мгновенно (10–30 сек)',
        'до 50 000 в сутки',
        `Точечная накрутка реакции ${e.emoji} на публикацию.`,
        'Без списаний',
        'Ссылка на пост с включенной реакцией',
        `${e.emoji} Эмодзи`
      )
    );
  }

  // Boosts Level 1–10
  for (let lvl = 1; lvl <= 10; lvl++) {
    items.push(
      makeService(
        'telegram',
        'Бусты и Истории',
        `Telegram: Бусты для канала [Level ${lvl}] — Уровень ${lvl} историй`,
        35.0 * lvl,
        3.5 * lvl,
        1,
        100,
        'CHANNEL',
        '10–30 минут',
        'до 50 бустов в день',
        `Пакет Telegram Boosts для повышения уровня канала до Level ${lvl}.`,
        '30 дней гарантии удержания',
        'Ссылка на буст канала (https://t.me/boost/username)',
        `🚀 Level ${lvl}`
      )
    );
  }

  // Polls Options 1–10
  for (let opt = 1; opt <= 10; opt++) {
    items.push(
      makeService(
        'telegram',
        'Опросы и Голосования',
        `Telegram: Голоса в публичный опрос (Вариант №${opt})`,
        0.35,
        0.35,
        20,
        25000,
        'POST',
        '5–15 минут',
        'до 10 000 в сутки',
        `Голосование за вариант ответа №${opt} в публичном опросе.`,
        'Без списаний',
        'Ссылка на опрос в канале/группе',
        `🗳 Вариант ${opt}`
      )
    );
  }

  // ══════════════════════════════════════════════════════════════
  // 2. ВКОНТАКТЕ (VK) (~160 услуг)
  // ══════════════════════════════════════════════════════════════
  const vkCities = [
    { city: 'Все города РФ (Mix)', mult: 1.0, rate: 0.85 },
    { city: 'Москва и МО', mult: 1.5, rate: 1.25 },
    { city: 'Санкт-Петербург и ЛО', mult: 1.4, rate: 1.20 },
    { city: 'Новосибирск', mult: 1.3, rate: 1.10 },
    { city: 'Екатеринбург', mult: 1.3, rate: 1.10 },
    { city: 'Казань / Татарстан', mult: 1.3, rate: 1.10 },
    { city: 'Нижний Новгород', mult: 1.2, rate: 1.00 },
    { city: 'Краснодар / ЮФО', mult: 1.3, rate: 1.10 },
    { city: 'СНГ (Беларусь / Казахстан)', mult: 0.9, rate: 0.75 },
  ];

  const vkTiers = [
    { name: 'В группу / паблик (Эконом)', rub: 0.29, rate: 0.30, badge: '⚡️ Эконом', warranty: 'Эконом' },
    { name: 'В сообщество (HQ с гарантией 30 дней)', rub: 0.81, rate: 0.85, badge: '🛡️ 30d Refill', warranty: '30 дней Refill' },
    { name: 'В сообщество (Живые офферы с гарантией 60 дней)', rub: 1.15, rate: 1.20, badge: '💎 HQ 60d', warranty: '60 дней Refill' },
    { name: 'В сообщество (VIP 100% без собачек, 90 дней)', rub: 1.85, rate: 1.90, badge: '👑 VIP 90d', warranty: '90 дней 0% собачек' },
    { name: 'Друзья / Подписчики на личную страницу', rub: 0.65, rate: 0.65, badge: '👤 Друзья', warranty: '30 дней Refill' },
    { name: 'Женская аудитория (Только девушки)', rub: 1.35, rate: 1.40, badge: '👩 Девушки', warranty: '30 дней' },
    { name: 'Мужская аудитория (Только мужчины)', rub: 1.35, rate: 1.40, badge: '👨 Мужчины', warranty: '30 дней' },
  ];

  for (const c of vkCities) {
    for (const t of vkTiers) {
      items.push(
        makeService(
          'vk',
          'Подписчики / Группы',
          `VK: Подписчики [${c.city}] — ${t.name}`,
          t.rub * c.mult,
          t.rate * c.mult,
          25,
          50000,
          t.name.includes('личную') ? 'PROFILE' : 'CHANNEL',
          '10–30 минут',
          'до 5 000 в сутки (без бана сообщества)',
          `Качественные аккаунты пользователей ВКонтакте из региона ${c.city}.`,
          t.warranty,
          'Ссылка на сообщество или личную страницу VK',
          t.badge
        )
      );
    }
  }

  // VK Likes, Views, Clips, Video, Music
  const vkActivities = [
    { name: 'Лайки на запись или фото (Живые пользователи РФ)', cat: 'Лайки', rub: 0.05, rate: 0.005, badge: '❤️ Лайки РФ' },
    { name: 'Быстрые лайки (Мгновенный старт за 30 сек)', cat: 'Лайки', rub: 0.04, rate: 0.004, badge: '⚡️ Мгновенно' },
    { name: 'Лайки на аватарку / фотоальбом', cat: 'Лайки', rub: 0.06, rate: 0.006, badge: '🖼 Аватарка' },
    { name: 'Лайки на комментарий (Вывод в топ ветки)', cat: 'Лайки', rub: 0.08, rate: 0.008, badge: '💬 На коммент' },
    { name: 'Лайки от женской аудитории РФ', cat: 'Лайки', rub: 0.09, rate: 0.009, badge: '👩 Женские лайки' },
    { name: 'Лайки от мужской аудитории РФ', cat: 'Лайки', rub: 0.09, rate: 0.009, badge: '👨 Мужские лайки' },
    { name: 'Автолайки на 5 будущих постов', cat: 'Лайки', rub: 0.25, rate: 0.25, badge: '🤖 Авто 5' },
    { name: 'Автолайки на 10 будущих постов', cat: 'Лайки', rub: 0.45, rate: 0.45, badge: '🤖 Авто 10' },
    { name: 'Автолайки на 20 будущих постов', cat: 'Лайки', rub: 0.85, rate: 0.85, badge: '🤖 Авто 20' },
    { name: 'Автолайки на 30 будущих постов', cat: 'Лайки', rub: 1.25, rate: 1.25, badge: '🤖 Авто 30' },
    { name: 'Просмотры на запись / пост (Умная лента)', cat: 'Просмотры', rub: 0.02, rate: 0.001, badge: '👁 Просмотры поста' },
    { name: 'Просмотры на Клипы / VK Clips (Выход в тренды)', cat: 'Просмотры', rub: 0.03, rate: 0.002, badge: '🎬 VK Clips' },
    { name: 'Просмотры видеозаписей VK Video (Счетчик плеера)', cat: 'Просмотры', rub: 0.03, rate: 0.002, badge: '📹 VK Video' },
    { name: 'Просмотры видео VK (С высоким удержанием)', cat: 'Просмотры', rub: 0.06, rate: 0.005, badge: '⏱ Удержание видео' },
    { name: 'Просмотры историй / Stories пользователя', cat: 'Просмотры', rub: 0.05, rate: 0.004, badge: '👁 Stories' },
    { name: 'Просмотры историй / Stories сообщества', cat: 'Просмотры', rub: 0.06, rate: 0.005, badge: '👁 Stories Паблика' },
    { name: 'Автопросмотры на 10 будущих постов', cat: 'Просмотры', rub: 0.15, rate: 0.15, badge: '🤖 Авто-просмотры' },
    { name: 'Автопросмотры на 30 будущих постов', cat: 'Просмотры', rub: 0.35, rate: 0.35, badge: '🤖 Авто 30 постов' },
    { name: 'Репосты на личные стены пользователей', cat: 'Репосты и Комментарии', rub: 0.35, rate: 0.35, badge: '📢 Репосты' },
    { name: 'Репосты в группы и тематические паблики', cat: 'Репосты и Комментарии', rub: 0.75, rate: 0.75, badge: '📢 В паблики' },
    { name: 'Кастомные комментарии (Свой текст отзывов)', cat: 'Репосты и Комментарии', rub: 1.50, rate: 1.50, badge: '✍️ Отзывы' },
    { name: 'Положительные комментарии к товарам и услугам', cat: 'Репосты и Комментарии', rub: 1.65, rate: 1.65, badge: '⭐️ К товарам' },
    { name: 'Прослушивания трека VK Музыка', cat: 'Репосты и Комментарии', rub: 0.15, rate: 0.015, badge: '🎵 Трек' },
    { name: 'Прослушивания плейлиста VK Музыка (Для чартов)', cat: 'Репосты и Комментарии', rub: 0.25, rate: 0.025, badge: '🎧 Плейлист' },
    { name: 'Добавления трека в аудиозаписи пользователей', cat: 'Репосты и Комментарии', rub: 0.35, rate: 0.035, badge: '➕ В аудио' },
    { name: 'Голоса в опрос на стене или в сообществе', cat: 'Репосты и Комментарии', rub: 0.35, rate: 0.35, badge: '🗳 Опрос' },
    { name: 'Зрители на трансляцию VK Live (30 минут)', cat: 'Репосты и Комментарии', rub: 1.95, rate: 2.00, badge: '🔴 Live 30m' },
    { name: 'Зрители на трансляцию VK Live (60 минут)', cat: 'Репосты и Комментарии', rub: 3.50, rate: 3.50, badge: '🔴 Live 60m' },
  ];
  for (const a of vkActivities) {
    items.push(
      makeService(
        'vk',
        a.cat,
        `VK: ${a.name}`,
        a.rub,
        a.rate,
        10,
        50000,
        a.name.includes('Музыка') ? 'CUSTOM' : a.name.includes('Авто') ? 'CHANNEL' : 'POST',
        '10–20 минут',
        'до 10 000 в сутки',
        'Комплексное продвижение ВКонтакте.',
        'Без списаний',
        'Ссылка на запись, страницу или трек VK',
        a.badge
      )
    );
  }

  // ══════════════════════════════════════════════════════════════
  // 3. INSTAGRAM (~140 услуг)
  // ══════════════════════════════════════════════════════════════
  const igGeos = [
    { geo: 'СНГ (Микс)', code: 'CIS', mult: 1.0, rate: 0.95 },
    { geo: 'Россия (РФ)', code: 'RU', mult: 1.25, rate: 1.20 },
    { geo: 'США (USA)', code: 'USA', mult: 1.5, rate: 1.50 },
    { geo: 'Великобритания (UK)', code: 'UK', mult: 1.6, rate: 1.60 },
    { geo: 'Европа (EU Mix)', code: 'EU', mult: 1.5, rate: 1.50 },
    { geo: 'Бразилия (BR)', code: 'BR', mult: 0.6, rate: 0.60 },
    { geo: 'Турция (TR)', code: 'TR', mult: 0.8, rate: 0.80 },
    { geo: 'Арабские страны (ARAB)', code: 'ARAB', mult: 1.3, rate: 1.30 },
    { geo: 'Индия (IN)', code: 'IN', mult: 0.5, rate: 0.50 },
  ];

  const igTiers = [
    { name: 'Эконом (Для объема)', rub: 0.34, rate: 0.35, badge: '⚡️ Эконом', warranty: 'Эконом' },
    { name: 'HQ с гарантией 30 дней', rub: 0.91, rate: 0.95, badge: '🛡️ 30d Refill', warranty: '30 дней Refill' },
    { name: 'Премиум с историей (0% отписок, 60 дней)', rub: 1.65, rate: 1.70, badge: '💎 Премиум 60d', warranty: '60 дней Refill' },
    { name: 'VIP Ultra (Старые трастовые аккаунты, 365 дней)', rub: 2.45, rate: 2.50, badge: '👑 VIP 1 Год', warranty: '365 дней 100% гарантия' },
    { name: 'Женская аудитория (Только девушки)', rub: 1.35, rate: 1.40, badge: '👩 Девушки', warranty: '30 дней' },
    { name: 'Мужская аудитория (Только мужчины)', rub: 1.35, rate: 1.40, badge: '👨 Мужчины', warranty: '30 дней' },
  ];

  for (const g of igGeos) {
    for (const t of igTiers) {
      items.push(
        makeService(
          'instagram',
          'Подписчики',
          `Instagram: Подписчики [${g.geo}] — ${t.name}`,
          t.rub * g.mult,
          t.rate * g.mult,
          25,
          50000,
          'PROFILE',
          '10–30 минут',
          'до 10 000 в сутки',
          `Фолловеры из региона ${g.geo} для открытого профиля Instagram.`,
          t.warranty,
          'Прямая ссылка на открытый профиль Instagram',
          t.badge
        )
      );
    }
  }

  // Instagram Likes, Views, Reels, Stories
  const igActivities = [
    { name: 'Мгновенные лайки на фото / Reels', cat: 'Лайки и Охват', rub: 0.04, rate: 0.003, badge: '⚡️ Мгновенно' },
    { name: 'Реальные лайки от пользователей РФ/СНГ (HQ)', cat: 'Лайки и Охват', rub: 0.12, rate: 0.012, badge: '❤️ HQ Лайки' },
    { name: 'Лайки с охватом и показами (Explore Boost)', cat: 'Лайки и Охват', rub: 0.15, rate: 0.015, badge: '📈 Explore Boost' },
    { name: 'Сохранения публикации в закладки + Охват', cat: 'Лайки и Охват', rub: 0.06, rate: 0.005, badge: '🔖 Сохранения' },
    { name: 'Показы и охват профиля (Impressions & Reach)', cat: 'Лайки и Охват', rub: 0.05, rate: 0.004, badge: '📊 Охват' },
    { name: 'Переходы в профиль из ленты «Интересное»', cat: 'Лайки и Охват', rub: 0.08, rate: 0.007, badge: '🔍 Переходы' },
    { name: 'Шэринг / Пересылка публикации в Direct', cat: 'Лайки и Охват', rub: 0.12, rate: 0.010, badge: '✈️ В Директ' },
    { name: 'Лайки на комментарий (Вывод в топ ветки)', cat: 'Лайки и Охват', rub: 0.10, rate: 0.008, badge: '💬 На коммент' },
    { name: 'Автолайки на 10 будущих постов/Reels', cat: 'Лайки и Охват', rub: 0.55, rate: 0.55, badge: '🤖 Авто 10' },
    { name: 'Автолайки на 30 будущих постов/Reels', cat: 'Лайки и Охват', rub: 1.45, rate: 1.45, badge: '🤖 Авто 30' },
    { name: 'Просмотры Reels (Быстрый выход в рекомендации)', cat: 'Просмотры и Stories', rub: 0.02, rate: 0.001, badge: '🎬 Reels' },
    { name: 'Просмотры Reels с удержанием 100%', cat: 'Просмотры и Stories', rub: 0.05, rate: 0.004, badge: '⏱ Удержание Reels' },
    { name: 'Просмотры видео IG Video', cat: 'Просмотры и Stories', rub: 0.03, rate: 0.002, badge: '📹 IG Video' },
    { name: 'Просмотры всех активных Stories', cat: 'Просмотры и Stories', rub: 0.05, rate: 0.004, badge: '👁 Stories Все' },
    { name: 'Просмотры Stories + Переходы по ссылке (Swipe Up)', cat: 'Просмотры и Stories', rub: 0.12, rate: 0.010, badge: '🔗 Stories Ссылка' },
    { name: 'Реакции на Stories (❤️ 🔥 😍)', cat: 'Просмотры и Stories', rub: 0.08, rate: 0.007, badge: '❤️ Stories Реакции' },
    { name: 'Голосования в стикерах Stories (Да/Нет, Опросы)', cat: 'Просмотры и Stories', rub: 0.25, rate: 0.25, badge: '🗳 Stories Стикеры' },
    { name: 'Кастомные русские комментарии (Свой текст)', cat: 'Лайки и Охват', rub: 1.95, rate: 2.00, badge: '✍️ Комменты РФ' },
    { name: 'Англоязычные комментарии (English Real Users)', cat: 'Лайки и Охват', rub: 2.45, rate: 2.50, badge: '🇬🇧 English Comments' },
    { name: 'Зрители на прямой эфир IG Live (30 минут)', cat: 'Просмотры и Stories', rub: 2.20, rate: 2.20, badge: '🔴 Live 30m' },
    { name: 'Зрители на прямой эфир IG Live (60 минут)', cat: 'Просмотры и Stories', rub: 3.90, rate: 4.00, badge: '🔴 Live 60m' },
  ];
  for (const act of igActivities) {
    items.push(
      makeService(
        'instagram',
        act.cat,
        `Instagram: ${act.name}`,
        act.rub,
        act.rate,
        20,
        100000,
        act.name.includes('Stories') || act.name.includes('Live') || act.name.includes('Авто') ? 'PROFILE' : 'POST',
        '1–5 минут',
        'до 50 000 в сутки',
        'Продвижение профиля и контента в Instagram.',
        'Без списаний',
        'Ссылка на пост, Reels или профиль',
        act.badge
      )
    );
  }

  // ══════════════════════════════════════════════════════════════
  // 4. YOUTUBE (~70 услуг)
  // ══════════════════════════════════════════════════════════════
  const ytGeos = [
    { name: 'Органические (Микс стран)', rub: 1.15, rate: 1.20, badge: '📈 High Retention' },
    { name: 'Россия (РФ аудитория)', rub: 1.35, rate: 1.40, badge: '🇷🇺 РФ Просмотры' },
    { name: 'США (USA High RPM $)', rub: 1.85, rate: 1.90, badge: '🇺🇸 USA Views' },
    { name: 'Великобритания (UK)', rub: 1.85, rate: 1.90, badge: '🇬🇧 UK Views' },
    { name: 'Германия (DE)', rub: 1.85, rate: 1.90, badge: '🇩🇪 DE Views' },
    { name: 'Франция (FR)', rub: 1.75, rate: 1.80, badge: '🇫🇷 FR Views' },
    { name: 'Канада (CA)', rub: 1.85, rate: 1.90, badge: '🇨🇦 CA Views' },
  ];
  for (const g of ytGeos) {
    items.push(
      makeService(
        'youtube',
        'Просмотры',
        `YouTube: Просмотры [${g.name}] — Высокое удержание 60-90%`,
        g.rub,
        g.rate,
        100,
        1000000,
        'POST',
        '15–60 минут',
        'до 50 000 в сутки',
        `Просмотры с высоким удержанием из региона ${g.name}.`,
        '30 дней гарантии от списаний YouTube',
        'Прямая ссылка на открытое видео YouTube',
        g.badge
      ),
      makeService(
        'youtube',
        'Просмотры',
        `YouTube: Просмотры Shorts [${g.name}] — Быстрый запуск в ленту`,
        g.rub * 0.6,
        g.rate * 0.6,
        100,
        500000,
        'POST',
        '5–15 минут',
        'до 100 000 в сутки',
        `Быстрые просмотры для коротких видео YouTube Shorts (${g.name}).`,
        'Без списаний',
        'Ссылка на Shorts',
        '⚡️ Shorts'
      )
    );
  }

  const ytSubsAndHours = [
    { name: 'Подписчики на канал (Гарантия 30 дней)', rub: 4.30, rate: 4.50, badge: '🛡️ 30d Refill' },
    { name: 'Подписчики Несгораемые HQ (Гарантия 90 дней)', rub: 6.50, rate: 6.80, badge: '💎 HQ 90d' },
    { name: 'Подписчики VIP Ultra (0% списаний, гарантия 365 дней)', rub: 9.90, rate: 10.0, badge: '👑 VIP 1 Год' },
    { name: 'Лайки на видео (Органические пользователи)', rub: 0.45, rate: 0.45, badge: '👍 Лайки' },
    { name: 'Лайки на YouTube Shorts', rub: 0.35, rate: 0.35, badge: '👍 Shorts Лайки' },
    { name: 'Лайки на комментарий под видео', rub: 0.40, rate: 0.40, badge: '💬 На коммент' },
    { name: '1000 часов просмотров (Для монетизации)', rub: 25.0, rate: 2.50, badge: '💰 1000ч' },
    { name: '2000 часов просмотров (Для монетизации)', rub: 25.0, rate: 2.50, badge: '💰 2000ч' },
    { name: '3000 часов просмотров (Для монетизации)', rub: 25.0, rate: 2.50, badge: '💰 3000ч' },
    { name: '4000 часов просмотров (Полный пакет монетизации)', rub: 25.0, rate: 2.50, badge: '💰 4000ч Full' },
    { name: 'Кастомные комментарии на русском языке', rub: 3.50, rate: 3.50, badge: '✍️ Комментарии' },
    { name: 'Кастомные комментарии на английском языке', rub: 3.90, rate: 4.00, badge: '🇬🇧 English' },
    { name: 'Зрители на прямой эфир YouTube Live (30 минут)', rub: 2.50, rate: 2.50, badge: '🔴 Live 30m' },
    { name: 'Зрители на прямой эфир YouTube Live (60 минут)', rub: 4.50, rate: 4.50, badge: '🔴 Live 60m' },
    { name: 'Зрители на прямой эфир YouTube Live (120 минут)', rub: 7.90, rate: 8.00, badge: '🔴 Live 120m' },
    { name: 'Зрители на прямой эфир YouTube Live (180 минут)', rub: 11.50, rate: 11.50, badge: '🔴 Live 180m' },
  ];
  for (const s of ytSubsAndHours) {
    items.push(
      makeService(
        'youtube',
        'Подписчики и Лайки',
        `YouTube: ${s.name}`,
        s.rub,
        s.rate,
        s.name.includes('Подписчики') ? 10 : 20,
        10000,
        s.name.includes('Подписчики') ? 'CHANNEL' : 'POST',
        '30–90 минут',
        'Органичная скорость для безопасности канала',
        'Продвижение канала YouTube.',
        '30–365 дней гарантии',
        'Ссылка на канал или видео',
        s.badge
      )
    );
  }

  // ══════════════════════════════════════════════════════════════
  // 5. TIKTOK (~40 услуг)
  // ══════════════════════════════════════════════════════════════
  const ttServices = [
    { name: 'Просмотры видео (Выход в реки For You)', rub: 0.02, rate: 0.001, cat: 'Просмотры и Лайки', badge: '⚡️ Рекомендации' },
    { name: 'Просмотры видео с удержанием 100%', rub: 0.04, rate: 0.003, cat: 'Просмотры и Лайки', badge: '⏱ Удержание' },
    { name: 'Быстрые лайки на видео', rub: 0.15, rate: 0.015, cat: 'Просмотры и Лайки', badge: '❤️ Лайки' },
    { name: 'Лайки от пользователей РФ/СНГ (HQ)', rub: 0.25, rate: 0.025, cat: 'Просмотры и Лайки', badge: '❤️ HQ Лайки' },
    { name: 'Подписчики на аккаунт (С гарантией 30 дней)', rub: 0.95, rate: 1.00, cat: 'Просмотры и Лайки', badge: '🛡️ Подписчики 30d' },
    { name: 'Подписчики для открытия функции Live/Стримов (1000+)', rub: 1.25, rate: 1.30, cat: 'Просмотры и Лайки', badge: '🎥 Для Стримов' },
    { name: 'Репосты (Поделиться видео)', rub: 0.08, rate: 0.008, cat: 'Просмотры и Лайки', badge: '📢 Репосты' },
    { name: 'Сохранения видео в избранное (Bookmarks)', rub: 0.06, rate: 0.006, cat: 'Просмотры и Лайки', badge: '🔖 В избранное' },
    { name: 'Кастомные комментарии на русском языке', rub: 1.95, rate: 2.00, cat: 'Просмотры и Лайки', badge: '✍️ Комменты' },
    { name: 'Зрители на прямой эфир TikTok Live (30 минут)', rub: 2.90, rate: 3.00, cat: 'Просмотры и Лайки', badge: '🔴 Live 30m' },
    { name: 'Зрители на прямой эфир TikTok Live (60 минут)', rub: 5.20, rate: 5.50, cat: 'Просмотры и Лайки', badge: '🔴 Live 60m' },
  ];
  for (const t of ttServices) {
    items.push(
      makeService(
        'tiktok',
        t.cat,
        `TikTok: ${t.name}`,
        t.rub,
        t.rate,
        20,
        1000000,
        t.name.includes('Подписчики') ? 'PROFILE' : 'POST',
        '1–5 минут',
        'до 500 000 в сутки',
        'Раскрутка в рекомендациях алгоритма TikTok For You.',
        '30 дней гарантии',
        'Ссылка на видео или профиль TikTok',
        t.badge
      )
    );
  }

  // ══════════════════════════════════════════════════════════════
  // 6. TWITCH, TWITTER / X, RUTUBE, ДЗЕН, DISCORD, THREADS, SPOTIFY
  // ══════════════════════════════════════════════════════════════
  const otherServices = [
    // Twitch
    { net: 'twitch', cat: 'Зрители на стрим', name: 'Twitch: Зрители на стрим (15 минут)', rub: 1.50, rate: 1.50, badge: '🔴 15m' },
    { net: 'twitch', cat: 'Зрители на стрим', name: 'Twitch: Зрители на стрим (30 минут)', rub: 2.50, rate: 2.50, badge: '🔴 30m' },
    { net: 'twitch', cat: 'Зрители на стрим', name: 'Twitch: Зрители на стрим (60 минут / 1 час)', rub: 4.50, rate: 4.50, badge: '🔴 1h' },
    { net: 'twitch', cat: 'Зрители на стрим', name: 'Twitch: Зрители на стрим (120 минут / 2 часа)', rub: 7.90, rate: 8.00, badge: '🔴 2h' },
    { net: 'twitch', cat: 'Зрители на стрим', name: 'Twitch: Зрители на стрим (180 минут / 3 часа)', rub: 11.50, rate: 11.50, badge: '🔴 3h' },
    { net: 'twitch', cat: 'Зрители на стрим', name: 'Twitch: Зрители на стрим (240 минут / 4 часа)', rub: 14.90, rate: 15.00, badge: '🔴 4h' },
    { net: 'twitch', cat: 'Зрители на стрим', name: 'Twitch: Фолловеры на канал (Гарантия 30 дней)', rub: 0.45, rate: 0.45, badge: '🛡️ Фолловеры' },
    { net: 'twitch', cat: 'Зрители на стрим', name: 'Twitch: Фолловеры Премиум HQ (Гарантия 90 дней)', rub: 0.75, rate: 0.75, badge: '💎 HQ 90d' },
    { net: 'twitch', cat: 'Зрители на стрим', name: 'Twitch: Чат-боты с кастомными сообщениями', rub: 1.50, rate: 1.50, badge: '💬 Чат-боты' },

    // RuTube & Dzen
    { net: 'rutube', cat: 'RuTube', name: 'RuTube: Просмотры видео (Выход в ТОП)', rub: 0.25, rate: 0.25, badge: '🇷🇺 RuTube Просмотры' },
    { net: 'rutube', cat: 'RuTube', name: 'RuTube: Просмотры видео с удержанием 80%', rub: 0.45, rate: 0.45, badge: '⏱ RuTube Удержание' },
    { net: 'rutube', cat: 'RuTube', name: 'RuTube: Подписчики на канал', rub: 1.25, rate: 1.30, badge: '🛡️ RuTube Подписчики' },
    { net: 'rutube', cat: 'RuTube', name: 'RuTube: Лайки на видео', rub: 0.35, rate: 0.35, badge: '👍 RuTube Лайки' },
    { net: 'rutube', cat: 'RuTube', name: 'RuTube: Комментарии под видео', rub: 2.20, rate: 2.20, badge: '✍️ RuTube Комменты' },
    { net: 'rutube', cat: 'Дзен (Dzen)', name: 'Дзен: Дочитывания статей (Монетизация 40+ сек)', rub: 0.45, rate: 0.45, badge: '📖 Дзен Дочитывания' },
    { net: 'rutube', cat: 'Дзен (Dzen)', name: 'Дзен: Дочитывания статей длинные (90+ сек)', rub: 0.75, rate: 0.75, badge: '⏱ Дзен 90s' },
    { net: 'rutube', cat: 'Дзен (Dzen)', name: 'Дзен: Подписчики на канал', rub: 1.10, rate: 1.10, badge: '👤 Дзен Подписчики' },
    { net: 'rutube', cat: 'Дзен (Dzen)', name: 'Дзен: Лайки на статьи и посты', rub: 0.30, rate: 0.30, badge: '👍 Дзен Лайки' },
    { net: 'rutube', cat: 'Дзен (Dzen)', name: 'Дзен: Просмотры видео и роликов', rub: 0.15, rate: 0.15, badge: '🎬 Дзен Видео' },

    // Twitter / X
    { net: 'twitter', cat: 'Фолловеры и Охват', name: 'Twitter (X): Фолловеры на аккаунт (30 дней гарантии)', rub: 1.25, rate: 1.30, badge: '🛡️ Фолловеры' },
    { net: 'twitter', cat: 'Фолловеры и Охват', name: 'Twitter (X): Фолловеры Крипто/NFT профили', rub: 1.85, rate: 1.90, badge: '🪙 Crypto X' },
    { net: 'twitter', cat: 'Фолловеры и Охват', name: 'Twitter (X): Лайки на твит (Likes)', rub: 0.35, rate: 0.35, badge: '❤️ Лайки X' },
    { net: 'twitter', cat: 'Фолловеры и Охват', name: 'Twitter (X): Ретвиты (Retweets)', rub: 0.45, rate: 0.45, badge: '🔁 Ретвиты' },
    { net: 'twitter', cat: 'Фолловеры и Охват', name: 'Twitter (X): Показы и охват твита (Impressions)', rub: 0.02, rate: 0.001, badge: '📊 Impressions' },
    { net: 'twitter', cat: 'Фолловеры и Охват', name: 'Twitter (X): Голоса в опросе Twitter', rub: 0.45, rate: 0.45, badge: '🗳 Опросы X' },

    // Discord
    { net: 'discord', cat: 'Участники сервера', name: 'Discord: Участники на сервер (Оффлайн)', rub: 0.45, rate: 0.45, badge: '👥 Оффлайн' },
    { net: 'discord', cat: 'Участники сервера', name: 'Discord: Участники на сервер (Онлайн 24/7)', rub: 0.85, rate: 0.85, badge: '🟢 Онлайн' },
    { net: 'discord', cat: 'Участники сервера', name: 'Discord: Серверные Бусты (Level 1 — 2 буста на 1 месяц)', rub: 150.0, rate: 15.0, badge: '🚀 Boost Lvl 1' },
    { net: 'discord', cat: 'Участники сервера', name: 'Discord: Серверные Бусты (Level 2 — 7 бустов на 1 месяц)', rub: 450.0, rate: 45.0, badge: '🚀 Boost Lvl 2' },
    { net: 'discord', cat: 'Участники сервера', name: 'Discord: Серверные Бусты (Level 3 — 14 бустов на 1 месяц)', rub: 890.0, rate: 90.0, badge: '🚀 Boost Lvl 3' },

    // Threads
    { net: 'threads', cat: 'Threads', name: 'Threads: Подписчики на аккаунт', rub: 0.85, rate: 0.85, badge: '🧵 Подписчики' },
    { net: 'threads', cat: 'Threads', name: 'Threads: Лайки на публикацию', rub: 0.25, rate: 0.25, badge: '❤️ Лайки' },
    { net: 'threads', cat: 'Threads', name: 'Threads: Репосты публикации', rub: 0.35, rate: 0.35, badge: '🔁 Репосты' },

    // Spotify
    { net: 'spotify', cat: 'Spotify Музыка', name: 'Spotify: Прослушивания трека (Plays)', rub: 0.15, rate: 0.015, badge: '🎵 Прослушивания' },
    { net: 'spotify', cat: 'Spotify Музыка', name: 'Spotify: Прослушивания трека РФ (Geo RU)', rub: 0.25, rate: 0.025, badge: '🇷🇺 Spotify RU' },
    { net: 'spotify', cat: 'Spotify Музыка', name: 'Spotify: Прослушивания США (Geo USA)', rub: 0.35, rate: 0.035, badge: '🇺🇸 Spotify USA' },
    { net: 'spotify', cat: 'Spotify Музыка', name: 'Spotify: Подписчики на профиль артиста', rub: 0.95, rate: 0.95, badge: '👤 Фолловеры' },
    { net: 'spotify', cat: 'Spotify Музыка', name: 'Spotify: Сохранения трека в медиатеку (Saves)', rub: 0.25, rate: 0.025, badge: '💚 Saves' },
  ];

  for (const o of otherServices) {
    items.push(
      makeService(
        o.net,
        o.cat,
        o.name,
        o.rub,
        o.rate,
        10,
        50000,
        o.name.includes('Подписчики') || o.name.includes('Фолловеры') || o.name.includes('Участники') ? 'CHANNEL' : 'POST',
        '10–30 минут',
        'Стабильная скорость выполнения',
        'Качественное продвижение.',
        '30 дней гарантии',
        'Ссылка на объект продвижения',
        o.badge
      )
    );
  }

  return items;
}

async function main() {
  const { CatalogLockGuard } = await import('../src/lib/catalog-lock');
  const isLocked = await CatalogLockGuard.isLocked().catch(() => true);
  const existingCats = await prisma.category.count();
  if (isLocked) {
    console.error(`⛔ [GUARD] Catalog is LOCKED & INVIOLABLE. Aborting seed-enterprise-catalog-800. Unlock via scripts/lock-database.ts unlock first.`);
    process.exit(1);
  }
  if (existingCats > 0 && !process.argv.includes('--force')) {
    console.error(`⛔ [GUARD] Database already contains ${existingCats} existing categories. Aborting seed-enterprise-catalog-800.`);
    process.exit(1);
  }
  console.log('🚀 Starting Enterprise Massive Catalog Population (Target: 700-1000 Services like SMMprime)...');

  let mockProvider = await prisma.provider.findFirst({ where: { name: 'Vexboost API (Master)' } });
  if (!mockProvider) {
    mockProvider = await prisma.provider.create({
      data: {
        name: 'Vexboost API (Master)',
        apiUrl: 'https://vexboost.com/api/v2',
        apiKey: VaultService.encrypt('master_test_api_key_secure_12345'),
        isActive: true,
        balanceCurrency: 'USD',
      },
    });
  }

  const catalogItems = generateMassiveEnterpriseCatalog();
  console.log(`📦 Generated ${catalogItems.length} curated service definitions.`);

  const networksMap: Record<string, { name: string; icon: string; sort: number }> = {
    telegram: { name: 'Telegram', icon: 'telegram', sort: 1 },
    vk: { name: 'ВКонтакте', icon: 'vk', sort: 2 },
    instagram: { name: 'Instagram', icon: 'instagram', sort: 3 },
    youtube: { name: 'YouTube', icon: 'youtube', sort: 4 },
    tiktok: { name: 'TikTok', icon: 'tiktok', sort: 5 },
    twitch: { name: 'Twitch', icon: 'twitch', sort: 6 },
    rutube: { name: 'RuTube & Дзен', icon: 'rutube', sort: 7 },
    twitter: { name: 'Twitter (X)', icon: 'twitter', sort: 8 },
    discord: { name: 'Discord', icon: 'discord', sort: 9 },
    threads: { name: 'Threads', icon: 'threads', sort: 10 },
    spotify: { name: 'Spotify', icon: 'spotify', sort: 11 },
  };

  let createdCount = 0;
  let updatedCount = 0;

  for (const item of catalogItems) {
    const netInfo = networksMap[item.networkSlug] || { name: item.networkSlug, icon: 'globe', sort: 12 };

    let network = await prisma.network.findFirst({ where: { slug: item.networkSlug } });
    if (!network) {
      network = await prisma.network.create({
        data: {
          name: netInfo.name,
          slug: item.networkSlug,
          icon: netInfo.icon,
          sort: netInfo.sort,
          isActive: true,
        },
      });
    }

    let category = await prisma.category.findFirst({
      where: { name: item.categoryName, networkId: network.id },
    });
    if (!category) {
      category = await prisma.category.create({
        data: {
          name: item.categoryName,
          network: { connect: { id: network.id } },
          tenantId: 'all',
          sort: 1,
        },
      });
    }

    const fullDesc = `⚡️ **Старт:** ${item.startSpeed}
🚀 **Скорость:** ${item.speedPerDay}
👥 **Аудитория:** ${item.audience}
🛡️ **Гарантия:** ${item.warranty}
⚠️ **Требования к ссылке:** ${item.clientReq}`;

    const pricePer1000Cents = Math.round(item.retailUnitRub * 1000 * 100);

    const existing = await prisma.service.findFirst({
      where: { name: item.name, categoryId: category.id },
    });

    const payload = {
      name: item.name,
      description: fullDesc,
      rate: item.rateUsd,
      markup: item.markup,
      pricePer1000Cents,
      minQty: item.minQty,
      maxQty: item.maxQty,
      isRefillEnabled: item.isRefillEnabled,
      targetType: item.targetType,
      clientRequirement: item.clientReq,
      isActive: true,
      tenantId: 'all',
    };

    if (!existing) {
      await prisma.service.create({
        data: {
          ...payload,
          category: { connect: { id: category.id } },
          provider: { connect: { id: mockProvider.id } },
        },
      });
      createdCount++;
    } else {
      await prisma.service.update({
        where: { id: existing.id },
        data: payload,
      });
      updatedCount++;
    }
  }

  const finalTotal = await prisma.service.count();
  console.log(`🎉 Enterprise Catalog Successfully Populated! Created: ${createdCount}, Updated: ${updatedCount}. Total services in database: ${finalTotal}`);
}

main()
  .catch((e) => {
    console.error('Error seeding enterprise catalog:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
