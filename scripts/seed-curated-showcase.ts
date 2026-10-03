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

// Курс ЦБ РФ для базового расчета закупки
const USD_TO_RUB = 95.0;

const CURATED_CATALOG: CuratedNetworkDef[] = [
  // ── 1. TELEGRAM ──
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
            retailUnitRub: 0.24, // Закупка 0.0238 ₽ -> Наценка 10.1x (+910% маржа)
            rateUsd: 0.25,
            markup: 10.1,
            minQty: 10,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 15 000 в сутки',
            audience: 'Микс аккаунтов (для набора массы и выхода в топ поиска)',
            warranty: 'Эконом-тариф без автодокрутки',
            clientReq: 'Ссылка на открытый канал или группу (https://t.me/username)',
          },
          {
            name: 'Telegram: Подписчики Стандарт (Офферы РФ/СНГ с гарантией 30 дней)',
            badge: '🛡️ Refill 30d',
            retailUnitRub: 0.62, // Закупка 0.0618 ₽ -> Наценка 10.0x (+904% маржа)
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
            retailUnitRub: 1.35, // Закупка 0.1330 ₽ -> Наценка 10.1x (+915% маржа)
            rateUsd: 1.40,
            markup: 10.15,
            minQty: 25,
            maxQty: 20000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '10–30 минут',
            speedPerDay: 'до 2 000 в сутки (максимально органично)',
            audience: 'Живая активная аудитория с Premium-статусами и историей',
            warranty: '60 дней полная гарантия защиты от отписок',
            clientReq: 'Ссылка на публичный канал (https://t.me/username)',
          },
          {
            name: 'Telegram: Подписчики в ЗАКРЫТЫЙ канал / группу (Приватные ссылки t.me/+)',
            badge: '🔒 Закрытые каналы',
            retailUnitRub: 0.81, // Закупка 0.0808 ₽ -> Наценка 10.0x (+903% маржа)
            rateUsd: 0.85,
            markup: 10.03,
            minQty: 20,
            maxQty: 30000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '5–20 минут',
            speedPerDay: 'до 4 000 в сутки',
            audience: 'Офферы РФ/СНГ, вступающие по закрытой инвайт-ссылке',
            warranty: '30 дней автодокрутка при списаниях',
            clientReq: 'Постоянная инвайт-ссылка формата https://t.me/+AbCdEfGh (без заявок на вступление)',
            requireWarning: true,
            warningMessage: 'Канал должен быть закрытым, а ссылка должна быть постоянной инвайт-ссылкой (+ или joinchat). Функция "Заявки на вступление" должна быть отключена!',
            clientConfirmation: 'Я проверил, что ссылка постоянная и заявки на вступление отключены',
          },
        ],
      },
      {
        name: 'Авто-услуги и Боты',
        services: [
          {
            name: 'Telegram: Автопросмотры через бота-администратора (Мгновенно на все новые посты)',
            badge: '🤖 Авто-Бот',
            retailUnitRub: 0.43, // Закупка 0.0428 ₽ -> Наценка 10.0x (+905% маржа)
            rateUsd: 0.45,
            markup: 10.05,
            minQty: 100,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: 'Мгновенно (в течение 10 секунд после выхода поста)',
            speedPerDay: 'Неограниченно по числу новых постов',
            audience: 'Плавные просмотры от аудитории через веб-шлюз бота',
            warranty: 'Покрытие 30 следующих постов',
            clientReq: 'Ссылка на канал + добавление бота @VexViewBot в администраторы с правом публикации',
            requireWarning: true,
            warningMessage: 'Перед оформлением заказа обязательно добавьте сервисного бота в администраторы вашего канала. Бот отслеживает новые посты и моментально запускает на них просмотры.',
            clientConfirmation: 'Я добавил сервисного бота в администраторы канала',
          },
        ],
      },
      {
        name: 'Комментарии',
        services: [
          {
            name: 'Telegram: Кастомные комментарии (Свой текст со смыслом)',
            badge: '💬 Свой текст',
            retailUnitRub: 1.15, // Закупка 0.1140 ₽ -> Наценка 10.1x (+908% маржа)
            rateUsd: 1.20,
            markup: 10.08,
            minQty: 5,
            maxQty: 1000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '5–15 минут',
            speedPerDay: 'до 500 в сутки (естественные интервалы)',
            audience: 'Реальные профили РФ/СНГ, оставляющие ваш заданный текст',
            warranty: 'Несгораемые комментарии',
            clientReq: 'Прямая ссылка на пост в канале с открытыми комментариями',
            customDataType: 'TEXTAREA',
            customDataLabel: 'Введите текст комментариев (каждый комментарий с новой строки):',
            requireWarning: true,
            warningMessage: 'Убедитесь, что в канале подключен чат для комментариев и они открыты для всех пользователей!',
            clientConfirmation: 'Комментарии под постом открыты для всех',
          },
        ],
      },
      {
        name: 'Прямой эфир (Стримы)',
        services: [
          {
            name: 'Telegram: Зрители на прямой эфир / трансляцию (30 минут онлайн)',
            badge: '🔴 Live 30m',
            retailUnitRub: 1.45, // Закупка 0.1425 ₽ -> Наценка 10.2x (+917% маржа)
            rateUsd: 1.50,
            markup: 10.17,
            minQty: 20,
            maxQty: 5000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: '1–3 минуты (мгновенный вход)',
            speedPerDay: 'Удержание в онлайне 30 минут',
            audience: 'Аккаунты с эмуляцией живого присутствия на трансляции',
            warranty: 'Гарантия удержания счетчика онлайна',
            clientReq: 'Ссылка на канал, где ПРЯМО СЕЙЧАС идет голосовой или видео-чат',
            requireWarning: true,
            warningMessage: 'Трансляция должна быть уже запущена до момента оплаты! Если трансляция завершится раньше 30 минут, заказ считается выполненным.',
            clientConfirmation: 'Прямой эфир уже запущен и идет прямо сейчас',
          },
        ],
      },
      {
        name: 'Просмотры',
        services: [
          {
            name: 'Telegram: Просмотры на пост (Быстрый охват)',
            badge: '⚡️ Мгновенно',
            retailUnitRub: 0.02, // Закупка 0.000095 ₽ -> Сверхмаржа
            rateUsd: 0.001,
            markup: 210.5,
            minQty: 50,
            maxQty: 500000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: 'Мгновенно (30 секунд)',
            speedPerDay: 'до 100 000 в час',
            audience: 'Плавный охват для создания видимости живой ленты',
            warranty: 'Без списаний (накручивается навсегда)',
            clientReq: 'Прямая ссылка на конкретный пост (https://t.me/channel/123)',
          },
          {
            name: 'Telegram: Автопросмотры на 10 будущих постов',
            badge: '🔥 Хит',
            retailUnitRub: 0.08,
            rateUsd: 0.01,
            markup: 84.2,
            minQty: 100,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: 'Автоматически при выходе нового поста',
            speedPerDay: 'Сразу после публикации',
            audience: 'Имитация регулярного чтения канала подписчиками',
            warranty: 'Покрытие 10 следующих постов',
            clientReq: 'Ссылка на открытый канал (https://t.me/channel)',
          },
        ],
      },
      {
        name: 'Реакции',
        services: [
          // ── Комплексные наборы ──
          {
            name: 'Telegram: Позитивный микс реакций (👍 ❤️ 🔥 🎉 👏)',
            badge: '🌟 Топ Микс',
            retailUnitRub: 0.05,
            rateUsd: 0.005,
            markup: 105.2,
            minQty: 20,
            maxQty: 30000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–3 минуты',
            speedPerDay: 'до 10 000 в час (плавный поток)',
            audience: 'Случайный органичный микс положительных эмодзи от живых профилей',
            warranty: 'Несгораемые реакции навсегда',
            clientReq: 'Прямая ссылка на пост с включенными реакциями (t.me/channel/123)',
          },
          {
            name: 'Telegram: Смех и восторг микс (😂 🤣 🤩 🤯)',
            badge: '😂 Юмор',
            retailUnitRub: 0.05,
            rateUsd: 0.005,
            markup: 105.2,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 8 000 в час',
            audience: 'Микс эмоциональных реакций для развлекательных каналов и мемов',
            warranty: 'Несгораемые',
            clientReq: 'Прямая ссылка на пост с включенными реакциями',
          },
          {
            name: 'Telegram: Негативный микс / Хейт (👎 💩 🤮 🤬)',
            badge: '👎 Негатив',
            retailUnitRub: 0.07,
            rateUsd: 0.008,
            markup: 92.1,
            minQty: 20,
            maxQty: 15000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '2–10 минут',
            speedPerDay: 'до 5 000 в час',
            audience: 'Микс дизлайков и хейт-эмодзи для создания видимости споров',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост с открытыми негативными реакциями',
          },
          {
            name: 'Telegram: Премиум-реакции от Premium аккаунтов (💎 ⭐ 🦄 🚀)',
            badge: '💎 Premium',
            retailUnitRub: 0.15,
            rateUsd: 0.02,
            markup: 78.9,
            minQty: 10,
            maxQty: 10000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '5–15 минут',
            speedPerDay: 'до 3 000 в день',
            audience: 'Кастомные и премиальные эмодзи от реальных Telegram Premium пользователей',
            warranty: 'Высший траст канала',
            clientReq: 'Прямая ссылка на пост (канал должен поддерживать премиум реакции)',
          },
          {
            name: 'Telegram: Автореакции на 10 будущих постов (Позитивный микс)',
            badge: '🔄 Авто-Микс',
            retailUnitRub: 0.20,
            rateUsd: 0.025,
            markup: 84.2,
            minQty: 20,
            maxQty: 10000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: 'Мгновенно при выходе нового поста',
            speedPerDay: 'Сразу после публикации',
            audience: 'Автоматическая простановка позитивных реакций на каждый новый пост',
            warranty: 'Покрытие 10 следующих публикаций',
            clientReq: 'Ссылка на открытый канал (https://t.me/channel)',
          },

          // ── Единичные конкретные эмодзи ──
          {
            name: 'Telegram: Реакции 👍 Лайк (Thumbs Up)',
            badge: '👍 Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.1,
            minQty: 20,
            maxQty: 30000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 10 000 в час',
            audience: 'Только эмодзи 👍 от реальных профилей',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост',
          },
          {
            name: 'Telegram: Реакции ❤️ Сердце (Red Heart)',
            badge: '❤️ Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.1,
            minQty: 20,
            maxQty: 30000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 10 000 в час',
            audience: 'Только эмодзи ❤️',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост',
          },
          {
            name: 'Telegram: Реакции 🔥 Огонь (Fire)',
            badge: '🔥 Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.1,
            minQty: 20,
            maxQty: 30000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 10 000 в час',
            audience: 'Только эмодзи 🔥 (идеально для инсайдов и новостей)',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост',
          },
          {
            name: 'Telegram: Реакции 🎉 Праздник (Party Popper)',
            badge: '🎉 Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.1,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 8 000 в час',
            audience: 'Только эмодзи 🎉 для поздравлений и анонсов',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост',
          },
          {
            name: 'Telegram: Реакции 👏 Аплодисменты (Clapping)',
            badge: '👏 Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.1,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 8 000 в час',
            audience: 'Только эмодзи 👏',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост',
          },
          {
            name: 'Telegram: Реакции 😱 Шок / Удивление (Shock)',
            badge: '😱 Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.1,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 8 000 в час',
            audience: 'Только эмодзи 😱 для сенсаций и кликбейтов',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост',
          },
          {
            name: 'Telegram: Реакции 👎 Дизлайк (Dislike)',
            badge: '👎 Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.1,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '2–5 минут',
            speedPerDay: 'до 5 000 в час',
            audience: 'Только эмодзи 👎',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост',
          },
          {
            name: 'Telegram: Реакции 💩 Какашка (Poop)',
            badge: '💩 Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.1,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '2–5 минут',
            speedPerDay: 'до 5 000 в час',
            audience: 'Только эмодзи 💩 для хейт-атак и баттлов',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост',
          },
          {
            name: 'Telegram: Реакции 🤡 Клоун (Clown)',
            badge: '🤡 Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.1,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '2–5 минут',
            speedPerDay: 'до 5 000 в час',
            audience: 'Только эмодзи 🤡 для иронии и сарказма',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост',
          },
          {
            name: 'Telegram: Реакции ⚡️ Молния (Lightning)',
            badge: '⚡️ Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.002,
            markup: 263.1,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 8 000 в час',
            audience: 'Только эмодзи ⚡️ для срочных новостей',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост',
          },
        ],
      },
    ],
  },

  // ── 2. VKONTAKTE ──
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
            badge: '⚡️ Старт',
            retailUnitRub: 0.29, // Закупка 0.0285 ₽ -> Наценка 10.2x (+917% маржа)
            rateUsd: 0.30,
            markup: 10.17,
            minQty: 25,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'CHANNEL',
            startSpeed: '5–15 минут',
            speedPerDay: 'до 3 000 в сутки',
            audience: 'Базовые профили для создания первоначальной массы сообщества',
            warranty: 'Эконом (без гарантии от собачек)',
            clientReq: 'Ссылка на открытую группу или паблик (vk.com/club123)',
          },
          {
            name: 'VK: Живые участники в сообщество (HQ с гарантией 30 дней)',
            badge: '🛡️ Refill 30d',
            retailUnitRub: 0.81, // Закупка 0.0808 ₽ -> Наценка 10.0x (+903% маржа)
            rateUsd: 0.85,
            markup: 10.03,
            minQty: 20,
            maxQty: 25000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '15–30 минут',
            speedPerDay: 'до 1 500 в сутки (безопасно для фильтров ВК)',
            audience: 'Реальные пользователи РФ с аватарками, друзьями и стеной',
            warranty: '30 дней автодокрутка (минимальный % собачек < 3%)',
            clientReq: 'Ссылка на открытое сообщество (vk.com/public_name)',
          },
        ],
      },
      {
        name: 'Лайки',
        services: [
          {
            name: 'VK: Лайки на запись или фото (Живые пользователи РФ)',
            badge: '❤️ Топ',
            retailUnitRub: 0.05,
            rateUsd: 0.005,
            markup: 105.2,
            minQty: 20,
            maxQty: 30000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: 'Мгновенно (1–3 мин)',
            speedPerDay: 'до 5 000 в сутки',
            audience: 'Офферы РФ с заполненными страницами',
            warranty: 'Надежные несгораемые лайки',
            clientReq: 'Прямая ссылка на пост, фото или клип ВКонтакте',
          },
        ],
      },
      {
        name: 'Просмотры',
        services: [
          {
            name: 'VK: Просмотры на запись / клип (Умная лента)',
            badge: '👁 Охват',
            retailUnitRub: 0.02,
            rateUsd: 0.001,
            markup: 210.5,
            minQty: 100,
            maxQty: 1000000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 200 000 в сутки',
            audience: 'Вывод постов в рекомендации и умную ленту ВК',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост или видео',
          },
        ],
      },
      {
        name: 'Реакции',
        services: [
          {
            name: 'VK: Микс всех позитивных реакций (❤️ 🔥 👏 👍)',
            badge: '🌟 Топ Микс',
            retailUnitRub: 0.05,
            rateUsd: 0.005,
            markup: 105.2,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 10 000 в сутки',
            audience: 'Органичный микс разнообразных позитивных реакций от пользователей ВК',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост ВКонтакте',
          },
          {
            name: 'VK: Реакция 🔥 Огонь',
            badge: '🔥 Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.005,
            markup: 105.2,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 10 000 в сутки',
            audience: 'Только реакция 🔥 Огонь',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост ВКонтакте',
          },
          {
            name: 'VK: Реакция 😂 Смешно',
            badge: '😂 Одиночная',
            retailUnitRub: 0.05,
            rateUsd: 0.005,
            markup: 105.2,
            minQty: 20,
            maxQty: 20000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: '1–5 минут',
            speedPerDay: 'до 10 000 в сутки',
            audience: 'Только реакция 😂 Смешно',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на пост ВКонтакте',
          },
        ],
      },
    ],
  },

  // ── 3. INSTAGRAM ──
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
            retailUnitRub: 0.34, // Закупка 0.0333 ₽ -> Наценка 10.2x (+922% маржа)
            rateUsd: 0.35,
            markup: 10.22,
            minQty: 20,
            maxQty: 100000,
            isRefillEnabled: false,
            targetType: 'PROFILE',
            startSpeed: '5–10 минут',
            speedPerDay: 'до 10 000 в сутки',
            audience: 'Международные профили для визуального роста счетчика',
            warranty: 'Без гарантии',
            clientReq: 'Ссылка на открытый Instagram профиль (instagram.com/username)',
          },
          {
            name: 'Instagram: Подписчики HQ (СНГ с гарантией 30 дней)',
            badge: '🛡️ Refill 30d',
            retailUnitRub: 0.91, // Закупка 0.0903 ₽ -> Наценка 10.1x (+908% маржа)
            rateUsd: 0.95,
            markup: 10.08,
            minQty: 20,
            maxQty: 30000,
            isRefillEnabled: true,
            targetType: 'PROFILE',
            startSpeed: '10–30 минут',
            speedPerDay: 'до 3 000 в сутки',
            audience: 'Профили с публикациями, сторис и русскоязычными именами',
            warranty: '30 дней автодокрутка при отписках',
            clientReq: 'Ссылка на открытый профиль. Отключите "Пометить для проверки"',
          },
        ],
      },
      {
        name: 'Лайки',
        services: [
          {
            name: 'Instagram: Лайки на фото / Reels (Мгновенный старт)',
            badge: '🔥 Хит',
            retailUnitRub: 0.04,
            rateUsd: 0.003,
            markup: 140.3,
            minQty: 20,
            maxQty: 50000,
            isRefillEnabled: false,
            targetType: 'POST',
            startSpeed: 'Мгновенно (30 секунд)',
            speedPerDay: 'до 20 000 в час',
            audience: 'Профили со всего мира для продвижения Reels в рекомендации',
            warranty: 'Без списаний',
            clientReq: 'Прямая ссылка на публикацию или Reels',
          },
        ],
      },
    ],
  },

  // ── 4. YOUTUBE ──
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
            badge: '🎬 HQ Охват',
            retailUnitRub: 1.15, // Закупка 0.1140 ₽ -> Наценка 10.1x (+908% маржа)
            rateUsd: 1.20,
            markup: 10.08,
            minQty: 100,
            maxQty: 500000,
            isRefillEnabled: true,
            targetType: 'POST',
            startSpeed: '30–60 минут',
            speedPerDay: 'до 20 000 в сутки (плавный безопасный запуск)',
            audience: 'Естественный трафик с удержанием 2–5 минут, безопасный для монетизации',
            warranty: '30 дней гарантия от списаний YouTube',
            clientReq: 'Прямая ссылка на видео (youtube.com/watch?v=...)',
          },
        ],
      },
      {
        name: 'Подписчики',
        services: [
          {
            name: 'YouTube: Подписчики на канал (Гарантия 30 дней)',
            badge: '🛡️ Refill 30d',
            retailUnitRub: 4.30, // Закупка 0.4275 ₽ -> Наценка 10.1x (+905% маржа)
            rateUsd: 4.50,
            markup: 10.05,
            minQty: 10,
            maxQty: 5000,
            isRefillEnabled: true,
            targetType: 'CHANNEL',
            startSpeed: '1–3 часа',
            speedPerDay: 'до 200 в сутки (защита от алгоритмических фильтров)',
            audience: 'Качественные аккаунты Google с подтвержденными номерами',
            warranty: '30 дней автодокрутка',
            clientReq: 'Прямая ссылка на YouTube канал',
          },
        ],
      },
    ],
  },
];

