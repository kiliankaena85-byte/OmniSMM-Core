import 'dotenv/config';
import { db } from '../src/lib/db';
import fs from 'fs';
import { decodeHtmlEntities, cleanServiceName } from './decision-arbiter';
import { CATEGORY_DESCRIPTIONS } from './category-descriptions';

async function main() {
  console.log('=== DRY-RUN SIMULATION OF MASTER CATALOG REFACTOR ===\n');

  // 1. Fetch current categories and networks
  const networks = await db.network.findMany({
    include: {
      categories: true
    }
  });

  const catMap = new Map<string, any>(); // key: `${netSlug}:::${catName}` -> cat
  for (const n of networks) {
    for (const c of n.categories) {
      catMap.set(`${n.slug}:::${c.name}`, { ...c, networkSlug: n.slug });
    }
  }

  // 2. Fetch all services with shadow services
  const services = await db.service.findMany({
    include: {
      category: {
        include: { network: true }
      }
    },
    orderBy: { numericId: 'asc' }
  });

  console.log(`Loaded ${services.length} services from DB.`);

  let unTruncatedCount = 0;
  let remappedCategories = 0;
  let singleReactionsCount = 0;
  let mixReactionsCount = 0;
  let textareaCommentsCount = 0;
  let numberPollsCount = 0;
  let privateCount = 0;

  for (const s of services) {
    const netSlug = s.category.network?.slug || '';
    const oldCatName = s.category.name;
    const oldName = s.name;

    // Check shadow service
    let shadowName: string | null = null;
    if (s.providerId && s.externalId) {
      const sh = await db.shadowService.findFirst({
        where: { providerId: s.providerId, externalId: s.externalId }
      });
      if (sh) shadowName = sh.name;
    }

    if (oldName.includes('...') && shadowName) {
      unTruncatedCount++;
    }

    let cleaned = cleanServiceName(oldName, shadowName);

    // Determine target category
    let targetCatName = oldCatName;
    const nLower = cleaned.toLowerCase();

    // Reroute based on Decision Model:
    // 1. Telegram Premium vs Regular
    if (netSlug === 'telegram' && oldCatName === 'Подписчики премиум') {
      if (nLower.includes('индия') || nLower.includes('турбо') || (!nLower.includes('премиум') && !nLower.includes('premium'))) {
        targetCatName = 'Подписчики';
        remappedCategories++;
      }
    }

    // 2. VKontakte Views vs Music
    if (netSlug === 'vk' && oldCatName === 'Прослушивания') {
      if (nLower.includes('клип') || nLower.includes('видео') || nLower.includes('товары') || nLower.includes('пост') || nLower.includes('глазик') || nLower.includes('посещение')) {
        targetCatName = 'Просмотры';
        remappedCategories++;
      } else if (nLower.includes('авто-просмотры') || nLower.includes('автопросмотры')) {
        targetCatName = 'Автоуслуги';
        remappedCategories++;
      }
    }

    // 3. YouTube Views vs Stream Viewers
    if (netSlug === 'youtube' && oldCatName === 'Зрители на Стрим') {
      if (nLower.includes('просмотры') && !nLower.includes('стрим') && !nLower.includes('live') && !nLower.includes('трансляц')) {
        targetCatName = 'Просмотры';
        remappedCategories++;
      }
    }

    // 4. TikTok Likes on Live vs Subscribers
    if (netSlug === 'tiktok' && oldCatName === 'Подписчики') {
      if (nLower.includes('лайк') || nLower.includes('live')) {
        targetCatName = 'Стримы';
        remappedCategories++;
      }
    }

    // 5. Twitch Clip/VOD Views vs Stream Viewers / Followers
    if (netSlug === 'twitch') {
      if ((oldCatName === 'Зрители на Стрим' || oldCatName === 'Фолловеры') && nLower.includes('просмотры')) {
        targetCatName = 'Просмотры';
        remappedCategories++;
      }
    }

    // 6. Rutube Likes/Dislikes/Clicks in Subscribers
    if (netSlug === 'rutube') {
      if (oldCatName === 'Подписчики') {
        if (nLower.includes('лайк') || nLower.includes('дизлайк') || nLower.includes('в топ')) {
          targetCatName = 'Лайки';
          remappedCategories++;
        } else if (nLower.includes('просмотр')) {
          targetCatName = 'Просмотры';
          remappedCategories++;
        }
      } else if (oldCatName === 'Комментарии' && nLower.includes('просмотр')) {
        targetCatName = 'Просмотры';
        remappedCategories++;
      }
    }

    // Distinguish Single Emoji vs Mix reactions
    if (targetCatName === 'Реакции' || targetCatName.includes('Реакции')) {
      const isSingleEmoji = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(cleaned) &&
        !nLower.includes('микс') && !nLower.includes('набор') && !nLower.includes('positive') && !nLower.includes('позитив');
      if (isSingleEmoji) {
        singleReactionsCount++;
      } else {
        mixReactionsCount++;
      }
    }

    // customDataType check
    let customDataType = 'NONE';
    if (targetCatName.includes('Комментарии') || nLower.includes('со своими') || nLower.includes('комментарии')) {
      customDataType = 'TEXTAREA';
      textareaCommentsCount++;
    } else if (targetCatName.includes('Опросы') || targetCatName.includes('Голоса') || nLower.includes('опрос') || nLower.includes('вариант')) {
      customDataType = 'NUMBER';
      numberPollsCount++;
    }

    // isPrivate check
    const isPrivate = nLower.includes('закрыт') || nLower.includes('private') || nLower.includes('t.me/+') || nLower.includes('c/');
    if (isPrivate) privateCount++;
  }

  console.log('=== DRY-RUN RESULTS ===');
  console.log(`Un-truncated Names Restored: ${unTruncatedCount}`);
  console.log(`Misplaced Services Remapped: ${remappedCategories}`);
  console.log(`Single Emoji Reactions: ${singleReactionsCount}`);
  console.log(`Mix Emoji Reactions: ${mixReactionsCount}`);
  console.log(`Textarea Comments Services: ${textareaCommentsCount}`);
  console.log(`Number Polls Services: ${numberPollsCount}`);
  console.log(`Private Channel/Post Services: ${privateCount}`);
  console.log('=======================');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
