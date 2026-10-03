import React from 'react';
import {
  Send,
  Share2,
  Camera,
  Video,
  PlaySquare,
  Radio,
} from 'lucide-react';

export interface CatalogServiceItem {
  id: string;
  title: string;
  badge?: string;
  speed: string;
  guarantee: string;
  minMax: string;
  pricePerUnit: string;
  isPopular?: boolean;
  customDataType?: 'NONE' | 'TEXTAREA' | 'NUMBER';
  customDataLabel?: string;
  customDataPlaceholder?: string;
}

export interface CatalogCategory {
  id: string;
  title: string;
  description?: string;
  iconName?: string;
  services: CatalogServiceItem[];
}

export interface CatalogPlatform {
  id: string;
  name: string;
  icon: React.ElementType;
  color: string;
  categories: CatalogCategory[];
}

export const ALL_PLATFORMS: CatalogPlatform[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    icon: Send,
    color: 'from-sky-500 to-blue-600',
    categories: [
      {
        id: 'tg-subs',
        title: 'Подписчики',
        services: [
          {
            id: 'tg-sub-1',
            title: 'Живые подписчики (РФ и СНГ)',
            badge: 'Хит продаж',
            speed: 'Мгновенный старт (1-3 мин)',
            guarantee: 'Гарантия от списаний: 30 дней',
            minMax: 'Лимиты: 50 — 100 000 шт',
            pricePerUnit: '0.18 ₽ / шт',
            isPopular: true,
          },
          {
            id: 'tg-sub-2',
            title: 'Премиум подписчики (TG Premium)',
            badge: 'Дают бусты',
            speed: 'Плавный старт (10-30 мин)',
            guarantee: 'Гарантия: 90 дней',
            minMax: 'Лимиты: 10 — 10 000 шт',
            pricePerUnit: '0.85 ₽ / шт',
          },
          {
            id: 'tg-sub-3',
            title: 'Подписчики (Мир)',
            speed: 'Высокая скорость: до 50k / день',
            guarantee: 'Авто-рефилл 365 дней',
            minMax: 'Лимиты: 500 — 500 000 шт',
            pricePerUnit: '0.09 ₽ / шт',
          },
        ],
      },
      {
        id: 'tg-views',
        title: 'Просмотры постов',
        services: [
          {
            id: 'tg-v-1',
            title: 'Быстрые просмотры на 1 пост',
            speed: 'Старт 30 секунд',
            guarantee: '100% охват',
            minMax: 'Лимиты: 100 — 1 000 000 шт',
            pricePerUnit: '0.002 ₽ / шт',
            isPopular: true,
          },
          {
            id: 'tg-v-2',
            title: 'Авто-просмотры на будущие посты',
            speed: 'Моментально при публикации',
            guarantee: 'Подписка на 30 дней',
            minMax: 'Лимиты: от 10 постов',
            pricePerUnit: '0.003 ₽ / шт',
          },
        ],
      },
      {
        id: 'tg-stars',
        title: 'Telegram Stars (Звёзды)',
        services: [
          {
            id: 'tg-star-1',
            title: 'Официальные звёзды Stars для ботов и каналов',
            badge: 'Official API',
            speed: 'Мгновенная доставка',
            guarantee: '100% защита от бана',
            minMax: 'Лимиты: 50 — 50 000 Stars',
            pricePerUnit: '1.45 ₽ / шт',
            isPopular: true,
          },
        ],
      },
      {
        id: 'tg-reactions',
        title: 'Реакции (эмодзи)',
        services: [
          {
            id: 'tg-react-1',
            title: 'Позитивные реакции (Огонь, Сердечки, Палец вверх)',
            speed: 'Старт 1-2 мин',
            guarantee: 'Без списаний',
            minMax: 'Лимиты: 50 — 50 000 шт',
            pricePerUnit: '0.02 ₽ / шт',
          },
        ],
      },
      {
        id: 'tg-boosts',
        title: 'Бусты для историй',
        services: [
          {
            id: 'tg-boost-1',
            title: 'Бусты от реальных Level-аккаунтов',
            badge: 'Уровень 1-10',
            speed: 'Плавный старт',
            guarantee: 'Удержание до 30 дней',
            minMax: 'Лимиты: 1 — 100 бустов',
            pricePerUnit: '12.50 ₽ / шт',
          },
        ],
      },
    ],
  },
  {
    id: 'vk',
    name: 'ВКонтакте',
    icon: Share2,
    color: 'from-blue-600 to-indigo-700',
    categories: [
      {
        id: 'vk-followers',
        title: 'Подписчики в группу',
        services: [
          {
            id: 'vk-f-1',
            title: 'Живые участники с аватарками и постами',
            badge: 'Рекомендуем',
            speed: 'Старт 5-15 мин',
            guarantee: 'Гарантия 30 дней',
            minMax: 'Лимиты: 50 — 50 000 шт',
            pricePerUnit: '0.22 ₽ / шт',
            isPopular: true,
          },
        ],
      },
      {
        id: 'vk-likes',
        title: 'Лайки на посты',
        services: [
          {
            id: 'vk-l-1',
            title: 'Быстрые лайки от пользователей РФ',
            speed: 'Мгновенный старт',
            guarantee: 'Без собачек',
            minMax: 'Лимиты: 20 — 20 000 шт',
            pricePerUnit: '0.06 ₽ / шт',
          },
        ],
      },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram*',
    icon: Camera,
    color: 'from-pink-500 via-purple-500 to-amber-500',
    categories: [
      {
        id: 'inst-followers',
        title: 'Подписчики профиля',
        services: [
          {
            id: 'inst-f-1',
            title: 'HQ Подписчики с заполненными профилями',
            badge: 'High Quality',
            speed: 'Старт 5 мин',
            guarantee: 'Гарантия 60 дней',
            minMax: 'Лимиты: 50 — 50 000 шт',
            pricePerUnit: '0.29 ₽ / шт',
            isPopular: true,
          },
        ],
      },
      {
        id: 'inst-reels',
        title: 'Просмотры Reels',
        services: [
          {
            id: 'inst-r-1',
            title: 'Виральные просмотры для попадания в рекомендации',
            speed: 'Скорость до 100k/сутки',
            guarantee: 'Высокое удержание',
            minMax: 'Лимиты: 500 — 1 000 000 шт',
            pricePerUnit: '0.005 ₽ / шт',
          },
        ],
      },
    ],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    icon: PlaySquare,
    color: 'from-red-600 to-rose-700',
    categories: [
      {
        id: 'yt-subs',
        title: 'Подписчики канала',
        services: [
          {
            id: 'yt-s-1',
            title: 'Реальные подписчики с гарантией от списаний',
            badge: 'Безопасно',
            speed: 'Плавный старт (1-6 часов)',
            guarantee: 'Гарантия 90 дней',
            minMax: 'Лимиты: 50 — 20 000 шт',
            pricePerUnit: '0.95 ₽ / шт',
            isPopular: true,
          },
        ],
      },
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    icon: Video,
    color: 'from-teal-400 to-pink-500',
    categories: [
      {
        id: 'tt-views',
        title: 'Просмотры клипов',
        services: [
          {
            id: 'tt-v-1',
            title: 'Мгновенные просмотры для алгоритмов Рекомендаций',
            badge: 'Топ трендов',
            speed: 'Старт 1 мин',
            guarantee: '100% доставка',
            minMax: 'Лимиты: 1 000 — 5 000 000 шт',
            pricePerUnit: '0.003 ₽ / шт',
            isPopular: true,
          },
        ],
      },
    ],
  },
  {
    id: 'twitch',
    name: 'Twitch',
    icon: Radio,
    color: 'from-purple-600 to-indigo-600',
    categories: [
      {
        id: 'twitch-viewers',
        title: 'Зрители на стрим',
        services: [
          {
            id: 'tw-1',
            title: 'Зрители онлайн с удержанием до 3 часов',
            speed: 'Вход за 5-10 минут',
            guarantee: 'Плавный график онлайна',
            minMax: 'Лимиты: 10 — 1 000 зрителей',
            pricePerUnit: '2.50 ₽ / час',
          },
        ],
      },
    ],
  },
];