async function main() {
  const { CatalogLockGuard } = await import('../src/lib/catalog-lock');
  const isLocked = await CatalogLockGuard.isLocked().catch(() => true);
  if (isLocked) {
    console.error('⛔ [INVIOLABLE DATABASE GUARD] Catalog is LOCKED. seed-curated-showcase is aborted.');
    process.exit(1);
  }

  console.log('🚀 Seeding Curated Showcase with ~900% Markup (10.0x Multiplier)...');

  // Update SystemSettings global markup to 10.0
  await prisma.systemSettings.upsert({
    where: { id: 'global' },
    update: { globalMarkup: 10.0 },
    create: {
      id: 'global',
      globalMarkup: 10.0,
    },
  });

  let provider = await prisma.provider.findFirst({ where: { name: 'Vexboost' } });
  if (!provider) {
    provider = await prisma.provider.create({
      data: {
        name: 'Vexboost',
        apiUrl: 'https://vexboost.ru/api/v2/',
        apiKey: VaultService.encrypt('dummy_key'),
        isActive: true,
      },
    });
  }

  for (const netDef of CURATED_CATALOG) {
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
          tenantId: 'all',
        },
      });
      console.log(`✅ Created Network: ${netDef.name}`);
    } else {
      await prisma.network.update({
        where: { id: network.id },
        data: { name: netDef.name, icon: netDef.icon, sort: netDef.sort, isActive: true, tenantId: 'all' },
      });
    }

    for (const catDef of netDef.categories) {
      let category = await prisma.category.findFirst({
        where: { networkId: network.id, name: catDef.name },
      });

      if (!category) {
        category = await prisma.category.create({
          data: {
            name: catDef.name,
            network: { connect: { id: network.id } },
            tenantId: 'all',
          },
        });
        console.log(`  📁 Created Category: ${catDef.name}`);
      }

      for (const srvDef of catDef.services) {
        const pricePer1000Cents = Math.round(srvDef.retailUnitRub * 1000 * 100);
        const purchaseCostUnitRub = (srvDef.rateUsd * USD_TO_RUB) / 1000;
        const actualMarginPercent = Math.round(((srvDef.retailUnitRub - purchaseCostUnitRub) / purchaseCostUnitRub) * 100);

        const structuredMarkdownDescription = [
          `⚡️ **Старт:** ${srvDef.startSpeed}`,
          `🚀 **Скорость:** ${srvDef.speedPerDay}`,
          `👥 **Аудитория:** ${srvDef.audience}`,
          srvDef.isRefillEnabled
            ? `🛡️ **Гарантия:** ${srvDef.warranty}`
            : `🔒 **Качество:** ${srvDef.warranty}`,
          `⚠️ **Требования к ссылке:** ${srvDef.clientReq}`,
        ].join('\n\n');

        let service = await prisma.service.findFirst({
          where: { categoryId: category.id, name: srvDef.name },
        });

        const servicePayload = {
          name: srvDef.name,
          description: structuredMarkdownDescription,
          rate: srvDef.rateUsd,
          markup: srvDef.markup,
          pricePer1000Cents,
          minQty: srvDef.minQty,
          maxQty: srvDef.maxQty,
          isRefillEnabled: srvDef.isRefillEnabled,
          targetType: srvDef.targetType,
          clientRequirement: srvDef.clientReq,
          requireWarning: Boolean(srvDef.requireWarning),
          warningMessage: srvDef.warningMessage || null,
          clientConfirmation: srvDef.clientConfirmation || null,
          customDataType: srvDef.customDataType || 'NONE',
          customDataLabel: srvDef.customDataLabel || null,
          isMediaGroupAware: Boolean(srvDef.isMediaGroupAware),
          isActive: true,
          tenantId: 'all',
        };

        if (!service) {
          service = await prisma.service.create({
            data: {
              ...servicePayload,
              category: { connect: { id: category.id } },
              provider: { connect: { id: provider.id } },
            },
          });
          console.log(`    ✨ Created Service: ${srvDef.name} (${srvDef.retailUnitRub.toFixed(2)} ₽/шт, Маржа: +${actualMarginPercent}%)`);
        } else {
          await prisma.service.update({
            where: { id: service.id },
            data: servicePayload,
          });
          console.log(`    🔄 Updated Service: ${srvDef.name} (${srvDef.retailUnitRub.toFixed(2)} ₽/шт, Маржа: +${actualMarginPercent}%)`);
        }
      }
    }
  }

  console.log('🎉 Curated Showcase Successfully Populated with ~900% Markup Model!');
}

main()
  .catch((e) => {
    console.error('Error seeding showcase:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
