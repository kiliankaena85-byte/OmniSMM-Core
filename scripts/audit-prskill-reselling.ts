import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const USD_RUB = 95.0;

function clean(str: string): string {
  return str.toLowerCase().replace(/[^a-zа-я0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function detectPlatform(category: string, name: string): string {
  const text = `${category} ${name}`.toLowerCase();
  if (text.includes('telegram') || text.includes('телеграм') || text.includes(' tg ')) return 'Telegram';
  if (text.includes('instagram') || text.includes('инстаграм') || text.includes(' ig ')) return 'Instagram';
  if (text.includes('youtube') || text.includes('ютуб') || text.includes(' yt ')) return 'YouTube';
  if (text.includes('vk') || text.includes('вконтакте') || text.includes('вк')) return 'VK';
  if (text.includes('tiktok') || text.includes('тикток') || text.includes(' tt ')) return 'TikTok';
  if (text.includes('rutube') || text.includes('рутуб')) return 'Rutube';
  if (text.includes('twitter') || text.includes(' x ') || text.includes('твиттер')) return 'Twitter';
  if (text.includes('facebook') || text.includes('фейсбук')) return 'Facebook';
  if (text.includes('ссылк') || text.includes('трафик') || text.includes('traffic')) return 'SEO / Трафик';
  return 'Other';
}

function detectAction(category: string, name: string): string {
  const text = `${category} ${name}`.toLowerCase();
  if (text.includes('подписчик') || text.includes('участник') || text.includes('subscriber') || text.includes('member') || text.includes('follower')) return 'Подписчики';
  if (text.includes('просмотр') || text.includes('view')) return 'Просмотры';
  if (text.includes('лайк') || text.includes('like')) return 'Лайки';
  if (text.includes('реакци') || text.includes('reaction')) return 'Реакции';
  if (text.includes('коммент') || text.includes('comment')) return 'Комментарии';
  if (text.includes('репост') || text.includes('share')) return 'Репосты';
  return 'Другое';
}

async function main() {
  console.log('=== АУДИТ ПЕРЕКУПЩИКА: PRSKILL.RU VS ВСЕ ПРОВАЙДЕРЫ ===\n');

  const prskill = await prisma.provider.findFirst({ where: { name: 'PRSkill' } });
  if (!prskill) return;

  const prskillServices = await prisma.shadowService.findMany({
    where: { providerId: prskill.id }
  });

  const otherServices = await prisma.shadowService.findMany({
    where: { providerId: { not: prskill.id } },
    include: { provider: { select: { name: true, balanceCurrency: true } } }
  });

  console.log(`Услуг у PRSkill: ${prskillServices.length}`);
  console.log(`Услуг у остальных провайдеров: ${otherServices.length}\n`);

  // 1. Анализ распределения PRSkill по платформам
  const platforms: Record<string, number> = {};
  for (const s of prskillServices) {
    const plt = detectPlatform(s.category, s.name);
    platforms[plt] = (platforms[plt] || 0) + 1;
  }
  console.log('1. Каталог PRSkill по платформам:');
  for (const [p, c] of Object.entries(platforms).sort((a, b) => b[1] - a[1])) {
    console.log(`   - ${p.padEnd(14)}: ${c} услуг`);
  }

  // 2. Сравнение цен по ключевым сегментам
  console.log('\n2. Сравнение минимальных цен (PRSkill vs Другие провайдеры в рублях за 1 000 шт.):\n');

  const keySegments = [
    { platform: 'VK', action: 'Подписчики' },
    { platform: 'VK', action: 'Лайки' },
    { platform: 'Telegram', action: 'Подписчики' },
    { platform: 'Telegram', action: 'Просмотры' },
    { platform: 'Telegram', action: 'Реакции' },
    { platform: 'Instagram', action: 'Подписчики' },
    { platform: 'Instagram', action: 'Лайки' },
    { platform: 'Instagram', action: 'Просмотры' },
    { platform: 'YouTube', action: 'Просмотры' },
    { platform: 'YouTube', action: 'Подписчики' },
    { platform: 'TikTok', action: 'Просмотры' },
    { platform: 'TikTok', action: 'Подписчики' },
  ];

  for (const seg of keySegments) {
    const prMatch = prskillServices.filter(s => detectPlatform(s.category, s.name) === seg.platform && detectAction(s.category, s.name) === seg.action);
    const othMatch = otherServices.filter(s => detectPlatform(s.category, s.name) === seg.platform && detectAction(s.category, s.name) === seg.action);

    if (!prMatch.length || !othMatch.length) continue;

    prMatch.sort((a, b) => Number(a.rate) - Number(b.rate));
    const prMin = prMatch[0];
    const prMinRub = Number(prMin.rate);

    // Other min rub
    othMatch.sort((a, b) => {
      const aRub = a.provider.balanceCurrency === 'USD' ? Number(a.rate) * USD_RUB : Number(a.rate);
      const bRub = b.provider.balanceCurrency === 'USD' ? Number(b.rate) * USD_RUB : Number(b.rate);
      return aRub - bRub;
    });

    const bestOther = othMatch[0];
    const bestOtherRub = bestOther.provider.balanceCurrency === 'USD' ? Number(bestOther.rate) * USD_RUB : Number(bestOther.rate);

    const markupPercent = Math.round(((prMinRub / bestOtherRub) - 1) * 100);

    console.log(`📌 [${seg.platform} -> ${seg.action}]:`);
    console.log(`   PRSkill (минимальная цена): ${prMinRub.toFixed(2)} ₽ / 1k ("${prMin.name.slice(0, 50)}")`);
    console.log(`   🥇 Лучшая цена в системе:  ${bestOtherRub.toFixed(2)} ₽ / 1k [${bestOther.provider.name}] ("${bestOther.name.slice(0, 50)}")`);
    if (markupPercent > 0) {
      console.log(`   🚨 ВЫВОД: PRSkill ДОРОЖЕ в ${(prMinRub / bestOtherRub).toFixed(1)} раз (+${markupPercent}% наценка!)`);
    } else {
      console.log(`   🏆 ВЫВОД: PRSkill ДЕШЕВЛЕ на ${Math.abs(markupPercent)}%!`);
    }
    console.log('');
  }

  // 3. Поиск идентичных услуг и текстовых сигнатур
  console.log('=== 3. СИГНАТУРНЫЙ АНАЛИЗ (ПОИСК ПРЯМЫХ ДОНОРОВ PRSKILL) ===\n');

  interface DirectCopy {
    platform: string;
    prskillName: string;
    prskillPrice: number;
    donorProvider: string;
    donorName: string;
    donorPrice: number;
    markup: number;
  }

  const directCopies: DirectCopy[] = [];

  for (const pr of prskillServices) {
    const prClean = clean(pr.name);
    const prRate = Number(pr.rate);

    for (const oth of otherServices) {
      const othClean = clean(oth.name);
      const othRate = oth.provider.balanceCurrency === 'USD' ? Number(oth.rate) * USD_RUB : Number(oth.rate);

      // Check min/max identity and text overlap
      const sameMinMax = pr.min === oth.min && pr.max === oth.max && pr.min > 10;
      const textMatch = prClean.includes(othClean.slice(0, 25)) || othClean.includes(prClean.slice(0, 25));

      if ((sameMinMax && textMatch) || (prClean.length > 30 && othClean.length > 30 && prClean === othClean)) {
        if (prRate > othRate) {
          directCopies.push({
            platform: detectPlatform(pr.category, pr.name),
            prskillName: pr.name,
            prskillPrice: prRate,
            donorProvider: oth.provider.name,
            donorName: oth.name,
            donorPrice: othRate,
            markup: Math.round(((prRate / othRate) - 1) * 100),
          });
        }
      }
    }
  }

  console.log(`Найдено прямых совпадений по сигнатурам доноров: ${directCopies.length}\n`);

  directCopies.sort((a, b) => b.markup - a.markup);

  directCopies.slice(0, 10).forEach((c, i) => {
    console.log(`[Связка #${i + 1}] [${c.platform}]`);
    console.log(`   PRSkill:  ${c.prskillPrice.toFixed(2)} ₽ ("${c.prskillName.slice(0, 60)}")`);
    console.log(`   Донор:    ${c.donorPrice.toFixed(2)} ₽ [${c.donorProvider}] ("${c.donorName.slice(0, 60)}")`);
    console.log(`   📈 Наценка PRSkill: +${c.markup}% (в ${(c.prskillPrice / c.donorPrice).toFixed(1)} раз дороже!)\n`);
  });
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Audit failed:', err);
    process.exit(1);
  });
