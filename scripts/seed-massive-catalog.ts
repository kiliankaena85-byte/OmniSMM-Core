import { PrismaClient } from '@prisma/client';
import { VaultService } from '../src/lib/vault';

const prisma = new PrismaClient();

interface CuratedServiceDef {
  name: string;
  badge?: string;
  retailUnitRub: number; // Точная цена в рублях за 1 шт (со средней наценкой ~900% / 10.0x)
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
  requireWarning?: boolean;
  warningMessage?: string;
  clientConfirmation?: string;
  customDataType?: string;
  customDataLabel?: string;
  isMediaGroupAware?: boolean;
}

interface CuratedCategoryDef {
  name: string;
  services: CuratedServiceDef[];
}

interface CuratedNetworkDef {
  name: string;
  slug: string;
  icon: string;
  sort: number;
  categories: CuratedCategoryDef[];
}

const USD_TO_RUB = 95.0;

const MASSIVE_CATALOG: CuratedNetworkDef[] = [
  // ══════════════════════════════════════════════════════════════
  // 1. TELEGRAM (35+ услуг)
  // ══════════════════════════════════════════════════════════════
  {
    name: 'Telegram',
    slug: 'telegram',
    icon: 'telegram',
    sort: 1,
    categories: [
      {
        name: 'Подписчики',
        services: [
          {
            name: 'Telegram: Подписчики Эконом (Быстрый старт)',
            badge: '⚡️ Быстро',
            retailUnitRub: 0.24,
            rateUsd: 0.25,
            markup: 10.1,
            minQty: 10,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 15 000 в сутки',
            audience: 'Микс аккаунтов для массы и выхода в топ поиска',
            warranty: 'Эконом-тариф без автодокрутки',
            clientReq: 'Ссылка на открытый канал или группу (https://t.me/username)',
          },
          {
            name: 'Telegram: Подписчики Стандарт (Офферы РФ/СНГ с гарантией 30 дней)',
            badge: '🛡️ Refill 30d',
            retailUnitRub: 0.62,
            rateUsd: 0.65,
            markup: 10.04,
            minQty: 10,
            maxQty: 50000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '5–15 минут',
            speedPerDay: 'до 5 000 в сутки (плавный запуск)',
            audience: 'Качественные профили РФ и СНГ с аватарками и именами',
            warranty: '30 дней (автоматическое восстановление при списаниях)',
            clientReq: 'Ссылка на публичный канал или супергруппу (https://t.me/username)',
          },
          {
            name: 'Telegram: Премиум подписчики (Реальные профили, 0% списаний)',
            badge: '💎 Премиум HQ',
            retailUnitRub: 1.35,
            rateUsd: 1.40,
            markup: 10.15,
            minQty: 25,
            maxQty: 20000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '10–30 минут',
            speedPerDay: 'до 2 000 в сутки (максимально органично)',
            audience: 'Живая активная аудитория с Premium-статусами и историей',
            warranty: '60 дней 100% гарантия от отписок',
            clientReq: 'Ссылка на открытый канал или группу (https://t.me/username)',
          },
          {
            name: 'Telegram: Подписчики в ЗАКРЫТЫЙ канал / группу (Приватные ссылки t.me/+)',
            badge: '🔒 Для закрытых',
            retailUnitRub: 0.81,
            rateUsd: 0.85,
            markup: 10.03,
            minQty: 10,
            maxQty: 30000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '5–20 минут',
            speedPerDay: 'до 3 000 в сутки',
            audience: 'Офферные профили с автоприемом заявок',
            warranty: '30 дней гарантии',
            clientReq: 'Приватная ссылка-приглашение формата https://t.me/+...',
          },
          {
            name: 'Telegram: Подписчики Женская аудитория (РФ/СНГ)',
            badge: '👩 Женские',
            retailUnitRub: 0.95,
            rateUsd: 1.00,
            markup: 10.0,
            minQty: 20,
            maxQty: 15000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '15–30 минут',
            speedPerDay: 'до 2 500 в сутки',
            audience: 'Строго женские аккаунты с русскими именами и фото',
            warranty: '30 дней гарантии',
            clientReq: 'Ссылка на канал (бьюти, мода, семья, кулинария)',
          },
          {
            name: 'Telegram: Подписчики Мужская аудитория (РФ/СНГ)',
            badge: '👨 Мужские',
            retailUnitRub: 0.95,
            rateUsd: 1.00,
            markup: 10.0,
            minQty: 20,
            maxQty: 15000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '15–30 минут',
            speedPerDay: 'до 2 500 в сутки',
            audience: 'Строго мужские аккаунты с русскими именами и фото',
            warranty: '30 дней гарантии',
            clientReq: 'Ссылка на канал (авто, крипта, бизнес, спорт)',
          },
          {
            name: 'Telegram: Подписчики с гарантией 365 дней (VIP Ultra)',
            badge: '👑 Гарантия 1 год',
            retailUnitRub: 1.95,
            rateUsd: 2.00,
            markup: 10.26,
            minQty: 50,
            maxQty: 10000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '30 минут',
            speedPerDay: 'до 1 000 в сутки',
            audience: 'Элитные профили с максимальным трастом',
            warranty: '365 дней автоматической докрутки',
            clientReq: 'Ссылка на канал',
          },
        ],
      },
      {
        name: 'Просмотры',
        services: [
          {
            name: 'Telegram: Просмотры на 1 пост (Быстрый охват)',
            badge: '⚡️ Мгновенно',
            retailUnitRub: 0.02,
            rateUsd: 0.001,
            markup: 210.5,
            minQty: 100,
            maxQty: 500000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–3 секунды',
            speedPerDay: 'до 1 000 000 в сутки',
            audience: 'Реалистичный просмотр с плавным удержанием в ленте',
            warranty: 'Без списаний (навсегда)',
            clientReq: 'Прямая ссылка на конкретный пост (например: https://t.me/durov/123)',
          },
          {
            name: 'Telegram: Просмотры на последние 5 постов',
            badge: '📊 На 5 постов',
            retailUnitRub: 0.05,
            rateUsd: 0.005,
            markup: 105.3,
            minQty: 100,
            maxQty: 200000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: '1–5 минут',
            speedPerDay: 'Равномерно на 5 последних записей',
            audience: 'Умный охват для создания красивой статистики канала',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на канал',
          },
          {
            name: 'Telegram: Просмотры на последние 10 постов',
            badge: '📊 На 10 постов',
            retailUnitRub: 0.08,
            rateUsd: 0.01,
            markup: 84.2,
            minQty: 100,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: '1–5 минут',
            speedPerDay: 'Равномерно на 10 последних записей',
            audience: 'Умный охват для TGStat и Telemetr',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на канал',
          },
          {
            name: 'Telegram: Просмотры на последние 20 постов',
            badge: '📊 На 20 постов',
            retailUnitRub: 0.15,
            rateUsd: 0.02,
            markup: 78.9,
            minQty: 100,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: '5 минут',
            speedPerDay: 'Равномерно на 20 постов',
            audience: 'Комплексный прогрев всего канала',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на канал',
          },
          {
            name: 'Telegram: Автопросмотры на новые посты (Подписка на 7 дней)',
            badge: '🤖 Авто 7 дней',
            retailUnitRub: 0.35,
            rateUsd: 0.35,
            markup: 10.5,
            minQty: 100,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: 'Мгновенно при выходе нового поста',
            speedPerDay: 'До 5 постов в день',
            audience: 'Автоматический бот-мониторинг ленты',
            warranty: 'Гарантия активности на 7 дней',
            clientReq: 'Ссылка на публичный канал',
          },
          {
            name: 'Telegram: Автопросмотры на новые посты (Подписка на 30 дней)',
            badge: '🤖 Авто 30 дней',
            retailUnitRub: 0.85,
            rateUsd: 0.90,
            markup: 9.94,
            minQty: 100,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: 'Мгновенно при публикации',
            speedPerDay: 'До 10 постов в день',
            audience: 'Полный месячный авто-охват без ручных заказов',
            warranty: 'Гарантия активности на 30 дней',
            clientReq: 'Ссылка на публичный канал',
          },
        ],
      },
      {
        name: 'Реакции',
        services: [
          {
            name: 'Telegram: Позитивный микс реакций (👍 ❤️ 🔥 🎉 👏)',
            badge: '🔥 Топ Микс',
            retailUnitRub: 0.05,
            rateUsd: 0.005,
            markup: 105.3,
            minQty: 10,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '10–30 секунд',
            speedPerDay: 'до 50 000 в сутки',
            audience: 'Случайное гармоничное распределение одобрительных эмодзи',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на пост с включенными соответствующими реакциями',
          },
          {
            name: 'Telegram: Премиум-реакции от Premium аккаунтов (💎 ⭐ 🦄 🚀)',
            badge: '💎 Premium Stars',
            retailUnitRub: 0.15,
            rateUsd: 0.02,
            markup: 78.9,
            minQty: 5,
            maxQty: 10000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 5 000 в сутки',
            audience: 'Только аккаунты с активной Telegram Premium подпиской',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на пост',
          },
          {
            name: 'Telegram: Реакции 👍 Лайк (Thumbs Up)',
            badge: '👍 Лайк',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.2,
            minQty: 10,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: 'Мгновенно',
            speedPerDay: 'до 50 000 в сутки',
            audience: 'Точечная реакция палец вверх',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на пост',
          },
          {
            name: 'Telegram: Реакции ❤️ Сердце (Red Heart)',
            badge: '❤️ Сердце',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.2,
            minQty: 10,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: 'Мгновенно',
            speedPerDay: 'до 50 000 в сутки',
            audience: 'Точечная реакция сердечко',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на пост',
          },
          {
            name: 'Telegram: Реакции 🔥 Огонь (Fire)',
            badge: '🔥 Огонь',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.2,
            minQty: 10,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: 'Мгновенно',
            speedPerDay: 'до 50 000 в сутки',
            audience: 'Точечная реакция огонь',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на пост',
          },
          {
            name: 'Telegram: Реакции ⚡️ Молния (Lightning)',
            badge: '⚡️ Молния',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.2,
            minQty: 10,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: 'Мгновенно',
            speedPerDay: 'до 50 000 в сутки',
            audience: 'Точечная реакция молния',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на пост',
          },
          {
            name: 'Telegram: Негативный хейт-микс (👎 💩 🤮 🤬)',
            badge: '🤬 Хейт Микс',
            retailUnitRub: 0.07,
            rateUsd: 0.007,
            markup: 105.3,
            minQty: 10,
            maxQty: 25000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 20 000 в сутки',
            audience: 'Негативные реакции для разогрева дискуссий',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на пост',
          },
        ],
      },
      {
        name: 'Бусты и Истории (Boosts & Stories)',
        services: [
          {
            name: 'Telegram: Бусты для канала (Telegram Boosts Level 1–10)',
            badge: '🚀 Бусты',
            retailUnitRub: 35.0,
            rateUsd: 3.5,
            markup: 10.53,
            minQty: 1,
            maxQty: 500,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '5–15 минут',
            speedPerDay: 'до 100 бустов в день',
            audience: 'Реальные голоса Telegram Premium для открытия публикации историй',
            warranty: '30 дней удержания буста',
            clientReq: 'Ссылка на буст канала (https://t.me/boost/username)',
          },
          {
            name: 'Telegram: Просмотры историй / Stories на канале',
            badge: '👁 Stories',
            retailUnitRub: 0.08,
            rateUsd: 0.008,
            markup: 105.3,
            minQty: 50,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'PROFILE',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 100 000 в сутки',
            audience: 'Охват историй от живых аккаунтов',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на канал с активной историей',
          },
        ],
      },
      {
        name: 'Голосования и Опросы',
        services: [
          {
            name: 'Telegram: Голоса в публичный опрос (Выбор варианта 1-10)',
            badge: '🗳 Опросы',
            retailUnitRub: 0.35,
            rateUsd: 0.35,
            markup: 10.53,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '5–10 минут',
            speedPerDay: 'до 10 000 в день',
            audience: 'Реальные голоса за указанный пункт опроса',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на опрос и номер варианта ответа',
          },
          {
            name: 'Telegram: Голоса в закрытые викторины (Quiz)',
            badge: '🎯 Викторины',
            retailUnitRub: 0.45,
            rateUsd: 0.45,
            markup: 10.53,
            minQty: 20,
            maxQty: 10000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '5–15 минут',
            speedPerDay: 'до 5 000 в день',
            audience: 'Голосование с автоматическим выбором правильного ответа',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на викторину',
          },
        ],
      },
      {
        name: 'Комментарии и Репосты',
        services: [
          {
            name: 'Telegram: Кастомные комментарии (Свой текст со смыслом)',
            badge: '✍️ Свой текст',
            retailUnitRub: 1.15,
            rateUsd: 1.20,
            markup: 10.09,
            minQty: 5,
            maxQty: 2000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '10–25 минут',
            speedPerDay: 'до 1 000 в сутки (по 1 комментарию каждые пару минут)',
            audience: 'Профили с русскими именами и тематическими текстами',
            warranty: 'Без удаления',
            clientReq: 'Ссылка на пост в канале с открытой веткой обсуждений',
          },
          {
            name: 'Telegram: Репосты и пересылки в каналы / чаты',
            badge: '📢 Репосты',
            retailUnitRub: 0.25,
            rateUsd: 0.25,
            markup: 10.53,
            minQty: 20,
            maxQty: 15000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '5–15 минут',
            speedPerDay: 'до 5 000 в сутки',
            audience: 'Пересылка постов в публичные группы для вирального охвата',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на пост в канале',
          },
        ],
      },
      {
        name: 'Прямой эфир (Стримы)',
        services: [
          {
            name: 'Telegram: Зрители на прямой эфир / трансляцию (30 минут онлайн)',
            badge: '🔴 Live 30m',
            retailUnitRub: 1.45,
            rateUsd: 1.50,
            markup: 10.18,
            minQty: 10,
            maxQty: 5000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: '1–5 минут после старта эфира',
            speedPerDay: 'Мгновенное удержание онлайна на 30 минут',
            audience: 'Живой онлайн зрителей в списке участников видеочата',
            warranty: 'Стабильное удержание таймера',
            clientReq: 'Ссылка на запущенную трансляцию или голосовой чат',
          },
          {
            name: 'Telegram: Зрители на прямой эфир (60 минут онлайн)',
            badge: '🔴 Live 60m',
            retailUnitRub: 2.65,
            rateUsd: 2.70,
            markup: 10.33,
            minQty: 10,
            maxQty: 3000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: '1–5 минут',
            speedPerDay: 'Удержание онлайна 1 час',
            audience: 'Стабильные зрители на вебинары и стримы',
            warranty: 'Полный час онлайна',
            clientReq: 'Ссылка на трансляцию',
          },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // 2. ВКОНТАКТЕ (VK) (25+ услуг)
  // ══════════════════════════════════════════════════════════════
  {
    name: 'ВКонтакте',
    slug: 'vk',
    icon: 'vk',
    sort: 2,
    categories: [
      {
        name: 'Подписчики / Группы',
        services: [
          {
            name: 'VK: Подписчики в группу / паблик (Эконом)',
            badge: '⚡️ Эконом',
            retailUnitRub: 0.29,
            rateUsd: 0.30,
            markup: 10.18,
            minQty: 50,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: '5–15 минут',
            speedPerDay: 'до 10 000 в сутки',
            audience: 'Базовые профили для счетчика группы',
            warranty: 'Эконом-тариф',
            clientReq: 'Ссылка на открытую группу или паблик VK',
          },
          {
            name: 'VK: Живые участники в сообщество (HQ с гарантией 30 дней)',
            badge: '🛡️ Refill 30d',
            retailUnitRub: 0.81,
            rateUsd: 0.85,
            markup: 10.03,
            minQty: 25,
            maxQty: 30000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '10–30 минут',
            speedPerDay: 'до 3 000 в сутки (без банов и собачек)',
            audience: 'Качественные русские профили с друзьями, стеной и фото',
            warranty: '30 дней автодокрутки от собачек',
            clientReq: 'Ссылка на открытое сообщество',
          },
          {
            name: 'VK: Друзья / Подписчики на личную страницу',
            badge: '👤 Друзья',
            retailUnitRub: 0.65,
            rateUsd: 0.65,
            markup: 10.53,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: true,
            targetType: 'PROFILE',
            startSpeed: '10–20 минут',
            speedPerDay: 'до 2 000 в сутки',
            audience: 'Профили пользователей РФ для личных блогов и страниц',
            warranty: '30 дней гарантии',
            clientReq: 'Ссылка на личную страницу VK (https://vk.com/username)',
          },
          {
            name: 'VK: Подписчики с таргетом по РФ (Премиум)',
            badge: '🇷🇺 Таргет РФ',
            retailUnitRub: 1.25,
            rateUsd: 1.30,
            markup: 10.12,
            minQty: 20,
            maxQty: 10000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '30 минут',
            speedPerDay: 'до 1 500 в сутки',
            audience: 'Реальные пользователи из РФ с высокой активностью',
            warranty: '60 дней гарантии',
            clientReq: 'Ссылка на сообщество',
          },
        ],
      },
      {
        name: 'Лайки',
        services: [
          {
            name: 'VK: Лайки на запись или фото (Живые пользователи РФ)',
            badge: '❤️ Лайки РФ',
            retailUnitRub: 0.05,
            rateUsd: 0.005,
            markup: 105.3,
            minQty: 10,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 30 000 в сутки',
            audience: 'Офферные профили с плавным распределением сердечек',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост, фото или видеозапись VK',
          },
          {
            name: 'VK: Быстрые лайки (Мгновенный старт)',
            badge: '⚡️ Мгновенно',
            retailUnitRub: 0.04,
            rateUsd: 0.004,
            markup: 105.3,
            minQty: 20,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '30 секунд',
            speedPerDay: 'до 50 000 в сутки',
            audience: 'Быстрый буст лайков для конкурса или фото',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на публикацию',
          },
          {
            name: 'VK: Автолайки на новые посты (10 будущих записей)',
            badge: '🤖 Авто 10 постов',
            retailUnitRub: 0.45,
            rateUsd: 0.45,
            markup: 10.53,
            minQty: 10,
            maxQty: 10000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: 'Мгновенно при выходе поста',
            speedPerDay: 'Автоматически',
            audience: 'Плавный автолайкинг на свежие публикации',
            warranty: 'Гарантия выполнения',
            clientReq: 'Ссылка на группу или профиль',
          },
        ],
      },
      {
        name: 'Просмотры',
        services: [
          {
            name: 'VK: Просмотры на запись / пост (Умная лента)',
            badge: '👁 Просмотры',
            retailUnitRub: 0.02,
            rateUsd: 0.001,
            markup: 210.5,
            minQty: 100,
            maxQty: 1000000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–3 секунды',
            speedPerDay: 'до 500 000 в сутки',
            audience: 'Повышает охват публикации и ранжирование алгоритмом VK',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на пост VK',
          },
          {
            name: 'VK: Просмотры на Клипы / VK Clips (Попадание в тренды)',
            badge: '🎬 Клипы',
            retailUnitRub: 0.03,
            rateUsd: 0.002,
            markup: 157.9,
            minQty: 100,
            maxQty: 500000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 200 000 в сутки',
            audience: 'Качественные просмотры с удержанием для попадания в рекомендации Клипов',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на Клип VK',
          },
          {
            name: 'VK: Просмотры видеозаписей',
            badge: '📹 Видео',
            retailUnitRub: 0.03,
            rateUsd: 0.002,
            markup: 157.9,
            minQty: 100,
            maxQty: 300000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '5 минут',
            speedPerDay: 'до 100 000 в сутки',
            audience: 'Просмотры для счетчика плеера VK Video',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на видео VK',
          },
        ],
      },
      {
        name: 'Репосты и Комментарии',
        services: [
          {
            name: 'VK: Репосты на стены пользователей (Поделиться записью)',
            badge: '📢 Репосты',
            retailUnitRub: 0.35,
            rateUsd: 0.35,
            markup: 10.53,
            minQty: 10,
            maxQty: 10000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '5–15 минут',
            speedPerDay: 'до 5 000 в сутки',
            audience: 'Репосты на реальные стены профилей с друзьями',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на пост VK',
          },
          {
            name: 'VK: Кастомные комментарии (Свой текст отзывов)',
            badge: '✍️ Отзывы',
            retailUnitRub: 1.50,
            rateUsd: 1.50,
            markup: 10.53,
            minQty: 5,
            maxQty: 2000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '15–30 минут',
            speedPerDay: 'до 500 в сутки (плавно)',
            audience: 'Реалистичные комментарии от русских пользователей',
            warranty: 'Без удаления',
            clientReq: 'Ссылка на пост или товар VK',
          },
          {
            name: 'VK: Прослушивания музыки / плейлиста',
            badge: '🎵 Музыка',
            retailUnitRub: 0.15,
            rateUsd: 0.015,
            markup: 105.3,
            minQty: 100,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'CUSTOM',
            startSpeed: '10–30 минут',
            speedPerDay: 'до 10 000 в сутки',
            audience: 'Прослушивания треков для попадания в чарты VK Music',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на трек или плейлист VK',
          },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // 3. INSTAGRAM (20+ услуг)
  // ══════════════════════════════════════════════════════════════
  {
    name: 'Instagram',
    slug: 'instagram',
    icon: 'instagram',
    sort: 3,
    categories: [
      {
        name: 'Подписчики',
        services: [
          {
            name: 'Instagram: Подписчики Эконом (Для объема)',
            badge: '⚡️ Эконом',
            retailUnitRub: 0.34,
            rateUsd: 0.35,
            markup: 10.23,
            minQty: 50,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'PROFILE',
            startSpeed: '5–15 минут',
            speedPerDay: 'до 15 000 в сутки',
            audience: 'Микс аккаунтов для увеличения числа фолловеров',
            warranty: 'Эконом-тариф',
            clientReq: 'Прямая ссылка на открытый профиль Instagram',
          },
          {
            name: 'Instagram: Подписчики HQ (СНГ с гарантией 30 дней)',
            badge: '🛡️ Refill 30d',
            retailUnitRub: 0.91,
            rateUsd: 0.95,
            markup: 10.08,
            minQty: 25,
            maxQty: 50000,
            isRefillEnabled: true,
            targetType: 'PROFILE',
            startSpeed: '10–30 минут',
            speedPerDay: 'до 3 000 в сутки (плавный ход)',
            audience: 'Качественные профили с аватарками, постами и сторис',
            warranty: '30 дней (автодокрутка при отписках)',
            clientReq: 'Ссылка на открытый профиль (профиль должен быть публичным)',
          },
          {
            name: 'Instagram: Подписчики Премиум с историей (0% списаний)',
            badge: '💎 Премиум',
            retailUnitRub: 1.65,
            rateUsd: 1.70,
            markup: 10.22,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: true,
            targetType: 'PROFILE',
            startSpeed: '15–45 минут',
            speedPerDay: 'до 1 500 в сутки',
            audience: 'Старые трастовые аккаунты с высокой активностью',
            warranty: '60 дней гарантии',
            clientReq: 'Ссылка на публичный профиль',
          },
        ],
      },
      {
        name: 'Лайки и Охват',
        services: [
          {
            name: 'Instagram: Лайки на фото / Reels (Мгновенный старт)',
            badge: '⚡️ Мгновенно',
            retailUnitRub: 0.04,
            rateUsd: 0.003,
            markup: 140.4,
            minQty: 20,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '30–60 секунд',
            speedPerDay: 'до 100 000 в сутки',
            audience: 'Офферные профили для быстрого вывода в топ по хештегам',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на открытый пост или Reels',
          },
          {
            name: 'Instagram: Лайки от реальных пользователей (HQ)',
            badge: '❤️ HQ Лайки',
            retailUnitRub: 0.12,
            rateUsd: 0.012,
            markup: 105.3,
            minQty: 10,
            maxQty: 25000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 20 000 в сутки',
            audience: 'Живые профили со славянскими именами',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на пост',
          },
          {
            name: 'Instagram: Сохранения публикации + Охват',
            badge: '🔖 Сохранения',
            retailUnitRub: 0.06,
            rateUsd: 0.005,
            markup: 126.3,
            minQty: 50,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 30 000 в сутки',
            audience: 'Увеличивает охват в разделе «Интересное»',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на публикацию',
          },
        ],
      },
      {
        name: 'Просмотры и Stories',
        services: [
          {
            name: 'Instagram: Просмотры Reels (Выход в рекомендации)',
            badge: '🎬 Reels',
            retailUnitRub: 0.02,
            rateUsd: 0.001,
            markup: 210.5,
            minQty: 100,
            maxQty: 1000000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: 'Мгновенно',
            speedPerDay: 'до 1 000 000 в сутки',
            audience: 'Быстрые просмотры для алгоритма рекомендаций Reels',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на Reels',
          },
          {
            name: 'Instagram: Просмотры всех активных Stories',
            badge: '👁 Stories',
            retailUnitRub: 0.05,
            rateUsd: 0.004,
            markup: 131.6,
            minQty: 50,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'PROFILE',
            startSpeed: '5 минут',
            speedPerDay: 'Равномерно на все активные истории',
            audience: 'Просмотр всех сторис профиля',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на профиль с активными историями',
          },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // 4. YOUTUBE (15+ услуг)
  // ══════════════════════════════════════════════════════════════
  {
    name: 'YouTube',
    slug: 'youtube',
    icon: 'youtube',
    sort: 4,
    categories: [
      {
        name: 'Просмотры',
        services: [
          {
            name: 'YouTube: Просмотры с высоким удержанием (Алгоритмы / Поиск)',
            badge: '📈 High Retention',
            retailUnitRub: 1.15,
            rateUsd: 1.20,
            markup: 10.09,
            minQty: 100,
            maxQty: 1000000,
            isRefillEnabled: true,
            targetType: 'POST',
            startSpeed: '15–60 минут',
            speedPerDay: 'до 50 000 в сутки (плавно и безопасно)',
            audience: 'Реалистичный просмотр с удержанием 60–90% хронометража',
            warranty: '30 дней гарантии от списаний YouTube',
            clientReq: 'Прямая ссылка на открытое видео (видео не должно иметь ограничений)',
          },
          {
            name: 'YouTube: Просмотры для Shorts (Быстрый старт)',
            badge: '⚡️ Shorts',
            retailUnitRub: 0.65,
            rateUsd: 0.65,
            markup: 10.53,
            minQty: 100,
            maxQty: 500000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '5–15 минут',
            speedPerDay: 'до 100 000 в сутки',
            audience: 'Быстрые просмотры для ленты Shorts',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на YouTube Shorts',
          },
        ],
      },
      {
        name: 'Подписчики и Лайки',
        services: [
          {
            name: 'YouTube: Подписчики на канал (Гарантия 30 дней)',
            badge: '🛡️ Refill 30d',
            retailUnitRub: 4.30,
            rateUsd: 4.50,
            markup: 10.06,
            minQty: 10,
            maxQty: 10000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '1–3 часа',
            speedPerDay: 'до 300–500 в сутки (органично)',
            audience: 'Качественные профили с историей просмотров',
            warranty: '30 дней автоматической докрутки',
            clientReq: 'Ссылка на канал (https://youtube.com/@channel)',
          },
          {
            name: 'YouTube: Лайки на видео (Органические)',
            badge: '👍 Лайки',
            retailUnitRub: 0.45,
            rateUsd: 0.45,
            markup: 10.53,
            minQty: 20,
            maxQty: 50000,
            isRefillEnabled: true,
            targetType: 'POST',
            startSpeed: '15 минут',
            speedPerDay: 'до 10 000 в сутки',
            audience: 'Живые пользователи с аккаунтами Google',
            warranty: '30 дней гарантии',
            clientReq: 'Ссылка на видео',
          },
          {
            name: 'YouTube: 4000 часов просмотров (Для монетизации)',
            badge: '💰 Монетизация',
            retailUnitRub: 25.0,
            rateUsd: 2.50,
            markup: 10.53,
            minQty: 100,
            maxQty: 4000,
            isRefillEnabled: true,
            targetType: 'POST',
            startSpeed: '2–6 часов',
            speedPerDay: 'Равномерно до 500 часов в день',
            audience: 'Длинные просмотры на видео от 60 минут',
            warranty: 'Гарантия зачета в YouTube Studio',
            clientReq: 'Ссылка на видео длиной от 60 минут',
          },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // 5. TIKTOK (10+ услуг)
  // ══════════════════════════════════════════════════════════════
  {
    name: 'TikTok',
    slug: 'tiktok',
    icon: 'tiktok',
    sort: 5,
    categories: [
      {
        name: 'Просмотры и Лайки',
        services: [
          {
            name: 'TikTok: Просмотры видео (Выход в реки)',
            badge: '⚡️ Рекомендации',
            retailUnitRub: 0.02,
            rateUsd: 0.001,
            markup: 210.5,
            minQty: 100,
            maxQty: 1000000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: 'Мгновенно',
            speedPerDay: 'до 1 000 000 в сутки',
            audience: 'Моментальный старт для попадания в алгоритм For You',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на видео TikTok',
          },
          {
            name: 'TikTok: Лайки на видео (Быстрые)',
            badge: '❤️ Лайки',
            retailUnitRub: 0.15,
            rateUsd: 0.015,
            markup: 105.3,
            minQty: 20,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 20 000 в сутки',
            audience: 'Офферные профили с аватарками',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на видео',
          },
          {
            name: 'TikTok: Подписчики на аккаунт (С гарантией)',
            badge: '🛡️ Подписчики',
            retailUnitRub: 0.95,
            rateUsd: 1.00,
            markup: 10.0,
            minQty: 25,
            maxQty: 25000,
            isRefillEnabled: true,
            targetType: 'PROFILE',
            startSpeed: '15 минут',
            speedPerDay: 'до 2 000 в сутки',
            audience: 'Качественные фолловеры для открытия функции стримов (1000+)',
            warranty: '30 дней гарантии',
            clientReq: 'Ссылка на профиль TikTok',
          },
          {
            name: 'TikTok: Репосты (Поделиться видео)',
            badge: '📢 Репосты',
            retailUnitRub: 0.08,
            rateUsd: 0.008,
            markup: 105.3,
            minQty: 50,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 50 000 в сутки',
            audience: 'Повышает виральность ролика в ленте',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на видео',
          },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // 6. TWITCH (5+ услуг)
  // ══════════════════════════════════════════════════════════════
  {
    name: 'Twitch',
    slug: 'twitch',
    icon: 'twitch',
    sort: 6,
    categories: [
      {
        name: 'Зрители на стрим',
        services: [
          {
            name: 'Twitch: Зрители на прямой эфир (1 час онлайна)',
            badge: '🔴 Live 1h',
            retailUnitRub: 4.50,
            rateUsd: 0.45,
            markup: 10.53,
            minQty: 10,
            maxQty: 2000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: '3–5 минут',
            speedPerDay: 'Удержание 60 минут',
            audience: 'Стабильный онлайн для партнерки Twitch',
            warranty: 'Стабильный таймер',
            clientReq: 'Ссылка на Twitch канал',
          },
          {
            name: 'Twitch: Фолловеры на канал (Гарантия 30 дней)',
            badge: '🛡️ Фолловеры',
            retailUnitRub: 0.45,
            rateUsd: 0.45,
            markup: 10.53,
            minQty: 25,
            maxQty: 25000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '10 минут',
            speedPerDay: 'до 5 000 в сутки',
            audience: 'Профили пользователей для расширения базы',
            warranty: '30 дней',
            clientReq: 'Ссылка на канал',
          },
        ],
      },
    ],
  },

  // ══════════════════════════════════════════════════════════════
  // 7. RUTUBE & ДЗЕН (5+ услуг)
  // ══════════════════════════════════════════════════════════════
  {
    name: 'RuTube & Дзен',
    slug: 'rutube',
    icon: 'rutube',
    sort: 7,
    categories: [
      {
        name: 'RuTube',
        services: [
          {
            name: 'RuTube: Просмотры видео (Выход в ТОП)',
            badge: '🇷🇺 RuTube',
            retailUnitRub: 0.25,
            rateUsd: 0.25,
            markup: 10.53,
            minQty: 100,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '15 минут',
            speedPerDay: 'до 20 000 в сутки',
            audience: 'Реальные просмотры для алгоритмов RuTube',
            warranty: 'Без списаний',
            clientReq: 'Ссылка на видео RuTube',
          },
          {
            name: 'RuTube: Подписчики на канал',
            badge: '🛡️ Подписчики',
            retailUnitRub: 1.25,
            rateUsd: 1.30,
            markup: 10.12,
            minQty: 20,
            maxQty: 10000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '30 минут',
            speedPerDay: 'до 1 000 в сутки',
            audience: 'Профили пользователей РФ',
            warranty: '30 дней',
            clientReq: 'Ссылка на канал RuTube',
          },
        ],
      },
      {
        name: 'Дзен (Dzen)',
        services: [
          {
            name: 'Дзен: Дочитывания статей (Для монетизации)',
            badge: '📖 Дочитывания',
            retailUnitRub: 0.45,
            rateUsd: 0.45,
            markup: 10.53,
            minQty: 50,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '15 минут',
            speedPerDay: 'до 10 000 в сутки',
            audience: 'Полные дочитывания статей с удержанием 40+ секунд',
            warranty: 'Зачет в статистике Дзена',
            clientReq: 'Ссылка на статью Дзен',
          },
          {
            name: 'Дзен: Подписчики на канал',
            badge: '👤 Подписчики',
            retailUnitRub: 1.10,
            rateUsd: 1.10,
            markup: 10.53,
            minQty: 20,
            maxQty: 10000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '20 минут',
            speedPerDay: 'до 1 000 в сутки',
            audience: 'Активные читатели платформы Дзен',
            warranty: '30 дней',
            clientReq: 'Ссылка на канал Дзен',
          },
        ],
      },
    ],
  },
];

async function main() {
  const { CatalogLockGuard } = await import('../src/lib/catalog-lock');
  const isLocked = await CatalogLockGuard.isLocked().catch(() => true);
  const existingCats = await prisma.category.count();
  if (isLocked) {
    console.error(`⛔ [GUARD] Catalog is LOCKED & INVIOLABLE. Aborting seed-massive-catalog. Unlock via scripts/lock-database.ts unlock first.`);
    process.exit(1);
  }
  if (existingCats > 0 && !process.argv.includes('--force')) {
    console.error(`⛔ [GUARD] Database already contains ${existingCats} existing categories. Aborting seed-massive-catalog.`);
    process.exit(1);
  }
  console.log('🚀 Seeding Expanded Massive Catalog (50+ Curated Services) with 10.0x (+900%) Pricing Model...');

  // Ensure mock provider
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

  let totalServicesCreated = 0;

  for (const netDef of MASSIVE_CATALOG) {
    let network = await prisma.network.findFirst({
      where: { slug: netDef.slug },
    });

    if (!network) {
      network = await prisma.network.create({
        data: {
          name: netDef.name,
          slug: netDef.slug,
          icon: netDef.icon,
          sort: netDef.sort,
          isActive: true,
        },
      });
      console.log(`✅ Created Network: ${netDef.name}`);
    } else {
      console.log(`ℹ️ Found Network: ${netDef.name}`);
    }

    for (const catDef of netDef.categories) {
      let category = await prisma.category.findFirst({
        where: {
          name: catDef.name,
          networkId: network.id,
        },
      });

      if (!category) {
        category = await prisma.category.create({
          data: {
            name: catDef.name,
            network: { connect: { id: network.id } },
            tenantId: 'all',
            sort: 1,
          },
        });
        console.log(`  📁 Created Category: ${catDef.name}`);
      }

      for (const servDef of catDef.services) {
        const fullDesc = `⚡️ **Старт:** ${servDef.startSpeed}
🚀 **Скорость:** ${servDef.speedPerDay}
👥 **Аудитория:** ${servDef.audience}
🛡️ **Гарантия:** ${servDef.warranty}
⚠️ **Требования к ссылке:** ${servDef.clientReq}`;

        const pricePer1000Cents = Math.round(servDef.retailUnitRub * 1000 * 100);

        const existing = await prisma.service.findFirst({
          where: {
            name: servDef.name,
            categoryId: category.id,
          },
        });

        const servicePayload = {
          name: servDef.name,
          description: fullDesc,
          rate: servDef.rateUsd,
          markup: servDef.markup,
          pricePer1000Cents,
          minQty: servDef.minQty,
          maxQty: servDef.maxQty,
          isRefillEnabled: servDef.isRefillEnabled,
          targetType: servDef.targetType,
          clientRequirement: servDef.clientReq,
          isActive: true,
          tenantId: 'all',
        };

        if (!existing) {
          await prisma.service.create({
            data: {
              ...servicePayload,
              category: { connect: { id: category.id } },
              provider: { connect: { id: mockProvider.id } },
            },
          });
          totalServicesCreated++;
          console.log(`    ✨ Created Service: ${servDef.name} (${servDef.retailUnitRub.toFixed(2)} ₽/шт)`);
        } else {
          await prisma.service.update({
            where: { id: existing.id },
            data: servicePayload,
          });
          console.log(`    🔄 Updated Service: ${servDef.name} (${servDef.retailUnitRub.toFixed(2)} ₽/шт)`);
        }
      }
    }
  }

  console.log(`🎉 Expanded Catalog Successfully Populated! Total created/updated services.`);
}

main()
  .catch((e) => {
    console.error('Error seeding massive catalog:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
