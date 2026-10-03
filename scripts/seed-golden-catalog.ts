import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface RawService {
  provider: string;
  service: string | number;
  name: string;
  category: string;
  rate: string | number;
  min: string | number;
  max: string | number;
  refill?: boolean;
}

const PROVIDERS = [
  { name: 'VexBoost', url: 'https://vexboost.ru/api/v2', key: 'NrgY6iwm34j6JwDVwdSqGpCLQ7DzPpdWWP3UQzfRTNhuW42UkvoOZ6GsDCfD' },
  { name: 'Soc-Rocket', url: 'https://soc-rocket.ru/api/v2', key: 'a4rhzjHA6oirPXVDVYth5ENDgERTgoOi' },
  { name: 'SMMPrime', url: 'https://smmprime.com/api/v2', key: 'fdca04c435054be29eb5b487dbd336b7' },
  { name: 'Stream-Promotion', url: 'https://stream-promotion.com/api/v2', key: 'pB7LK6auFhmsuntExn9gYvgo5myeDmS4' },
  { name: 'SMMPanelUS', url: 'https://smmpanelus.com/api/v2', key: '62c587ccc0b54a28f35d3840b93c72b8' },
  { name: 'ProSMM-Shop', url: 'https://prosmm-shop.com/api/v2', key: '4ecef90f16dea697ef32404efe293ba1' }
];

const providerMap: Record<string, string> = {};

function getNetwork(text: string): string {
  const t = text.toLowerCase();
  
  if (t.includes('telegram') || t.includes('tg') || t.includes('тг') || t.includes('телеграм')) return 'Telegram';
  if (t.includes('instagram') || t.includes('inst') || t.includes('инста') || t.includes('ig')) return 'Instagram';
  if (t.includes('tiktok') || t.includes('тикток') || t.includes('tt')) return 'TikTok';
  if (t.includes('youtube') || t.includes('ютуб') || t.includes('yt')) return 'YouTube';
  if (t.includes('facebook') || t.includes('fb')) return 'Facebook';
  if (t.includes('vk ') || t.includes('вк') || t.includes('вконтакте') || text.includes('VK ')) return 'VKontakte';
  if (t.includes('twitter') || t.includes('x.com') || t.includes(' x ') || text.includes('Twitter')) return 'Twitter (X)';
  if (t.includes('reddit') || t.includes('реддит')) return 'Reddit';
  if (t.includes('twitch') || t.includes('твич')) return 'Twitch';
  if (t.includes('discord') || t.includes('дискорд')) return 'Discord';
  if (t.includes('spotify') || t.includes('спотифай')) return 'Spotify';
  if (t.includes('soundcloud') || t.includes('саундклауд')) return 'SoundCloud';
  if (t.includes('pinterest') || t.includes('пинтерест')) return 'Pinterest';
  if (t.includes('linkedin') || t.includes('линкедин')) return 'LinkedIn';
  if (t.includes('rutube') || t.includes('рутуб')) return 'Rutube';
  if (t.includes('odnoklassniki') || t.includes('одноклассники') || t.includes(' ok ') || text.includes('ОК ')) return 'Odnoklassniki';
  if (t.includes('dzen') || t.includes('дзен')) return 'Yandex Dzen';
  if (t.includes('likee') || t.includes('лайки (соц')) return 'Likee';
  if (t.includes('kick') || t.includes('кик')) return 'Kick';
  if (t.includes('trovo') || t.includes('трово')) return 'Trovo';
  if (t.includes('whatsapp') || t.includes('ватсап')) return 'WhatsApp';
  if (t.includes('viber') || t.includes('вайбер')) return 'Viber';
  if (t.includes('pikabu') || t.includes('пикабу')) return 'Pikabu';
  if (t.includes('github') || t.includes('гитхаб')) return 'GitHub';
  if (t.includes('tumblr') || t.includes('тамблер')) return 'Tumblr';
  if (t.includes('behance') || t.includes('биханс')) return 'Behance';
  if (t.includes('threads') || t.includes('тредс')) return 'Threads';
  if (t.includes('quora')) return 'Quora';
  if (t.includes('rumble')) return 'Rumble';
  
  return 'Other';
}

