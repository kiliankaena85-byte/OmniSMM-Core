import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const USD_RUB = 95.0;

interface RawShadow {
  id: string;
  externalId: string;
  name: string;
  category: string;
  rate: string;
  min: number;
  max: number;
  refill: boolean;
  cancel: boolean;
  dripfeed: boolean;
}

interface SelectedService {
  categoryGroup: string;
  externalId: string;
  originalName: string;
  cleanRuName: string;
  providerCostUsd: number;
  providerCostRub: number;
  min: number;
  max: number;
  refillInfo: string;
  speedInfo: string;
  suggestedRetailRub: number;
  marginPercent: number;
  advantage: string;
}

function parseRefill(name: string, category: string, refillFlag: boolean): string {
  const text = `${category} ${name}`.toLowerCase();
  if (text.includes('lifetime') || text.includes('пожизнен') || text.includes('вечная')) return 'Lifetime (Вечная)';
  if (text.includes('365d') || text.includes('365 day') || text.includes('1 year')) return '365 дней';
  if (text.includes('90d') || text.includes('90 day')) return '90 дней';
  if (text.includes('60d') || text.includes('60 day')) return '60 дней';
  if (text.includes('30d') || text.includes('30 day') || text.includes('r30')) return '30 дней';
  if (text.includes('15d') || text.includes('15 day')) return '15 дней';
  if (text.includes('7d') || text.includes('7 day')) return '7 дней';
  if (text.includes('no refill') || text.includes('no drop') || text.includes('non drop')) {
    if (text.includes('no drop') || text.includes('non drop')) return 'Без списаний (Non-Drop)';
    return 'Без гарантии';
  }
  return refillFlag ? 'Есть авто-докрутка' : 'Без гарантии';
}

function parseSpeed(name: string): string {
  const match = name.match(/(\d+k\s*\/?\s*d(?:ay)?|\d+k\s*\/?\s*h(?:our)?|instant|быстр\w*|мгновенн\w*)/i);
  if (match) return match[0].toUpperCase();
  if (name.toLowerCase().includes('instant')) return 'INSTANT';
  if (name.toLowerCase().includes('fast')) return 'FAST';
  return 'Стандартная';
}

