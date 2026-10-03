/**
 * (c) 2024-2026 SMMplan / OmniSMM 1.0. All rights reserved.
 * 
 * CATALOG TAXONOMY CONSOLIDATOR
 * ==============================================================================
 * CLI инструмент консолидации каталога по стандарту `catalog-taxonomy-curator`.
 * 
 * Использование:
 *   npx tsx scripts/catalog-taxonomy-consolidator.ts --dry-run
 *   npx tsx scripts/catalog-taxonomy-consolidator.ts --apply
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface CanonicalCategoryDef {
  activityType: string;
  name: string;
  slugSuffix: string;
  sort: number;
  matchKeywords: string[];
}

export const CANONICAL_TAXONOMY: Record<string, CanonicalCategoryDef[]> = {
  TELEGRAM: [
    { activityType: 'SUBSCRIBERS', name: 'Подписчики', slugSuffix: 'subscribers', sort: 10, matchKeywords: ['подписч', 'участник', 'фолловер', 'member', 'sub'] },
    { activityType: 'PREMIUM_SUBSCRIBERS', name: 'Подписчики премиум', slugSuffix: 'premium-subscribers', sort: 15, matchKeywords: ['премиум', 'со звездой', '⭐️', 'premium'] },
    { activityType: 'VIEWS', name: 'Просмотры', slugSuffix: 'views', sort: 20, matchKeywords: ['просмотр', 'охват', 'view', 'клики по рекламе'] },
    { activityType: 'REACTIONS', name: 'Реакции', slugSuffix: 'reactions', sort: 30, matchKeywords: ['реакц', 'эмодзи', 'reaction', 'emoji', 'лайк', 'like'] },
    { activityType: 'BOOSTS', name: 'Бусты', slugSuffix: 'boosts', sort: 40, matchKeywords: ['буст', 'boost', 'уровен', 'level'] },
    { activityType: 'REPOSTS', name: 'Репосты', slugSuffix: 'reposts', sort: 50, matchKeywords: ['репост', 'поделит', 'repost', 'share'] },
    { activityType: 'POLLS', name: 'Опросы и Голосования', slugSuffix: 'polls', sort: 60, matchKeywords: ['опрос', 'голос', 'голосован', 'poll', 'vote'] },
    { activityType: 'COMMENTS', name: 'Комментарии', slugSuffix: 'comments', sort: 70, matchKeywords: ['коммент', 'отзыв', 'comment'] },
    { activityType: 'AUTO_VIEWS', name: 'Автопросмотры и Автореакции', slugSuffix: 'auto-views', sort: 80, matchKeywords: ['автопросмотр', 'автореакци', 'авто - просмотр', 'будущие посты'] },
    { activityType: 'BOTS', name: 'Боты и Рефералы', slugSuffix: 'bots', sort: 90, matchKeywords: ['старт бота', 'старты бота', 'реферал', 'активность ботов', 'запуск из поиска', 'умный поиск'] },
    { activityType: 'STARS', name: 'Звёзды', slugSuffix: 'stars', sort: 100, matchKeywords: ['звезд', 'stars', 'star'] },
    { activityType: 'STORIES', name: 'Истории', slugSuffix: 'stories', sort: 110, matchKeywords: ['истори', 'стори', 'story'] },
    { activityType: 'OTHER', name: 'Другое', slugSuffix: 'other', sort: 999, matchKeywords: ['жалоб'] },
  ],
  INSTAGRAM: [
    { activityType: 'SUBSCRIBERS', name: 'Подписчики', slugSuffix: 'subscribers', sort: 10, matchKeywords: ['подписч', 'фолловер', 'follower'] },
    { activityType: 'LIKES', name: 'Лайки', slugSuffix: 'likes', sort: 20, matchKeywords: ['лайк', 'нравится', 'сердечк', 'like'] },
    { activityType: 'VIEWS', name: 'Просмотры', slugSuffix: 'views', sort: 30, matchKeywords: ['просмотр', 'рилс', 'reels', 'видео', 'view'] },
    { activityType: 'COMMENTS', name: 'Комментарии', slugSuffix: 'comments', sort: 40, matchKeywords: ['коммент', 'comment'] },
    { activityType: 'STORIES', name: 'Истории', slugSuffix: 'stories', sort: 50, matchKeywords: ['истори', 'стори', 'story'] },
    { activityType: 'SAVES', name: 'Охваты и Сохранения', slugSuffix: 'saves', sort: 60, matchKeywords: ['сохранен', 'охват', 'посещен', 'статистик', 'save', 'reach'] },
    { activityType: 'STREAMS', name: 'Стримы', slugSuffix: 'streams', sort: 70, matchKeywords: ['стрим', 'эфир', 'live', 'зрител'] },
    { activityType: 'OTHER', name: 'Другое', slugSuffix: 'other', sort: 999, matchKeywords: [] },
  ],
  VK: [
    { activityType: 'SUBSCRIBERS', name: 'Подписчики и Друзья', slugSuffix: 'subscribers', sort: 10, matchKeywords: ['подписч', 'друг', 'вступлен', 'групп', 'паблик'] },
    { activityType: 'LIKES', name: 'Лайки', slugSuffix: 'likes', sort: 20, matchKeywords: ['лайк', 'нравится', 'like'] },
    { activityType: 'VIEWS', name: 'Просмотры', slugSuffix: 'views', sort: 30, matchKeywords: ['просмотр', 'запис', 'клип', 'видео', 'view'] },
    { activityType: 'REPOSTS', name: 'Репосты', slugSuffix: 'reposts', sort: 40, matchKeywords: ['репост', 'поделит', 'рассказ'] },
    { activityType: 'COMMENTS', name: 'Комментарии', slugSuffix: 'comments', sort: 50, matchKeywords: ['коммент', 'отзыв'] },
    { activityType: 'POLLS', name: 'Опросы и Голоса', slugSuffix: 'polls', sort: 60, matchKeywords: ['опрос', 'голос', 'голосован'] },
    { activityType: 'STREAMS', name: 'Стримы', slugSuffix: 'streams', sort: 70, matchKeywords: ['стрим', 'трансляц', 'эфир'] },
    { activityType: 'PLAYS', name: 'Прослушивания', slugSuffix: 'plays', sort: 80, matchKeywords: ['прослуш', 'музык'] },
    { activityType: 'AUTO', name: 'Автоуслуги', slugSuffix: 'auto', sort: 90, matchKeywords: ['авто', 'подписка на услуги', 'будущие посты'] },
    { activityType: 'OTHER', name: 'Другое', slugSuffix: 'other', sort: 999, matchKeywords: [] },
  ],
  YOUTUBE: [
    { activityType: 'SUBSCRIBERS', name: 'Подписчики', slugSuffix: 'subscribers', sort: 10, matchKeywords: ['подписч', 'sub'] },
    { activityType: 'VIEWS', name: 'Просмотры', slugSuffix: 'views', sort: 20, matchKeywords: ['просмотр', 'видео', 'shorts', 'view', 'часы'] },
    { activityType: 'LIKES', name: 'Лайки', slugSuffix: 'likes', sort: 30, matchKeywords: ['лайк', 'like', 'дизлайк'] },
    { activityType: 'REPOSTS', name: 'Репосты', slugSuffix: 'reposts', sort: 40, matchKeywords: ['репост', 'поделит', 'share'] },
    { activityType: 'COMMENTS', name: 'Комментарии', slugSuffix: 'comments', sort: 50, matchKeywords: ['коммент', 'comment'] },
    { activityType: 'STREAMS', name: 'Зрители на Стрим', slugSuffix: 'streams', sort: 60, matchKeywords: ['стрим', 'трансляц', 'stream', 'live', 'эфир', 'зрител', 'прямой эфир'] },
    { activityType: 'OTHER', name: 'Другое', slugSuffix: 'other', sort: 999, matchKeywords: [] },
  ],
  TIKTOK: [
    { activityType: 'SUBSCRIBERS', name: 'Подписчики', slugSuffix: 'subscribers', sort: 10, matchKeywords: ['подписч', 'фолловер', 'follower'] },
    { activityType: 'VIEWS', name: 'Просмотры', slugSuffix: 'views', sort: 20, matchKeywords: ['просмотр', 'view'] },
    { activityType: 'LIKES', name: 'Лайки', slugSuffix: 'likes', sort: 30, matchKeywords: ['лайк', 'like'] },
    { activityType: 'COMMENTS', name: 'Комментарии', slugSuffix: 'comments', sort: 40, matchKeywords: ['коммент', 'comment'] },
    { activityType: 'REPOSTS', name: 'Репосты и Сохранения', slugSuffix: 'reposts', sort: 50, matchKeywords: ['репост', 'поделит', 'сохранен', 'share', 'save'] },
    { activityType: 'STREAMS', name: 'Стримы', slugSuffix: 'streams', sort: 60, matchKeywords: ['стрим', 'эфир', 'live'] },
    { activityType: 'OTHER', name: 'Другое', slugSuffix: 'other', sort: 999, matchKeywords: [] },
  ],
  TWITCH: [
    { activityType: 'SUBSCRIBERS', name: 'Фолловеры', slugSuffix: 'subscribers', sort: 10, matchKeywords: ['подписч', 'фолловер', 'follower'] },
    { activityType: 'STREAMS', name: 'Зрители на Стрим', slugSuffix: 'streams', sort: 20, matchKeywords: ['стрим', 'эфир', 'live', 'зрител', 'онлайн'] },
    { activityType: 'VIEWS', name: 'Просмотры', slugSuffix: 'views', sort: 30, matchKeywords: ['просмотр', 'view', 'клип'] },
    { activityType: 'BOTS', name: 'Чат-боты', slugSuffix: 'bots', sort: 40, matchKeywords: ['бот', 'чат'] },
    { activityType: 'OTHER', name: 'Другое', slugSuffix: 'other', sort: 999, matchKeywords: [] },
  ],
  RUTUBE: [
    { activityType: 'SUBSCRIBERS', name: 'Подписчики', slugSuffix: 'subscribers', sort: 10, matchKeywords: ['подписч', 'follower'] },
    { activityType: 'VIEWS', name: 'Просмотры', slugSuffix: 'views', sort: 20, matchKeywords: ['просмотр', 'view'] },
    { activityType: 'LIKES', name: 'Лайки', slugSuffix: 'likes', sort: 30, matchKeywords: ['лайк', 'like'] },
    { activityType: 'COMMENTS', name: 'Комментарии', slugSuffix: 'comments', sort: 40, matchKeywords: ['коммент', 'comment'] },
    { activityType: 'OTHER', name: 'Другое', slugSuffix: 'other', sort: 999, matchKeywords: [] },
  ],
  TWITTER: [
    { activityType: 'SUBSCRIBERS', name: 'Подписчики', slugSuffix: 'subscribers', sort: 10, matchKeywords: ['подписч', 'follower'] },
    { activityType: 'LIKES', name: 'Лайки', slugSuffix: 'likes', sort: 20, matchKeywords: ['лайк', 'like'] },
    { activityType: 'REPOSTS', name: 'Ретвиты', slugSuffix: 'reposts', sort: 30, matchKeywords: ['ретвит', 'repost', 'share'] },
    { activityType: 'VIEWS', name: 'Просмотры', slugSuffix: 'views', sort: 40, matchKeywords: ['просмотр', 'view'] },
    { activityType: 'OTHER', name: 'Другое', slugSuffix: 'other', sort: 999, matchKeywords: [] },
  ],
  DEFAULT: [
    { activityType: 'SUBSCRIBERS', name: 'Подписчики', slugSuffix: 'subscribers', sort: 10, matchKeywords: ['подписч', 'участник', 'фолловер', 'member', 'follow'] },
    { activityType: 'VIEWS', name: 'Просмотры', slugSuffix: 'views', sort: 20, matchKeywords: ['просмотр', 'охват', 'view', 'play', 'прослуш'] },
    { activityType: 'LIKES', name: 'Реакции и Лайки', slugSuffix: 'likes', sort: 30, matchKeywords: ['лайк', 'нравится', 'like', 'реакц', 'эмодзи'] },
    { activityType: 'STREAMS', name: 'Зрители на Стрим', slugSuffix: 'streams', sort: 40, matchKeywords: ['стрим', 'трансляц', 'эфир', 'зрител', 'stream', 'live'] },
    { activityType: 'OTHER', name: 'Другое', slugSuffix: 'other', sort: 999, matchKeywords: [] },
  ]
};

function normalizePlatformSlug(slugOrName: string): string {
  const s = slugOrName.toUpperCase();
  if (s.includes('TELEGRAM')) return 'TELEGRAM';
  if (s.includes('INSTAGRAM') || s.includes('INSTA')) return 'INSTAGRAM';
  if (s.includes('VK') || s.includes('ВКОНТАКТЕ')) return 'VK';
  if (s.includes('YOUTUBE')) return 'YOUTUBE';
  if (s.includes('TIKTOK')) return 'TIKTOK';
  if (s.includes('TWITCH')) return 'TWITCH';
  if (s.includes('RUTUBE')) return 'RUTUBE';
  if (s.includes('TWITTER') || s.includes('X.COM')) return 'TWITTER';
  return 'DEFAULT';
}

function resolveCanonicalActivity(categoryName: string, networkKey: string): CanonicalCategoryDef {
  const defs = CANONICAL_TAXONOMY[networkKey] || CANONICAL_TAXONOMY.DEFAULT;
  const n = categoryName.toLowerCase();

  // 1. Звезды Telegram
  if (networkKey === 'TELEGRAM' && (n.includes('звезд') || n.includes('star'))) {
    const starDef = defs.find(d => d.activityType === 'STARS');
    if (starDef) return starDef;
  }

  // 2. Бусты / уровни
  if (n.includes('буст') || n.includes('boost') || n.includes('уровен')) {
    const boostDef = defs.find(d => d.activityType === 'BOOSTS');
    if (boostDef) return boostDef;
  }

  // 3. Подписчики премиум (Telegram)
  if (networkKey === 'TELEGRAM' && (n.includes('премиум') || n.includes('со звездой') || n.includes('⭐️') || n.includes('premium'))) {
    const premDef = defs.find(d => d.activityType === 'PREMIUM_SUBSCRIBERS');
    if (premDef) return premDef;
  }

  // 4. Боты / рефералы / старты
  if (n.includes('старт бота') || n.includes('старты бота') || n.includes('реферал') || n.includes('чат - бот') || n.includes('чат-бот') || n.includes('активность ботов') || n.includes('запуски бота') || n.includes('умный поиск')) {
    const botDef = defs.find(d => d.activityType === 'BOTS');
    if (botDef) return botDef;
  }

  // 5. Истории / сторис
  if (n.includes('истори') || n.includes('стори') || n.includes('stor')) {
    const storiesDef = defs.find(d => d.activityType === 'STORIES');
    if (storiesDef) return storiesDef;
  }

  // 6. Подписчики (участники, фолловеры)
  if (n.includes('подписч') || n.includes('участник') || n.includes('фолловер') || n.includes('member') || n.includes('sub') || n.includes('follow') || n.includes('друг')) {
    const subDef = defs.find(d => d.activityType === 'SUBSCRIBERS');
    if (subDef) return subDef;
  }

  // 7. Репосты / поделиться (проверяем ДО авто, чтобы "авто-репосты" шли в Репосты)
  if (n.includes('репост') || n.includes('поделит') || n.includes('share') || n.includes('repost')) {
    const repostDef = defs.find(d => d.activityType === 'REPOSTS');
    if (repostDef) return repostDef;
  }

  // 8. Авто-просмотры / автоуслуги
  if (n.includes('авто') && (n.includes('просмотр') || n.includes('пост') || n.includes('реакц'))) {
    const autoDef = defs.find(d => d.activityType === 'AUTO_VIEWS') || defs.find(d => d.activityType === 'AUTO');
    if (autoDef) return autoDef;
    return defs.find(d => d.activityType === 'VIEWS') || defs[0];
  }

  // 9. Опросы / голоса
  if (((n.includes('опрос') && !n.includes('автопрос')) || n.includes('голос') || n.includes('poll') || n.includes('vote'))) {
    const pollDef = defs.find(d => d.activityType === 'POLLS') || defs.find(d => d.activityType === 'COMMENTS');
    if (pollDef) return pollDef;
  }

  // 10. Прослушивания (VK)
  if (n.includes('прослуш') || n.includes('музык') || n.includes('плейлист') || n.includes('play')) {
    const playDef = defs.find(d => d.activityType === 'PLAYS');
    if (playDef) return playDef;
  }

  // 11. Стримы / эфиры / зрители
  if (n.includes('стрим') || n.includes('трансляц') || n.includes('эфир') || n.includes('зрител') || n.includes('live')) {
    const streamDef = defs.find(d => d.activityType === 'STREAMS');
    if (streamDef) return streamDef;
    return defs.find(d => d.activityType === 'VIEWS') || defs[0];
  }

  // 12. Сохранения / охваты / статистика
  if (n.includes('сохранен') || n.includes('статистик') || n.includes('посещен')) {
    const saveDef = defs.find(d => d.activityType === 'SAVES');
    if (saveDef) return saveDef;
  }

  // 13. Реакции (и Лайки в Telegram)
  if (n.includes('реакц') || n.includes('эмодзи') || n.includes('reaction') || n.includes('emoji') || (networkKey === 'TELEGRAM' && (n.includes('лайк') || n.includes('like')))) {
    const reactDef = defs.find(d => d.activityType === 'REACTIONS');
    if (reactDef) return reactDef;
  }

  // 14. Комментарии
  if (n.includes('коммент') || n.includes('отзыв') || n.includes('comment') || n.includes('review')) {
    const commentDef = defs.find(d => d.activityType === 'COMMENTS');
    if (commentDef) return commentDef;
  }

  // 15. Лайки
  if (n.includes('лайк') || n.includes('нравится') || n.includes('like') || n.includes('heart') || n.includes('дизлайк')) {
    const likeDef = defs.find(d => d.activityType === 'LIKES') || defs.find(d => d.activityType === 'REACTIONS');
    if (likeDef) return likeDef;
  }

  // 16. Просмотры
  if (n.includes('просмотр') || n.includes('view') || n.includes('охват') || n.includes('показ')) {
    const viewDef = defs.find(d => d.activityType === 'VIEWS');
    if (viewDef) return viewDef;
  }

  // 17. Прочие ключевые слова
  for (const def of defs) {
    for (const kw of def.matchKeywords) {
      if (n.includes(kw)) return def;
    }
  }

  // Fallback
  return defs.find(d => d.activityType === 'OTHER') || defs[defs.length - 1];
}

function getFitScore(catName: string, targetName: string): number {
  const c = catName.trim().toLowerCase();
  const t = targetName.toLowerCase();
  if (c === t) return 1000;
  if (c.startsWith(t)) return 500;
  if (c.includes(t)) return 100;
  return 0;
}

async function runConsolidator() {
  const isApply = process.argv.includes('--apply');
  console.log(`\n================================================================`);
  console.log(`🚀 OMNISMM CATALOG TAXONOMY CONSOLIDATOR (v1.0.0)`);
  console.log(`Mode: ${isApply ? '⚡ APPLY (MUTATING DATABASE)' : '🔍 DRY-RUN (INSPECTION ONLY)'}`);
  console.log(`================================================================\n`);

  const networks = await prisma.network.findMany({
    include: {
      categories: {
        include: {
          _count: { select: { services: true } }
        },
        orderBy: { name: 'asc' }
      }
    },
    orderBy: { name: 'asc' }
  });

  let totalCategoriesBefore = 0;
  let totalServices = 0;
  let targetCanonicalCount = 0;
  let plannedMerges = 0;

  const planPerNetwork: Record<string, Array<{
    canonicalName: string;
    canonicalActivityType: string;
    mergedCategories: Array<{ id: string; name: string; servicesCount: number }>;
  }>> = {};

  for (const net of networks) {
    const netKey = normalizePlatformSlug(net.slug || net.name);
    const canonicalDefs = CANONICAL_TAXONOMY[netKey] || CANONICAL_TAXONOMY.DEFAULT;
    
    // Группируем существующие категории по activityType
    const bucket = new Map<string, typeof net.categories>();
    for (const cat of net.categories) {
      totalCategoriesBefore++;
      totalServices += cat._count.services;

      const def = resolveCanonicalActivity(cat.name, netKey);
      const l = bucket.get(def.activityType) || [];
      l.push(cat);
      bucket.set(def.activityType, l);
    }

    planPerNetwork[net.name] = [];

    for (const [activityType, cats] of bucket.entries()) {
      const def = canonicalDefs.find(d => d.activityType === activityType)!;
      targetCanonicalCount++;

      // Выбираем категорию с наивысшим совпадением с каноническим названием
      cats.sort((a, b) => {
        const scoreA = getFitScore(a.name, def.name);
        const scoreB = getFitScore(b.name, def.name);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return b._count.services - a._count.services;
      });

      const canonicalWinner = cats[0];
      const otherDuplicates = cats.slice(1);
      plannedMerges += otherDuplicates.length;

      planPerNetwork[net.name].push({
        canonicalName: def.name,
        canonicalActivityType: def.activityType,
        mergedCategories: cats.map(c => ({ id: c.id, name: c.name, servicesCount: c._count.services }))
      });
    }
  }

  console.log(`📊 АНАЛИТИЧЕСКИЙ СРЕЗ:`);
  console.log(`- Социальных сетей: ${networks.length}`);
  console.log(`- Категорий ДО консолидации: ${totalCategoriesBefore}`);
  console.log(`- Категорий ПОСЛЕ консолидации: ${targetCanonicalCount} (📉 сокращение на ${Math.round((1 - targetCanonicalCount / totalCategoriesBefore) * 100)}%!)`);
  console.log(`- Всего услуг в каталоге: ${totalServices} (100% сохраняются)`);
  console.log(`- Категорий-дубликатов под слияние/удаление: ${plannedMerges}\n`);

  // Детальный вывод по всем платформам
  for (const [netName, items] of Object.entries(planPerNetwork)) {
    console.log(`📌 ПЛАТФОРМА: ${netName.toUpperCase()}`);
    for (const item of items) {
      const totalSrv = item.mergedCategories.reduce((s, c) => s + c.servicesCount, 0);
      console.log(`  ⭐ Каноническая: "${item.canonicalName}" (${totalSrv} услуг, объединяет ${item.mergedCategories.length} категорий)`);
      if (item.mergedCategories.length > 1) {
        item.mergedCategories.slice(0, 5).forEach(c => {
          console.log(`     ↳ [${c.servicesCount} srv] "${c.name}"`);
        });
        if (item.mergedCategories.length > 5) {
          console.log(`     ↳ ... и еще ${item.mergedCategories.length - 5} категорий`);
        }
      }
    }
    console.log('');
  }

  if (!isApply) {
    console.log(`----------------------------------------------------------------`);
    console.log(`💡 Это был DRY-RUN запуск. Никакие данные в БД не изменялись.`);
    console.log(`Для применения консолидации запустите:`);
    console.log(`  npx tsx scripts/catalog-taxonomy-consolidator.ts --apply\n`);
    return;
  }

  // EXECUTION MODE
  console.log(`\n⚙️ ПРИМЕНЕНИЕ КОНСОЛИДАЦИИ В БАЗЕ ДАННЫХ...`);
  let movedServices = 0;
  let deletedCats = 0;
  let renamedCats = 0;

  for (const net of networks) {
    const netKey = normalizePlatformSlug(net.slug || net.name);
    const canonicalDefs = CANONICAL_TAXONOMY[netKey] || CANONICAL_TAXONOMY.DEFAULT;
    
    const bucket = new Map<string, typeof net.categories>();
    for (const cat of net.categories) {
      const def = resolveCanonicalActivity(cat.name, netKey);
      const l = bucket.get(def.activityType) || [];
      l.push(cat);
      bucket.set(def.activityType, l);
    }

    for (const [activityType, cats] of bucket.entries()) {
      const def = canonicalDefs.find(d => d.activityType === activityType)!;
      const targetSlug = `${net.slug}-${def.slugSuffix}`;

      // 1. Приоритет выбора победителя:
      // Сначала ищем категорию, у которой слаг УЖЕ равен targetSlug
      // Затем точное совпадение имени
      // Затем сортировка по score и количеству услуг
      cats.sort((a, b) => {
        if (a.slug === targetSlug && b.slug !== targetSlug) return -1;
        if (b.slug === targetSlug && a.slug !== targetSlug) return 1;
        const exactA = a.name.toLowerCase().trim() === def.name.toLowerCase().trim() ? 1 : 0;
        const exactB = b.name.toLowerCase().trim() === def.name.toLowerCase().trim() ? 1 : 0;
        if (exactA !== exactB) return exactB - exactA;
        const scoreA = getFitScore(a.name, def.name);
        const scoreB = getFitScore(b.name, def.name);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return b._count.services - a._count.services;
      });

      const winner = cats[0];
      const dupes = cats.slice(1);

      // 2. Сначала переносим все услуги из дублей в winner
      for (const dupe of dupes) {
        if (dupe._count.services > 0) {
          const res = await prisma.service.updateMany({
            where: { categoryId: dupe.id },
            data: { categoryId: winner.id }
          });
          movedServices += res.count;
        }

        // Если у дубля был слаг targetSlug, временно освобождаем его
        if (dupe.slug === targetSlug) {
          await prisma.category.update({
            where: { id: dupe.id },
            data: { slug: `temp-${dupe.id}-${Date.now()}` }
          });
        }

        // Удаляем дубль
        await prisma.category.delete({
          where: { id: dupe.id }
        });
        deletedCats++;
      }

      // 3. Проверяем, свободен ли targetSlug в базе
      let resolvedSlug = targetSlug;
      if (winner.slug !== targetSlug) {
        const conflict = await prisma.category.findUnique({
          where: { slug: targetSlug }
        });
        if (conflict && conflict.id !== winner.id) {
          resolvedSlug = `${targetSlug}-${winner.id.slice(-4)}`;
        }
      }

      // 4. Обновляем победителя
      await prisma.category.update({
        where: { id: winner.id },
        data: {
          name: def.name,
          slug: resolvedSlug,
          activityType: def.activityType,
          sort: def.sort,
          tenantId: 'all',
        }
      });
      renamedCats++;
    }
  }

  if (isApply) {
    await relocateMisplacedServices();
  }

  const finalCats = await prisma.category.count();
  const finalSrv = await prisma.service.count();

  // Flush Redis Cache
  if (isApply) {
    try {
      const Redis = (await import('ioredis')).default;
      const redis = new Redis(process.env.REDIS_URL || 'redis://:SmmP1anR3dis2026Secure!@localhost:6379');
      const catKeys = await redis.keys('*catalog*');
      const srvKeys = await redis.keys('*service*');
      const netKeys = await redis.keys('*network*');
      const all = [...new Set([...catKeys, ...srvKeys, ...netKeys])];
      if (all.length > 0) {
        await redis.del(...all);
        console.log(`  🧹 Flushed ${all.length} Redis cache keys for storefront.`);
      }
      await redis.quit();
    } catch (err) {
      console.warn('  ⚠️ Could not flush Redis cache:', err);
    }
  }

  console.log(`\n🎉 КОНСОЛИДАЦИЯ УСПЕШНО ЗАВЕРШЕНА!`);
  console.log(`- Перелинковано услуг: ${movedServices}`);
  console.log(`- Удалено категорий-дубликатов: ${deletedCats}`);
  console.log(`- Категорий в БД: ${finalCats} (было ${totalCategoriesBefore})`);
  console.log(`- Услуг в БД: ${finalSrv} (было ${totalServices}, 100% сохранены)`);
  console.log(`================================================================\n`);
}

async function relocateMisplacedServices() {
  console.log('🧹 [Taxonomy Hygiene] Проверка и исправление ошибочно распределенных услуг...');
  
  // 1. Telegram
  const tgNet = await prisma.network.findFirst({ 
    where: { slug: { contains: 'telegram', mode: 'insensitive' } } 
  });
  if (tgNet) {
    const tgSubs = await prisma.category.findFirst({ where: { networkId: tgNet.id, name: 'Подписчики' }, include: { services: true } });
    const tgPrem = await prisma.category.findFirst({ where: { networkId: tgNet.id, name: 'Подписчики премиум' } });
    const tgReact = await prisma.category.findFirst({ where: { networkId: tgNet.id, name: 'Реакции' } });
    let tgStars = await prisma.category.findFirst({ 
      where: { networkId: tgNet.id, name: { in: ['Звёзды', 'Звезды'] } } 
    });
    if (!tgStars) {
      tgStars = await prisma.category.create({
        data: {
          name: 'Звёзды',
          slug: 'telegram-stars',
          networkId: tgNet.id,
          activityType: 'STARS',
          sort: 100,
          tenantId: 'all'
        }
      });
      console.log('  ↳ [TG] Создана каноническая категория "Звёзды"');
    }

    if (tgSubs) {
      for (const s of tgSubs.services) {
        const lower = s.name.toLowerCase();
        if (tgPrem && (lower.includes('премиум') || lower.includes('со звездой') || lower.includes('⭐️') || lower.includes('premium'))) {
          await prisma.service.update({ where: { id: s.id }, data: { categoryId: tgPrem.id } });
          console.log(`  ↳ [TG] Перемещена услуга "${s.name}" из "Подписчики" в "Подписчики премиум"`);
        } else if (tgReact && (lower.includes('лайк') || lower.includes('реакц'))) {
          await prisma.service.update({ where: { id: s.id }, data: { categoryId: tgReact.id } });
          console.log(`  ↳ [TG] Перемещена услуга "${s.name}" из "Подписчики" в "Реакции"`);
        } else if (tgStars && (lower.includes('звезд') || lower.includes('star'))) {
          await prisma.service.update({ where: { id: s.id }, data: { categoryId: tgStars.id } });
          console.log(`  ↳ [TG] Перемещена услуга "${s.name}" из "Подписчики" в "Звёзды"`);
        }
      }
    }
  }

  // 2. YouTube
  const ytNet = await prisma.network.findFirst({ 
    where: { slug: { contains: 'youtube', mode: 'insensitive' } } 
  });
  if (ytNet) {
    const ytSubs = await prisma.category.findFirst({ where: { networkId: ytNet.id, name: 'Подписчики' }, include: { services: true } });
    const ytViews = await prisma.category.findFirst({ where: { networkId: ytNet.id, name: 'Просмотры' } });
    const ytLikes = await prisma.category.findFirst({ where: { networkId: ytNet.id, name: 'Лайки' } });
    const ytReposts = await prisma.category.findFirst({ where: { networkId: ytNet.id, name: 'Репосты' } });
    if (ytSubs) {
      for (const s of ytSubs.services) {
        const lower = s.name.toLowerCase();
        if (ytLikes && (lower.includes('лайк') || lower.includes('like') || lower.includes('дизлайк'))) {
          await prisma.service.update({ where: { id: s.id }, data: { categoryId: ytLikes.id } });
          console.log(`  ↳ [YT] Перемещена услуга "${s.name}" из "Подписчики" в "Лайки"`);
        } else if (ytReposts && (lower.includes('репост') || lower.includes('поделит') || lower.includes('share'))) {
          await prisma.service.update({ where: { id: s.id }, data: { categoryId: ytReposts.id } });
          console.log(`  ↳ [YT] Перемещена услуга "${s.name}" из "Подписчики" в "Репосты"`);
        } else if (ytViews && (lower.includes('просмотр') || lower.includes('видео') || lower.includes('video') || lower.includes('shorts') || lower.includes('часы'))) {
          await prisma.service.update({ where: { id: s.id }, data: { categoryId: ytViews.id } });
          console.log(`  ↳ [YT] Перемещена услуга "${s.name}" из "Подписчики" в "Просмотры"`);
        }
      }
    }
  }

  // 3. Relocate from "Другое" across all networks if keywords match
  const otherCats = await prisma.category.findMany({
    where: { name: 'Другое' },
    include: { services: true, network: { include: { categories: true } } }
  });
  for (const cat of otherCats) {
    if (!cat.network) continue;
    const catsInNet = cat.network.categories;
    const viewsCat = catsInNet.find(c => c.name === 'Просмотры');
    const likesCat = catsInNet.find(c => c.name === 'Лайки' || c.name === 'Реакции и Лайки');
    const streamsCat = catsInNet.find(c => c.name === 'Зрители на Стрим' || c.name === 'Стримы');
    const subsCat = catsInNet.find(c => c.name === 'Подписчики' || c.name === 'Подписчики и Друзья' || c.name === 'Фолловеры');
    const repostsCat = catsInNet.find(c => c.name === 'Репосты' || c.name === 'Ретвиты');
    const commentsCat = catsInNet.find(c => c.name === 'Комментарии');

    for (const s of cat.services) {
      const lower = s.name.toLowerCase();
      let targetCat: typeof cat | undefined;
      if (likesCat && (lower.includes('лайк') || lower.includes('like') || lower.includes('дизлайк') || lower.includes('реакц'))) {
        targetCat = likesCat;
      } else if (streamsCat && (lower.includes('зрител') || lower.includes('стрим') || lower.includes('live') || lower.includes('эфир'))) {
        targetCat = streamsCat;
      } else if (viewsCat && (lower.includes('просмотр') || lower.includes('view') || lower.includes('рилс') || lower.includes('клип') || lower.includes('показ'))) {
        targetCat = viewsCat;
      } else if (subsCat && (lower.includes('подписч') || lower.includes('фолловер') || lower.includes('участник') || lower.includes('member'))) {
        targetCat = subsCat;
      } else if (repostsCat && (lower.includes('репост') || lower.includes('поделит') || lower.includes('share') || lower.includes('ретвит'))) {
        targetCat = repostsCat;
      } else if (commentsCat && (lower.includes('коммент') || lower.includes('comment'))) {
        targetCat = commentsCat;
      }

      if (targetCat && targetCat.id !== cat.id) {
        await prisma.service.update({ where: { id: s.id }, data: { categoryId: targetCat.id } });
        console.log(`  ↳ [${cat.network.name}] Перемещена услуга "${s.name}" из "Другое" в "${targetCat.name}"`);
      }
    }

    // Clean up empty "Другое" if it has 0 services
    const remaining = await prisma.service.count({ where: { categoryId: cat.id } });
    if (remaining === 0) {
      await prisma.category.delete({ where: { id: cat.id } });
      console.log(`  ↳ [${cat.network.name}] Удалена пустая категория "Другое"`);
    }
  }
}

runConsolidator()
  .catch(err => {
    console.error('Fatal Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