function getAction(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('подписчики') || t.includes('subscribers') || t.includes('followers') || t.includes('фолловеры') || t.includes('участники') || t.includes('members')) return 'Подписчики';
  if (t.includes('авто') && (t.includes('просмотр') || t.includes('views'))) return 'Автопросмотры';
  if (t.includes('авто') && (t.includes('лайк') || t.includes('likes'))) return 'Автолайки';
  if (t.includes('просмотры') || t.includes('views') || t.includes('глаз')) return 'Просмотры';
  if (t.includes('лайки') || t.includes('likes') || t.includes('сердечк') || t.includes('звезды') || t.includes('stars')) return 'Лайки';
  if (t.includes('реакции') || t.includes('reactions')) return 'Реакции';
  if (t.includes('комментарии') || t.includes('comments')) return 'Комментарии';
  if (t.includes('репосты') || t.includes('reposts') || t.includes('shares') || t.includes('retweets')) return 'Репосты';
  if (t.includes('зрители') || t.includes('viewers') || t.includes('стрим') || t.includes('stream')) return 'Зрители на стрим';
  if (t.includes('охват') || t.includes('reach') || t.includes('показы') || t.includes('impressions') || t.includes('сохранения') || t.includes('saves')) return 'Статистика';
  if (t.includes('голоса') || t.includes('votes') || t.includes('опрос') || t.includes('polls')) return 'Опросы';
  
  return 'Прочее';
}

function getTier(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('жив') || t.includes('real') || t.includes('актив') || t.includes('настоящ')) return 'Живые (Real)';
  if (t.includes('прем') || t.includes('premium') || t.includes('гарант') || t.includes('без списаний') || t.includes('no drop') || t.includes('vip') || t.includes('золот') || t.includes('gold')) return 'Премиум';
  if (t.includes('эконом') || t.includes('cheap') || t.includes('дешев') || t.includes('бот') || t.includes('bot') || t.includes('mix') || t.includes('микс') || t.includes('низк')) return 'Эконом';
  return 'Стандарт';
}

function extractSpeed(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('моменталь') || t.includes('instant')) return 'моментально';
  if (t.includes('быстр') || t.includes('fast')) return 'быстро';
  const match = t.match(/(\d+[kк]?\s*(?:-\s*\d+[kк]?)?\s*\/\s*(?:день|сутки|hour|day))/);
  if (match) return match[1];
  return 'стандартная';
}

function getLinkRequirement(network: string, action: string): string {
  if (action === 'Автопросмотры' || action === 'Автолайки') return 'Строго на канал/профиль (например, t.me/durov). Не на отдельный пост!';
  if (network === 'Telegram' && action === 'Подписчики') return 'Ссылка на публичный канал или чат (t.me/durov)';
  if (network === 'Telegram' && (action === 'Просмотры' || action === 'Реакции')) return 'Ссылка строго на конкретный пост (t.me/durov/123)';
  if (network === 'Instagram' && action === 'Подписчики') return 'Ссылка на открытый профиль (instagram.com/username)';
  if (network === 'Instagram') return 'Ссылка строго на пост или Reels';
  if (network === 'VKontakte' && action === 'Подписчики') return 'Ссылка на группу или публичную страницу';
  if (network === 'YouTube' && action === 'Подписчики') return 'Ссылка на канал (youtube.com/@username)';
  if (network === 'YouTube') return 'Ссылка на видео (youtube.com/watch?v=...)';
  if (action === 'Зрители на стрим') return 'Ссылка на активный прямой эфир';
  
  if (action === 'Подписчики') return 'Ссылка на открытый профиль / канал';
  return 'Ссылка на конкретный пост / публикацию';
}

function generateDescription(network: string, action: string, tier: string, rawName: string): string {
  let qualityText = '';
  let dropText = '';
  
  if (tier === 'Эконом') {
    qualityText = 'базовое (микс всего мира). Только для цифры.';
    dropText = '⚠️ Списания: возможны (без гарантии)';
  } else if (tier === 'Стандарт') {
    qualityText = 'среднее (оптимальный баланс). Выглядит естественно.';
    dropText = '🛡️ Гарантия: 30 дней';
  } else if (tier === 'Премиум') {
    qualityText = 'высокое. Качественные аккаунты с аватарками.';
    dropText = '🛡️ Гарантия: безусловная (без списаний)';
  } else {
    qualityText = 'максимальное. Реальные живые люди (офферы).';
    dropText = '🛡️ Гарантия: пожизненная защита от списаний';
  }

  const speed = extractSpeed(rawName);
  const linkReq = getLinkRequirement(network, action);

  return `* 💎 Качество: ${qualityText}
* 🚀 Скорость: ${speed}
* ${dropText}
* 🔗 Ссылка: ${linkReq}`;
}