async function main() {
  const provider = await prisma.provider.findFirst({ where: { name: 'ResellerSMM' } });
  if (!provider) {
    console.error('Provider ResellerSMM not found');
    return;
  }

  const allServices: RawShadow[] = await prisma.shadowService.findMany({
    where: { providerId: provider.id },
    select: {
      id: true,
      externalId: true,
      name: true,
      category: true,
      rate: true,
      min: true,
      max: true,
      refill: true,
      cancel: true,
      dripfeed: true,
    }
  });

  console.log(`Analyzing ${allServices.length} ResellerSMM services for curated cherry-pick...\n`);

  const selected: SelectedService[] = [];

  // Helper to find and pick best service matching criteria
  function pickTop(
    group: string,
    filterFn: (s: RawShadow) => boolean,
    scoreFn: (s: RawShadow, costRub: number) => number,
    ruNameFn: (s: RawShadow, costRub: number) => string,
    advantage: string,
    retailMultiplier: number = 3.0,
    minRetailRub: number = 0.5
  ) {
    const candidates = allServices.filter(filterFn).map(s => {
      const rateNum = Number(s.rate);
      const costRub = rateNum * USD_RUB;
      const score = scoreFn(s, costRub);
      return { s, rateNum, costRub, score };
    }).filter(c => c.score > 0);

    candidates.sort((a, b) => b.score - a.score);

    if (candidates.length > 0) {
      const best = candidates[0];
      const retail = Math.max(minRetailRub, Math.round(best.costRub * retailMultiplier * 100) / 100);
      const margin = Math.round(((retail - best.costRub) / best.costRub) * 100);

      selected.push({
        categoryGroup: group,
        externalId: best.s.externalId,
        originalName: best.s.name,
        cleanRuName: ruNameFn(best.s, best.costRub),
        providerCostUsd: best.rateNum,
        providerCostRub: Math.round(best.costRub * 100) / 100,
        min: best.s.min,
        max: best.s.max,
        refillInfo: parseRefill(best.s.name, best.s.category, best.s.refill),
        speedInfo: parseSpeed(best.s.name),
        suggestedRetailRub: retail,
        marginPercent: margin,
        advantage,
      });
    }
  }

  // === 1. TELEGRAM ===
  // Telegram Subscribers: Super Cheap (Economy Bots)
  pickTop(
    'Telegram | Подписчики',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return (t.includes('telegram') && (t.includes('member') || t.includes('subscriber'))) && !t.includes('zero') && Number(s.rate) < 0.2;
    },
    (s, cost) => {
      let score = 1000 - cost;
      if (s.name.toLowerCase().includes('non drop') || s.name.toLowerCase().includes('no drop')) score += 300;
      if (s.max >= 50000) score += 100;
      return score;
    },
    (s) => 'Telegram Подписчики — Эконом (Быстрый старт, Мировые)',
    'Сверхнизкая себестоимость: всего ~0.11₽ за 1 000 шт. Идеально для набора начальной массы канала.',
    4.5,
    9.90
  );

  // Telegram Subscribers: Standard with 30D Refill
  pickTop(
    'Telegram | Подписчики',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('telegram') && (t.includes('member') || t.includes('subscriber')) && (t.includes('30d') || t.includes('30 day')) && Number(s.rate) < 1.0;
    },
    (s, cost) => {
      let score = 500 - cost;
      if (s.name.toLowerCase().includes('real') || s.name.toLowerCase().includes('hq')) score += 200;
      if (s.name.toLowerCase().includes('fast')) score += 100;
      return score;
    },
    () => 'Telegram Подписчики — Стандарт (Гарантия 30 дней, HQ)',
    'Надежный тариф с гарантией восстановления (Refill 30D). Защита от списаний.',
    3.0,
    39.00
  );

  // Telegram Subscribers: Premium Non-Drop Lifetime
  pickTop(
    'Telegram | Подписчики',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('telegram') && (t.includes('member') || t.includes('subscriber')) && (t.includes('lifetime') || t.includes('non drop')) && Number(s.rate) < 2.5;
    },
    (s, cost) => {
      let score = 300 - cost;
      if (s.name.toLowerCase().includes('lifetime')) score += 250;
      if (s.name.toLowerCase().includes('real')) score += 150;
      return score;
    },
    () => 'Telegram Подписчики — Премиум (Вечная гарантия Lifetime, Real HQ)',
    'Пожизненная гарантия от списаний. Высочайшее качество профилей с аватарками.',
    2.8,
    79.00
  );

  // Telegram Views: Instant Post Views (Cheapest)
  pickTop(
    'Telegram | Просмотры',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('telegram') && t.includes('view') && !t.includes('auto') && Number(s.rate) < 0.05;
    },
    (s, cost) => {
      let score = 100 - cost;
      if (s.name.toLowerCase().includes('instant')) score += 50;
      if (s.max >= 500000) score += 30;
      return score;
    },
    () => 'Telegram Просмотры на пост — Моментальные (0.12₽ / 1k)',
    'Моментальный запуск за секунды, поддержка больших объемов до 1 млн просмотров.',
    5.0,
    2.90
  );

  // Telegram Reactions: Positive Emoji Pack
  pickTop(
    'Telegram | Реакции',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('telegram') && t.includes('reaction') && Number(s.rate) < 0.05;
    },
    (s, cost) => {
      let score = 100 - cost;
      if (s.name.toLowerCase().includes('positive')) score += 50;
      if (s.name.toLowerCase().includes('fast') || s.name.toLowerCase().includes('instant')) score += 30;
      return score;
    },
    () => 'Telegram Реакции — Позитивные микс (👍 ❤️ 🔥 🎉 🥰)',
    'Естественный вид поста: микс органических положительных эмодзи.',
    4.0,
    4.90
  );

  // === 2. INSTAGRAM ===
  // Instagram Followers: Economy Non-Drop
  pickTop(
    'Instagram | Подписчики',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('instagram') && (t.includes('follower') || t.includes('subscriber')) && Number(s.rate) < 0.5;
    },
    (s, cost) => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      let score = 200 - cost;
      if (t.includes('non drop') || t.includes('no drop')) score += 100;
      return score;
    },
    () => 'Instagram Подписчики — Эконом (Быстрые, Non-Drop)',
    'Себестоимость всего ~13₽ за 1 000 шт. В 3 раза дешевле конкурентов по рынку.',
    3.5,
    45.00
  );

  // Instagram Followers: 365 Days Refill / Lifetime
  pickTop(
    'Instagram | Подписчики',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('instagram') && (t.includes('follower') || t.includes('subscriber')) && (t.includes('365') || t.includes('lifetime')) && Number(s.rate) < 1.5;
    },
    (s, cost) => {
      let score = 300 - cost;
      if (s.name.toLowerCase().includes('real')) score += 150;
      return score;
    },
    () => 'Instagram Подписчики — Премиум (Гарантия 365 дней / 1 год)',
    'Годовая гарантия с авто-докруткой при любых алгоритмических списаниях Instagram.',
    2.8,
    119.00
  );

  // Instagram Likes: Fast Real Likes
  pickTop(
    'Instagram | Лайки',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('instagram') && t.includes('like') && Number(s.rate) < 0.15;
    },
    (s, cost) => {
      let score = 100 - cost;
      if (s.name.toLowerCase().includes('real') || s.name.toLowerCase().includes('hq')) score += 40;
      if (s.name.toLowerCase().includes('instant')) score += 30;
      return score;
    },
    () => 'Instagram Лайки — Высокое качество (HQ, Быстрый старт)',
    'Себестоимость ~4.20₽ за 1 000 шт. Качественные профили с публикациями.',
    3.5,
    15.00
  );

  // Instagram Reels Views
  pickTop(
    'Instagram | Reels / Просмотры',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('instagram') && (t.includes('reels') || t.includes('video views')) && Number(s.rate) < 0.02;
    },
    (s, cost) => {
      let score = 50 - cost;
      if (s.name.toLowerCase().includes('reach') || s.name.toLowerCase().includes('impression')) score += 30;
      return score;
    },
    () => 'Instagram Просмотры Reels — Вирусный охват (+Охват профиля)',
    'Себестоимость 0.11₽ за 1 000. Дает толчок для выхода Reels в рекомендации.',
    6.0,
    3.90
  );

  // === 3. YOUTUBE ===
  // YouTube Views: High Retention Suggested
  pickTop(
    'YouTube | Просмотры',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('youtube') && t.includes('view') && !t.includes('shorts') && (t.includes('retention') || t.includes('suggested') || t.includes('lifetime')) && Number(s.rate) < 1.2;
    },
    (s, cost) => {
      let score = 300 - cost;
      if (s.name.toLowerCase().includes('lifetime')) score += 100;
      if (s.name.toLowerCase().includes('suggested')) score += 80;
      return score;
    },
    () => 'YouTube Просмотры — Высокое удержание (High Retention, Пожизненная гарантия)',
    'Удержание от 1 до 5 минут. Трафик из «Рекомендованных видео». Безопасно для монетизации.',
    2.5,
    149.00
  );

  // YouTube Shorts Views: Super Fast
  pickTop(
    'YouTube | Shorts',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('youtube') && t.includes('shorts') && t.includes('view') && Number(s.rate) < 0.8;
    },
    (s, cost) => {
      let score = 200 - cost;
      if (s.name.toLowerCase().includes('fast') || s.name.toLowerCase().includes('instant')) score += 50;
      return score;
    },
    () => 'YouTube Shorts Просмотры — Быстрый разгон в ленту',
    'Быстрый старт (до 5-15 минут), разгоняет алгоритм шортсов для попадания в умную ленту.',
    3.0,
    69.00
  );

  // YouTube Subscribers: Non Drop Lifetime
  pickTop(
    'YouTube | Подписчики',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('youtube') && (t.includes('subscriber') || t.includes('sub')) && Number(s.rate) < 15.0;
    },
    (s, cost) => {
      let score = 500 - cost;
      if (s.name.toLowerCase().includes('lifetime') || s.name.toLowerCase().includes('non drop')) score += 200;
      return score;
    },
    () => 'YouTube Подписчики — Премиум (Вечная гарантия, Без списаний)',
    'Реалистичный прирост без блокировок канала. Пожизненная гарантия авто-восстановления.',
    2.2,
    790.00
  );

  // === 4. TIKTOK ===
  // TikTok Views: Fast Viral
  pickTop(
    'TikTok | Просмотры',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('tiktok') && t.includes('view') && Number(s.rate) < 0.01;
    },
    (s, cost) => {
      let score = 100 - cost;
      if (s.name.toLowerCase().includes('instant') || s.name.toLowerCase().includes('fast')) score += 30;
      return score;
    },
    () => 'TikTok Просмотры — Мгновенные (Рекомендации FYP)',
    'Себестоимость всего 0.27₽ за 1 000! Лучший ценник среди всех поставщиков.',
    5.0,
    2.50
  );

  // TikTok Followers: HQ Non Drop
  pickTop(
    'TikTok | Подписчики',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('tiktok') && (t.includes('follower') || t.includes('subscriber')) && Number(s.rate) < 2.5;
    },
    (s, cost) => {
      let score = 200 - cost;
      if (s.name.toLowerCase().includes('non drop') || s.name.toLowerCase().includes('no drop')) score += 50;
      return score;
    },
    () => 'TikTok Подписчики — Высокое качество (HQ, Гарантия)',
    'Себестоимость ~91₽ за 1 000. Заполнение профилей, аватарки, видео на аккаунтах.',
    2.5,
    229.00
  );

  // TikTok Likes: Instant
  pickTop(
    'TikTok | Лайки',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('tiktok') && t.includes('like') && Number(s.rate) < 0.8;
    },
    (s, cost) => {
      let score = 100 - cost;
      if (s.name.toLowerCase().includes('real')) score += 30;
      return score;
    },
    () => 'TikTok Лайки — Быстрые (Живые аккаунты)',
    'Повышает вовлеченность (ER), стимулируя алгоритм TikTok показывать видео новой аудитории.',
    3.0,
    79.00
  );

  // === 5. SPOTIFY (UNIQUE GLOBAL ADVANTAGE) ===
  // Spotify Plays: Royalty Eligible USA/EU
  pickTop(
    'Spotify | Прослушивания',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return t.includes('spotify') && (t.includes('play') || t.includes('stream')) && (t.includes('royalt') || t.includes('eligible') || t.includes('usa')) && Number(s.rate) < 1.5;
    },
    (s, cost) => {
      let score = 300 - cost;
      if (s.name.toLowerCase().includes('royalt')) score += 150;
      if (s.name.toLowerCase().includes('premium')) score += 80;
      return score;
    },
    () => 'Spotify Прослушивания — Премиум (Royalty Eligible, Монетизируемые)',
    'Засчитываются стриминговой платформой и выплачивают роялти артисту (монетизация).',
    2.5,
    189.00
  );

  // === 6. TWITTER / X ===
  // Twitter Followers: Fast
  pickTop(
    'Twitter (X) | Читатели',
    s => {
      const t = `${s.category} ${s.name}`.toLowerCase();
      return (t.includes('twitter') || t.includes(' x ')) && (t.includes('follower') || t.includes('читател')) && Number(s.rate) < 3.5;
    },
    (s, cost) => {
      let score = 200 - cost;
      if (s.name.toLowerCase().includes('refill') || s.name.toLowerCase().includes('30d')) score += 50;
      return score;
    },
    () => 'Twitter (X) Читатели — Качественные профили (NFT/Web3/Crypto фокус)',
    'Стабильные читатели для крипто и личных аккаунтов X/Twitter с аватарками и постами.',
    2.5,
    290.00
  );

  console.log(`Successfully curated TOP ${selected.length} flagship services from ResellerSMM:\n`);

  console.log(JSON.stringify(selected, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
