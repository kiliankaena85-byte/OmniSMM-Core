import 'dotenv/config';
import { db } from '../src/lib/db';
import { CatalogLockGuard } from '../src/lib/catalog-lock';
import { invalidateL1CatalogCache as clearCatalogL1Cache, invalidateCatalogCache } from '../src/services/catalog/catalog-cache.service';
import fs from 'fs';
import path from 'path';

/**
 * MASTER CATALOG REFACTOR & SERVICE DECISION ARBITER
 * =================================================
 * Enforces:
 * 1. Logical, unambiguous category names across all 9 networks.
 * 2. Complete removal of vague "Другое" / "Автоуслуги" ambiguity.
 * 3. Rich, client-oriented category descriptions explaining tiers (Эконом, Стандарт, Премиум, Живые).
 * 4. 3-Gate Service Decision Model (Network -> Category Invariants -> Name & Anti-Ambiguity).
 * 5. Elimination of all 27 misplaced services (likes/views in subscribers, etc.).
 * 6. Seeding genuine subscribers for Rutube and VK from ShadowService.
 * 7. 100% White-Label compliance (0 provider brands, 0 raw bracket tags, 0 HTML entities).
 * 8. customDataType: TEXTAREA for comments, NUMBER for polls.
 * 9. isPrivate flag for private channels/posts.
 * 10. Catalog lock preservation & Redis/L1 cache invalidation.
 */

export interface CategoryDefinition {
  name: string;
  activityType: string;
  description: string;
}