async function main() {
  const { CatalogLockGuard } = await import('../src/lib/catalog-lock');
  const isLocked = await CatalogLockGuard.isLocked().catch(() => true);
  const existingCats = await prisma.category.count();
  if (isLocked) {
    console.error(`⛔ [GUARD] Catalog is LOCKED & INVIOLABLE. Aborting seed-golden-catalog. Unlock via scripts/lock-database.ts unlock first.`);
    process.exit(1);
  }
  if (existingCats > 0 && !process.argv.includes('--force')) {
    console.error(`⛔ [GUARD] Database already contains ${existingCats} existing categories. Aborting seed-golden-catalog.`);
    process.exit(1);
  }
  console.log('Ensure Providers exist in DB...');
  for (const p of PROVIDERS) {
    let dbProvider = await prisma.provider.findFirst({ where: { name: p.name } });
    if (!dbProvider) {
      dbProvider = await prisma.provider.create({
        data: {
          name: p.name,
          apiUrl: p.url,
          apiKey: p.key,
          isActive: true
        }
      });
      console.log(`+ Created Provider: ${p.name}`);
    }
    providerMap[p.name.toLowerCase().replace(/[^a-z0-9]/g, '')] = dbProvider.id;
  }

  console.log('Loading raw provider data...');
  let allServices: RawService[] = [];
  for (const p of PROVIDERS) {
    const file = path.join(process.cwd(), 'provider_data', `${p.name}.json`);
    if (fs.existsSync(file)) {
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(data)) {
          for (const item of data) {
            allServices.push({ ...item, provider: p.name });
          }
        }
      } catch (e) {
        console.error(`Failed to parse ${p.name}.json`);
      }
    }
  }

  type Grouped = Record<string, Record<string, Record<string, RawService[]>>>;
  const grouped: Grouped = {};

  for (const s of allServices) {
    const network = getNetwork(s.category + ' ' + s.name);
    if (network === 'Other') continue;
    const action = getAction(s.category + ' ' + s.name);
    if (action === 'Прочее') continue;
    const tier = getTier(s.category + ' ' + s.name);
    
    if (!grouped[network]) grouped[network] = {};
    if (!grouped[network][action]) grouped[network][action] = {};
    if (!grouped[network][action][tier]) grouped[network][action][tier] = [];
    grouped[network][action][tier].push(s);
  }

  const tenantId = 'smmplan';
  let createdServices = 0;

  console.log('Starting DB Seed...');

  for (const network of Object.keys(grouped).sort()) {
    const networkSlug = network.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    let dbNetwork = await prisma.network.findFirst({ where: { slug: networkSlug } });
    if (!dbNetwork) {
      dbNetwork = await prisma.network.create({
        data: {
          name: network,
          slug: networkSlug,
          tenantId,
          isActive: true
        }
      });
      console.log(`+ Created Network: ${network}`);
    }

    for (const action of Object.keys(grouped[network]).sort()) {
      const catName = action;
      const catSlug = `${networkSlug}-${action.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-а-яё]/g, '')}`;
      let dbCategory = await prisma.category.findFirst({ where: { name: catName, tenantId, networkId: dbNetwork.id } });
      if (!dbCategory) {
        dbCategory = await prisma.category.create({
          data: {
            name: catName,
            slug: catSlug,
            tenantId,
            networkId: dbNetwork.id
          }
        });
        console.log(`  + Created Category: ${catName}`);
      }

      for (const tier of ['Эконом', 'Стандарт', 'Премиум', 'Живые (Real)']) {
        const services = grouped[network][action][tier] || [];
        const validServices = services.filter(s => {
          const min = parseInt(s.min as string) || 0;
          const max = parseInt(s.max as string) || 0;
          return min <= 500 && max >= 500;
        });
        
        if (validServices.length === 0) continue;
        validServices.sort((a, b) => parseFloat(a.rate as string) - parseFloat(b.rate as string));
        
        const best = validServices[0];
        const cleanName = `${action} — ${tier}`;
        const description = generateDescription(network, action, tier, best.category + ' ' + best.name);

        const bestProviderKey = best.provider.toLowerCase().replace(/[^a-z0-9]/g, '');
        const providerId = providerMap[bestProviderKey];

        if (!providerId) {
          continue;
        }

        const existing = await prisma.service.findFirst({
          where: {
            categoryId: dbCategory.id,
            name: cleanName,
            tenantId
          }
        });

        if (!existing) {
          const rate = parseFloat(best.rate as string);
          await prisma.service.create({
            data: {
              name: cleanName,
              description: description,
              categoryId: dbCategory.id,
              tenantId,
              providerId,
              externalId: best.service.toString(),
              rate: rate,
              costPer1kRub: rate * 95,
              markup: 3.0,
              minQty: parseInt(best.min as string) || 10,
              maxQty: parseInt(best.max as string) || 10000,
              isActive: true,
              qualityTier: tier === 'Эконом' ? 'LOW' : tier === 'Живые (Real)' ? 'REAL' : tier === 'Премиум' ? 'PREMIUM' : 'STANDARD',
            }
          });
          createdServices++;
          process.stdout.write('.');
        }
      }
    }
  }

  console.log(`\n\n✅ Done! Successfully seeded ${createdServices} golden services.`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