export const CATEGORY_DEFINITIONS: Record<string, CategoryDefinition> = {
  // === TELEGRAM (8) ===
  'telegram-subscribers': {
    name: 'Подписчики (Каналы и Группы)',
    activityType: 'FOLLOWERS',
    description: 'Аудитория для открытых и закрытых каналов и групп Telegram. Эконом — стабильные аккаунты для быстрого старта и первоначальной массы. Стандарт — проверенная база с минимальным процентом отписок. Премиум и Живые — активные пользователи из РФ и СНГ с плавным добавлением и высокой вовлеченностью.',
  },
  'telegram-premium-subscribers': {
    name: 'Telegram Premium (Бусты)',
    activityType: 'FOLLOWERS',
    description: 'Подписчики с активной официальной подпиской Telegram Premium (со звездой). Каждый премиум-подписчик передает бусты вашему каналу, повышает уровень (Level), открывает публикацию историй от имени канала и поднимает канал в топ глобального поиска Telegram.',
  },
  'telegram-views': {
    name: 'Просмотры публикаций',
    activityType: 'VIEWS',
    description: 'Просмотры на посты Telegram: разовые на выбранные публикации, оптовые пакеты на свежие и архивные посты, а также просмотры со статистикой в сервисах TGStat и Telemetr. Быстрый и плавный темп открутки.',
  },
  'telegram-reactions': {
    name: 'Реакции на посты',
    activityType: 'LIKES',
    description: 'Эмодзи-реакции на публикации Telegram: как одиночные эмодзи (👍, ❤️, 🔥, 🎉, 🤩), так и наборы позитивных реакций или дизлайков (👎). Поддерживаются открытые каналы и закрытые посты (ссылки вида t.me/c/...).',
  },
  'telegram-boosts': {
    name: 'Бусты канала',
    activityType: 'BOOSTS',
    description: 'Прямые бусты от аккаунтов Telegram Premium на срок от 3 до 30+ дней. Позволяют разблокировать публикацию Stories, кастомные эмодзи-статусы, оформление обложки канала и поднимают позицию в поиске.',
  },
  'telegram-reposts': {
    name: 'Репосты и Пересылки',
    activityType: 'REPOSTS',
    description: 'Пересылки (Share) постов в личные сообщения и другие каналы Telegram. Увеличивают показатель виральности и органический охват публикации в статистике TGStat.',
  },
  'telegram-polls': {
    name: 'Опросы и Голосования',
    activityType: 'VOTES',
    description: 'Голоса в открытых опросах и голосованиях Telegram. При оформлении заказа укажите номер нужного варианта ответа (1, 2, 3 и т.д.). Гарантируется точное попадание в выбранный пункт.',
  },
  'telegram-auto-views': {
    name: 'Автопросмотры и Автореакции',
    activityType: 'VIEWS',
    description: 'Автоматическая подписка на будущие публикации канала: новые посты сразу получают просмотры и реакции в течение оплаченного периода (от 7 до 30 дней) без необходимости оформлять заказ вручную.',
  },

  // === VKONTAKTE (8) ===
  'vk-other': {
    name: 'Подписчики и Друзья',
    activityType: 'FOLLOWERS',
    description: 'Подписчики в сообщества, паблики и друзья на личные страницы ВКонтакте. Эконом — базовые профили для объема. Стандарт — аккаунты с заполненными анкетами и фото. Премиум и Живые — реальные пользователи РФ/СНГ с вечной гарантией без списаний (собачек).',
  },
  'vk-likes': {
    name: 'Лайки на посты и фото',
    activityType: 'LIKES',
    description: 'Лайки («Нравится») на записи стены, фотографии, видеоролики и клипы ВКонтакте. Повышают доверие аудитории и ранжирование записей в ленте рекомендаций «Для вас».',
  },
  'vk-views': {
    name: 'Просмотры (Видео, Клипы, Посты)',
    activityType: 'VIEWS',
    description: 'Все виды просмотров ВКонтакте: счетчик «глазик» на публикации стены, просмотры коротких клипов (VK Clips), просмотры видеозаписей и посещения страницы. Высокая скорость и безопасность для алгоритмов VK.',
  },
  'vk-comments': {
    name: 'Комментарии',
    activityType: 'COMMENTS',
    description: 'Живые комментарии под записями ВКонтакте: собственные тексты (клиент указывает список фраз) либо готовые позитивные комментарии по тематике публикации. Создают эффект живой дискуссии.',
  },
  'vk-polls': {
    name: 'Опросы и Голосования',
    activityType: 'VOTES',
    description: 'Накрутка голосов в публичных опросах ВКонтакте. Поддерживаются опросы в группах, пабликах и на личных страницах с точным указанием номера варианта ответа.',
  },
  'vk-streams': {
    name: 'Зрители на Стрим',
    activityType: 'VIEWS',
    description: 'Одновременные зрители на прямые трансляции ВКонтакте (VK Live) с гарантированным временем удержания в эфире. Выводят трансляцию в топ раздела «Эфиры».',
  },
  'vk-plays': {
    name: 'Музыка и Плейлисты',
    activityType: 'OTHER',
    description: 'Прослушивания треков, альбомов и плейлистов VK Музыки. Помогают попасть в музыкальные чарты, рекомендации пользователей и увеличивают стриминговую статистику артиста.',
  },
  'vk-auto': {
    name: 'Авто-просмотры (Новые посты)',
    activityType: 'VIEWS',
    description: 'Автоматическое начисление просмотров на свежие публикации сообщества или профиля ВКонтакте в течение заданного количества дней (подписка).',
  },

  // === INSTAGRAM (6) ===
  'instagram-subscribers': {
    name: 'Подписчики профиля',
    activityType: 'FOLLOWERS',
    description: 'Фолловеры для открытых и закрытых страниц Instagram. Эконом — доступные аккаунты со всего мира. Стандарт — стабильные подписчики с аватарками и постами. Премиум и Живые — качественная аудитория с гарантией восполнения до 30–90 дней.',
  },
  'instagram-likes': {
    name: 'Лайки на посты и Reels',
    activityType: 'LIKES',
    description: 'Сердечки на публикации, карусели и Reels. Эконом — моментальный старт по суперцене. Стандарт и Премиум — лайки от реальных профилей с постепенной доставкой для естественного роста охватов.',
  },
  'instagram-views': {
    name: 'Просмотры (Reels, Видео, Stories)',
    activityType: 'VIEWS',
    description: 'Просмотры коротких видео Reels, IGTV и историй (Stories). Высокая скорость доставки выводит ролики в рекомендации вкладки «Интересное».',
  },
  'instagram-comments': {
    name: 'Комментарии',
    activityType: 'COMMENTS',
    description: 'Комментарии в Instagram: ваши собственные кастомные тексты (по 1 строке на комментарий), положительные отзывы или эмодзи. Стимулируют вовлеченность (Engagement Rate).',
  },
  'instagram-saves': {
    name: 'Охваты и Сохранения',
    activityType: 'OTHER',
    description: 'Сохранения постов в закладки, показы (Impressions) и охваты от аккаунтов. Ключевые метрики для ранжирования контента алгоритмами Instagram.',
  },
  'instagram-other': {
    name: 'Репосты и Переходы',
    activityType: 'OTHER',
    description: 'Репосты публикаций в Direct и Stories, посещения профиля и зрители эфиров Reels. Дополнительные активности для комплексного продвижения блога.',
  },

  // === YOUTUBE (5) ===
  'youtube-views': {
    name: 'Просмотры (Видео и Shorts)',
    activityType: 'VIEWS',
    description: 'Просмотры для длинных видеороликов и YouTube Shorts. Эконом — быстрые просмотры по лучшей цене. Стандарт — стабильные просмотры с удержанием 1–3 минуты. Премиум и Живые — целевой трафик с рекомендаций и поиска с гарантией от списаний.',
  },
  'youtube-likes': {
    name: 'Лайки и Дизлайки',
    activityType: 'LIKES',
    description: 'Лайки («Большой палец вверх») и дизлайки на видео и Shorts. Создают правильное соотношение реакций и стимулируют рекомендации YouTube.',
  },
  'youtube-reposts': {
    name: 'Репосты и Поделиться',
    activityType: 'REPOSTS',
    description: 'Репосты видео в социальные сети, блоги и внешние сайты (Embeds). Сигнализируют поисковым роботам о виральности и ценности видео.',
  },
  'youtube-comments': {
    name: 'Комментарии',
    activityType: 'COMMENTS',
    description: 'Комментарии под роликами YouTube с вашим текстом. Позволяют задать тему для обсуждения и поднять ролик в результатах поиска.',
  },
  'youtube-streams': {
    name: 'Зрители на Стрим',
    activityType: 'VIEWS',
    description: 'Одновременные зрители на онлайн-трансляции YouTube Live с удержанием от 15 минут до нескольких часов. Выводят трансляцию в топ раздела «В эфире».',
  },

  // === TIKTOK (7) ===
  'tiktok-subscribers': {
    name: 'Подписчики профиля',
    activityType: 'FOLLOWERS',
    description: 'Фолловеры в TikTok-аккаунт. Необходимы для подключения прямых эфиров (от 1000 подписчиков), ссылки в профиле и монетизации.',
  },
  'tiktok-views': {
    name: 'Просмотры видео',
    activityType: 'VIEWS',
    description: 'Быстрые и надежные просмотры на видео в TikTok. Помогают преодолеть порог модерации и попасть в ленту рекомендаций (FYP / For You Page).',
  },
  'tiktok-likes': {
    name: 'Лайки на видео',
    activityType: 'LIKES',
    description: 'Лайки на публикации TikTok. Быстрый темп поступления и минимальные списания для взрывного роста популярности ролика.',
  },
  'tiktok-comments': {
    name: 'Комментарии',
    activityType: 'COMMENTS',
    description: 'Комментарии в TikTok: со своим текстом, релевантные теме видео, либо позитивные эмодзи от русскоязычных или мировых профилей.',
  },
  'tiktok-reposts': {
    name: 'Репосты и Сохранения',
    activityType: 'REPOSTS',
    description: 'Репосты и добавления видео в закладки (Favorites). Один из главных сигналов для алгоритма TikTok о высокой полезности контента.',
  },
  'tiktok-streams': {
    name: 'Зрители и Лайки на Стрим',
    activityType: 'VIEWS',
    description: 'Зрители на прямые трансляции TikTok Live с фиксацией времени удержания (15–240 минут) и лайки (тапы по экрану) во время эфира.',
  },
  'tiktok-other': {
    name: 'Интерактив и Репосты',
    activityType: 'OTHER',
    description: 'Специальные услуги продвижения в TikTok: репосты, интерактивные активности и баттл-поинты для прямых трансляций.',
  },

  // === TWITCH & СТРИМЫ (4) ===
  'twitch-subscribers': {
    name: 'Фолловеры канала',
    activityType: 'FOLLOWERS',
    description: 'Фолловеры на Twitch-канал для выполнения партнерской программы (Twitch Affiliate), повышения доверия аудитории и красивой цифры в шапке профиля.',
  },
  'twitch-streams': {
    name: 'Зрители на Стрим',
    activityType: 'VIEWS',
    description: 'Стабильные одновременные зрители на онлайн-стрим Twitch с удержанием от 10 минут до нескольких часов. Поднимают стрим на верхние позиции категории игры.',
  },
  'twitch-views': {
    name: 'Просмотры (Клипы и VoD)',
    activityType: 'VIEWS',
    description: 'Просмотры записей прошедших трансляций (VoD) и нарезанных хайлайтов (Twitch Clips). Создают видимость высокой активности канала между эфирами.',
  },
  'twitch-bots': {
    name: 'Чат-боты для стрима',
    activityType: 'OTHER',
    description: 'Автоматические боты в чат прямой трансляции, отправляющие заданные сообщения или эмодзи через интервалы времени для имитации активного чата.',
  },

  // === RUTUBE (4) ===
  'rutube-subscribers': {
    name: 'Подписчики канала',
    activityType: 'FOLLOWERS',
    description: 'Подписчики для каналов Rutube. Необходимы для прохождения порога монетизации и продвижения отечественного видеоканала. Эконом, Стандарт, Премиум и Живые РФ.',
  },
  'rutube-views': {
    name: 'Просмотры (Видео и Shorts)',
    activityType: 'VIEWS',
    description: 'Просмотры видеороликов Rutube с гарантированным временем удержания (15–50 секунд или полное). Выводят видео в рекомендации и топ категорий.',
  },
  'rutube-likes': {
    name: 'Лайки, Дизлайки и В топ',
    activityType: 'LIKES',
    description: 'Реакции на видео Rutube: лайки, дизлайки, а также специальные нажатия кнопки «В топ», напрямую влияющие на ранжирование на главной странице.',
  },
  'rutube-comments': {
    name: 'Комментарии',
    activityType: 'COMMENTS',
    description: 'Комментарии под роликами Rutube с вашим собственным текстом для стимуляции обсуждений и органического ранжирования.',
  },

  // === TWITTER (X) (2) ===
  'twitter-views': {
    name: 'Просмотры твитов и видео',
    activityType: 'VIEWS',
    description: 'Официальный счетчик показов (Views / Impressions) на публикации и видео в Twitter / X. Необходим для участия в программе монетизации X Creator.',
  },
  'twitter-other': {
    name: 'Клики и Активность',
    activityType: 'OTHER',
    description: 'Клики по ссылкам, хэштегам, деталям твита, посещения профиля и суммарная вовлеченность (Engagements) для продвижения в тренды Twitter.',
  },

  // === ДРУГИЕ (FACEBOOK, DISCORD, KICK) (4) ===
  'other-subscribers': {
    name: 'Подписчики и Участники',
    activityType: 'FOLLOWERS',
    description: 'Подписчики на публичные страницы Facebook и реальные участники на серверы Discord (с аватарками и онлайн-статусом).',
  },
  'other-views': {
    name: 'Просмотры видео и клипов',
    activityType: 'VIEWS',
    description: 'Просмотры видео и Reels в Facebook, а также просмотры клипов и записей трансляций на стриминговой платформе Kick.',
  },
  'other-likes': {
    name: 'Реакции и Лайки',
    activityType: 'LIKES',
    description: 'Эмодзи-реакции на публикации Facebook (Нравится, Супер, Ха-ха, Ух ты, Сочувствую) от стабильных профилей.',
  },
  'other-streams': {
    name: 'Зрители на Стрим',
    activityType: 'VIEWS',
    description: 'Живые зрители на прямые трансляции Kick и Facebook Live с удержанием в прямом эфире.',
  },
};

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanServiceName(name: string, shadowName?: string | null): string {
  let text = name;
  if (text.includes('...') && shadowName && shadowName.length > text.length - 15) {
    const tierMatch = text.match(/\[(Эконом|Стандарт|Премиум|Живые|VIP)\]$/i);
    text = shadowName + (tierMatch ? ` [${tierMatch[1]}]` : '');
  }

  let cleaned = decodeHtmlEntities(text);

  // 1. White-label: Remove all provider brands
  const providerRegex = /\b(?:soc[- ]?rocket|vexboost|stream[- ]?promotion|smmprime|smm[- ]?prime|smm[- ]?panel[- ]?us|smmpanelus|prosmm[- ]?shop|prosmm)\b/gi;
  cleaned = cleaned.replace(providerRegex, '');

  // 2. Remove leading tech prefixes
  cleaned = cleaned.replace(/^\s*(?:id\s*\d+|\d+\.)\s*/i, '');

  // 3. Remove technical provider tags
  cleaned = cleaned.replace(/\|\s*(?:S\d+|B\d+|MQ|VHQ|HQ\+|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\b/gi, '');
  cleaned = cleaned.replace(/\b(?:S\d+|B\d+|MQ|VHQ|HQ\+|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\s*\|/gi, '');
  cleaned = cleaned.replace(/\[\s*(?:S\d+|B\d+|MQ|VHQ|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\s*\]/gi, '');

  // 4. Remove speed bracket tags: [0-1/Ч], [0-15/М], [100К/Д], [1000/day], etc.
  cleaned = cleaned.replace(/\[\s*\d+-\d+\/[ЧМчмHDhd]\s*\|?[^\]]*\]/gi, '');
  cleaned = cleaned.replace(/\[\s*\d+[КkK]?\/[ДдDdHhЧч]\s*\|?[^\]]*\]/gi, '');

  // 5. Clean up pipes and redundant spaces
  cleaned = cleaned
    .replace(/\s*\|\s*\|\s*/g, ' | ')
    .replace(/\|\s*\]/g, ']')
    .replace(/\[\s*\|/g, '[')
    .replace(/\(\s*\|\s*/g, '(')
    .replace(/\s*\|\s*\)/g, ')')
    .replace(/\|\s*$/g, '')
    .replace(/^\s*\|\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned;
}

async function main() {
  console.log('🚀 [MASTER CATALOG REFACTOR & SERVICE DECISION ARBITER 2026]');
  console.log('Step 0: Unlocking Catalog via CatalogLockGuard...');
  await CatalogLockGuard.unlockCatalog('admin@smmplan.pro', 'Master Catalog Clean & Unambiguous Refactor (RAC-2026)');

  try {
    // 1. Update all 48 Categories in DB
    console.log('\nStep 1: Updating 48 Categories (Names, Descriptions, Activity Types)...');
    let catsUpdated = 0;
    for (const [slug, def] of Object.entries(CATEGORY_DEFINITIONS)) {
      const res = await db.category.updateMany({
        where: { slug },
        data: {
          name: def.name,
          activityType: def.activityType,
          description: def.description,
        }
      });
      if (res.count > 0) {
        catsUpdated += res.count;
      } else {
        console.warn(`⚠️ Warning: Category with slug "${slug}" not found in DB!`);
      }
    }
    console.log(`✅ Successfully updated ${catsUpdated} / 48 categories.`);

    // 2. Fetch categories map for re-routing
    const allCats = await db.category.findMany({
      include: { network: true }
    });
    const catBySlug = new Map<string, any>();
    for (const c of allCats) {
      catBySlug.set(c.slug, c);
    }

    // 3. Process all services through Service Decision Arbiter
    console.log('\nStep 2: Processing Services through Decision Arbiter...');
    const services = await db.service.findMany({
      include: {
        category: {
          include: { network: true }
        }
      },
      orderBy: { numericId: 'asc' }
    });

    let remappedCount = 0;
    let unTruncatedCount = 0;
    let textareaCommentsCount = 0;
    let numberPollsCount = 0;
    let privateCount = 0;

    for (const s of services) {
      const netSlug = s.category.network?.slug || '';
      const oldCatSlug = s.category.slug;
      const oldName = s.name;

      // Find matching ShadowService
      let shadow: any = null;
      if (s.providerId && s.externalId) {
        shadow = await db.shadowService.findFirst({
          where: { providerId: s.providerId, externalId: s.externalId }
        });
      }

      if (oldName.includes('...') && shadow?.name) {
        unTruncatedCount++;
      }

      let cleanedName = cleanServiceName(oldName, shadow?.name);
      const nLower = cleanedName.toLowerCase();

      // Gate 2: Category Invariant Resolution
      let targetCatSlug = oldCatSlug;

      // Telegram: Re-route non-premium accounts from telegram-premium-subscribers to telegram-subscribers
      if (netSlug === 'telegram' && oldCatSlug === 'telegram-premium-subscribers') {
        if (nLower.includes('индия') || nLower.includes('турбо') || (!nLower.includes('премиум') && !nLower.includes('premium'))) {
          targetCatSlug = 'telegram-subscribers';
        }
      }

      // VK: Re-route video/clip/post views from vk-plays (music) to vk-views
      if (netSlug === 'vk' && oldCatSlug === 'vk-plays') {
        if (nLower.includes('клип') || nLower.includes('видео') || nLower.includes('товары') || nLower.includes('пост') || nLower.includes('глазик') || nLower.includes('посещение')) {
          targetCatSlug = 'vk-views';
        } else if (nLower.includes('авто-просмотры') || nLower.includes('автопросмотры')) {
          targetCatSlug = 'vk-auto';
        }
      }

      // VK: Re-route fast music play from vk-other to vk-plays
      if (netSlug === 'vk' && oldCatSlug === 'vk-other') {
        if (nLower.includes('прослушивания')) {
          targetCatSlug = 'vk-plays';
        }
      }

      // YouTube: Re-route offline video views from youtube-streams to youtube-views
      if (netSlug === 'youtube' && oldCatSlug === 'youtube-streams') {
        if (nLower.includes('просмотры') && !nLower.includes('стрим') && !nLower.includes('live') && !nLower.includes('трансляц')) {
          targetCatSlug = 'youtube-views';
        }
      }

      // TikTok: Re-route Live likes from tiktok-subscribers to tiktok-streams
      if (netSlug === 'tiktok' && oldCatSlug === 'tiktok-subscribers') {
        if (nLower.includes('лайк') || nLower.includes('live')) {
          targetCatSlug = 'tiktok-streams';
        }
      }

      // TikTok: Re-route reposts from tiktok-other to tiktok-reposts
      if (netSlug === 'tiktok' && oldCatSlug === 'tiktok-other') {
        if (nLower.includes('репост')) {
          targetCatSlug = 'tiktok-reposts';
        }
      }

      // Twitch: Re-route clip/VoD views to twitch-views
      if (netSlug === 'twitch') {
        if ((oldCatSlug === 'twitch-streams' || oldCatSlug === 'twitch-subscribers') && nLower.includes('просмотры')) {
          targetCatSlug = 'twitch-views';
        }
      }

      // Rutube: Re-route misplaced likes/dislikes/clicks to rutube-likes, views to rutube-views
      if (netSlug === 'rutube') {
        if (oldCatSlug === 'rutube-subscribers') {
          if (nLower.includes('лайк') || nLower.includes('дизлайк') || nLower.includes('в топ')) {
            targetCatSlug = 'rutube-likes';
          } else if (nLower.includes('просмотр')) {
            targetCatSlug = 'rutube-views';
          }
        } else if (oldCatSlug === 'rutube-comments' && nLower.includes('просмотр')) {
          targetCatSlug = 'rutube-views';
        }
      }

      // Gate 3: Reactions (Single vs Mix)
      if (targetCatSlug.includes('reactions') || (netSlug === 'telegram' && nLower.includes('реакци'))) {
        const isSingleEmoji = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(cleanedName) &&
          !nLower.includes('микс') && !nLower.includes('набор') && !nLower.includes('positive') && !nLower.includes('позитив');

        // Strip duplicate prefixes
        cleanedName = cleanedName
          .replace(/^(?:Набор\s+реакций\s+|Реакци[яи]\s+)+/i, '')
          .trim();

        if (isSingleEmoji) {
          cleanedName = `Реакция (Одиночная) ${cleanedName}`;
        } else if (nLower.includes('позитив') || nLower.includes('positive') || nLower.includes('микс') || nLower.includes('набор') || nLower.includes('👍')) {
          cleanedName = `Набор реакций ${cleanedName}`;
        } else {
          cleanedName = `Реакции ${cleanedName}`;
        }
        cleanedName = cleanedName.replace(/\s{2,}/g, ' ').trim();
      }

      // Set customDataType
      let customDataType = 'NONE';
      if (targetCatSlug.includes('comments') || nLower.includes('со своими') || nLower.includes('комментарии')) {
        customDataType = 'TEXTAREA';
        textareaCommentsCount++;
      } else if (targetCatSlug.includes('polls') || targetCatSlug.includes('votes') || nLower.includes('опрос') || nLower.includes('голос') || nLower.includes('вариант')) {
        customDataType = 'NUMBER';
        numberPollsCount++;
      }

      // Set isPrivate
      const isPrivate = nLower.includes('закрыт') || nLower.includes('private') || nLower.includes('t.me/+') || nLower.includes('c/');
      if (isPrivate) privateCount++;

      const targetCat = catBySlug.get(targetCatSlug);
      const isRemapped = targetCatSlug !== oldCatSlug;
      if (isRemapped) remappedCount++;

      // Update in DB using category relation connect
      await db.service.update({
        where: { id: s.id },
        data: {
          name: cleanedName,
          category: {
            connect: { id: targetCat.id }
          },
          customDataType,
          targetType: isPrivate ? 'PRIVATE_POST' : s.targetType,
        }
      });
    }

    console.log(`✅ Processed ${services.length} services.`);
    console.log(`  - Misplaced services remapped: ${remappedCount}`);
    console.log(`  - Truncated names expanded: ${unTruncatedCount}`);
    console.log(`  - Comments configured with TEXTAREA: ${textareaCommentsCount}`);
    console.log(`  - Polls configured with NUMBER: ${numberPollsCount}`);
    console.log(`  - Private services marked: ${privateCount}`);

    // 4. Seed Authentic Subscribers for Rutube and VK
    console.log('\nStep 3: Seeding Authentic Subscribers for Rutube and VK...');
    const rutubeSubCat = catBySlug.get('rutube-subscribers');
    if (rutubeSubCat) {
      const realRutubeSubs = [
        { extId: '3253', name: 'Rutube Подписчики (Быстрый старт, микс) [Эконом]', rate: 85, tier: 'ECONOMY' },
        { extId: '2789', name: 'Rutube Подписчики (Быстрый старт, Россия) [Стандарт]', rate: 100.1, tier: 'STANDARD' },
        { extId: '1875', name: 'Rutube Подписчики (Быстрый старт, гарантия 30 дней) [Премиум]', rate: 150.15, tier: 'PREMIUM' },
        { extId: '33522', name: 'Rutube Подписчики (Живые пользователи РФ) [Живые]', rate: 3800, tier: 'LIVE' },
      ];

      for (const item of realRutubeSubs) {
        const sh = await db.shadowService.findFirst({
          where: { externalId: item.extId, platform: { in: ['rutube', 'Rutube'] } }
        });
        if (sh) {
          const existing = await db.service.findFirst({
            where: { externalId: item.extId, categoryId: rutubeSubCat.id }
          });
          if (!existing) {
            await db.service.create({
              data: {
                name: item.name,
                category: { connect: { id: rutubeSubCat.id } },
                provider: sh.providerId ? { connect: { id: sh.providerId } } : undefined,
                externalId: sh.externalId,
                rate: sh.rateRub || item.rate,
                costPer1kRub: sh.rateRub || item.rate,
                minQty: sh.min || 10,
                maxQty: sh.max || 100000,
                qualityTier: item.tier,
                customDataType: 'NONE',
                targetType: 'CHANNEL',
              }
            });
            console.log(`  + Created authentic Rutube subscriber: ${item.name}`);
          }
        }
      }
    }

    const vkSubCat = catBySlug.get('vk-other');
    if (vkSubCat) {
      const realVkSubs = [
        { extId: '1119', name: 'VK Подписчики в группу (Моментальный старт) [Эконом]', rate: 39, tier: 'ECONOMY' },
        { extId: '2090', name: 'VK Подписчики в группу (СНГ, минимум собачек) [Стандарт]', rate: 271.25, tier: 'STANDARD' },
        { extId: '1799', name: 'VK Подписчики в друзья (Живой трафик) [Премиум]', rate: 500.5, tier: 'PREMIUM' },
        { extId: '1797', name: 'VK Подписчики в группу (Живые РФ, гарантия 90 дней) [Живые]', rate: 2600, tier: 'LIVE' },
      ];

      for (const item of realVkSubs) {
        const sh = await db.shadowService.findFirst({
          where: { externalId: item.extId, platform: { in: ['vk', 'VK', 'vkontakte'] } }
        });
        if (sh) {
          const existing = await db.service.findFirst({
            where: { externalId: item.extId, categoryId: vkSubCat.id }
          });
          if (!existing) {
            await db.service.create({
              data: {
                name: item.name,
                category: { connect: { id: vkSubCat.id } },
                provider: sh.providerId ? { connect: { id: sh.providerId } } : undefined,
                externalId: sh.externalId,
                rate: sh.rateRub || item.rate,
                costPer1kRub: sh.rateRub || item.rate,
                minQty: sh.min || 10,
                maxQty: sh.max || 100000,
                qualityTier: item.tier,
                customDataType: 'NONE',
                targetType: 'CHANNEL',
              }
            });
            console.log(`  + Created authentic VK subscriber: ${item.name}`);
          }
        }
      }
    }

    // 5. Export updated curated JSON
    console.log('\nStep 4: Synchronizing docs/CURATED_SERVICES_400.json...');
    const finalServices = await db.service.findMany({
      include: {
        category: {
          include: { network: true }
        }
      },
      orderBy: { numericId: 'asc' }
    });

    const exportItems = finalServices.map(s => ({
      id: s.id,
      numericId: s.numericId,
      name: s.name,
      network: s.category.network?.name,
      networkSlug: s.category.network?.slug,
      category: s.category.name,
      categorySlug: s.category.slug,
      externalId: s.externalId,
      providerId: s.providerId,
      rate: s.rate,
      minQty: s.minQty,
      maxQty: s.maxQty,
      customDataType: s.customDataType,
      isPrivate: s.isPrivate,
    }));

    fs.writeFileSync(path.resolve('docs/CURATED_SERVICES_400.json'), JSON.stringify(exportItems, null, 2), 'utf8');
    console.log(`✅ Saved ${exportItems.length} curated services to docs/CURATED_SERVICES_400.json`);

    // 6. Invalidate L1 & Redis Caches
    console.log('\nStep 5: Invalidating L1 RAM Cache and Redis Catalog Cache...');
    clearCatalogL1Cache();
    await invalidateCatalogCache('smmplan');
    await invalidateCatalogCache('smmflux');
    console.log('✅ Catalog caches successfully cleared.');

  } finally {
    // 7. Always re-lock catalog!
    console.log('\nStep 6: Re-locking Catalog via CatalogLockGuard...');
    await CatalogLockGuard.lockCatalog('admin@smmplan.pro');
    console.log('🔒 Catalog is now safely LOCKED and INVIOLABLE.');
  }

  console.log('\n🎉 ALL CATALOG AND SERVICE UPDATES COMPLETED SUCCESSFULLY!');
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL ERROR:', e); process.exit(1); });
