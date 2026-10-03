import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Normalized USD conversion rates
const USD_RATES: Record<string, number> = {
  USD: 1.0,
  RUB: 1 / 95.0,
};

function detectPlatform(category: string, name: string): string {
  const text = `${category} ${name}`.toLowerCase();
  if (text.includes('telegram') || text.includes('телеграм') || text.includes(' tg ') || text.includes('[tg]')) return 'Telegram';
  if (text.includes('instagram') || text.includes('инстаграм') || text.includes(' ig ') || text.includes('[ig]')) return 'Instagram';
  if (text.includes('youtube') || text.includes('ютуб') || text.includes(' yt ') || text.includes('[yt]')) return 'YouTube';
  if (text.includes('vk') || text.includes('вконтакте') || text.includes('вк')) return 'VK';
  if (text.includes('tiktok') || text.includes('тикток') || text.includes(' tt ')) return 'TikTok';
  if (text.includes('rutube') || text.includes('рутуб')) return 'Rutube';
  if (text.includes('twitter') || text.includes(' x ') || text.includes('твиттер')) return 'Twitter';
  if (text.includes('facebook') || text.includes('фейсбук')) return 'Facebook';
  if (text.includes('spotify') || text.includes('спотифай')) return 'Spotify';
  return 'Other';
}

function detectActionType(category: string, name: string): string {
  const text = `${category} ${name}`.toLowerCase();
  if (text.includes('subscriber') || text.includes('подписчик') || text.includes('member') || text.includes('follower') || text.includes('участник')) return 'Subscribers/Followers';
  if (text.includes('view') || text.includes('просмотр') || text.includes('story views')) return 'Views';
  if (text.includes('like') || text.includes('лайк')) return 'Likes';
  if (text.includes('reaction') || text.includes('реакци')) return 'Reactions';
  if (text.includes('comment') || text.includes('коммент')) return 'Comments';
  if (text.includes('boost') || text.includes('буст')) return 'Boosts';
  if (text.includes('share') || text.includes('репост') || text.includes('retweet')) return 'Shares';
  if (text.includes('watch hours') || text.includes('часы')) return 'Watch Hours';
  return 'Other';
}

async function main() {
  console.log('=== DEEP ANALYSIS: RESELLERSMM VS EXISTING PROVIDERS ===\n');

  const providers = await prisma.provider.findMany();
  const resellerProvider = providers.find(p => p.name === 'ResellerSMM');
  if (!resellerProvider) {
    console.error('ResellerSMM not found');
    return;
  }

  // Group all services by Platform + ActionType per provider
  const allServices = await prisma.shadowService.findMany({
    select: {
      providerId: true,
      externalId: true,
      name: true,
      category: true,
      rate: true,
      min: true,
      max: true,
    }
  });

  const providerMap = new Map(providers.map(p => [p.id, p]));

  interface ServiceRecord {
    providerName: string;
    currency: string;
    rateUsd: number;
    externalId: string;
    name: string;
    category: string;
    min: number;
    max: number;
    platform: string;
    actionType: string;
  }

  const services: ServiceRecord[] = [];

  for (const s of allServices) {
    const p = providerMap.get(s.providerId);
    if (!p) continue;
    const r = Number(s.rate);
    if (isNaN(r) || r <= 0) continue;
    const rateUsd = p.balanceCurrency === 'USD' ? r : r * (USD_RATES[p.balanceCurrency] || 1/95);
    const platform = detectPlatform(s.category, s.name);
    const actionType = detectActionType(s.category, s.name);

    services.push({
      providerName: p.name,
      currency: p.balanceCurrency || 'USD',
      rateUsd,
      externalId: s.externalId,
      name: s.name,
      category: s.category,
      min: s.min,
      max: s.max,
      platform,
      actionType,
    });
  }

  console.log('1. Distribution of ResellerSMM catalog by Platform:');
  const resellerServices = services.filter(s => s.providerName === 'ResellerSMM');
  const byPlatform: Record<string, number> = {};
  for (const s of resellerServices) {
    byPlatform[s.platform] = (byPlatform[s.platform] || 0) + 1;
  }
  for (const [plt, cnt] of Object.entries(byPlatform).sort((a, b) => b[1] - a[1])) {
    console.log(`   - ${plt.padEnd(12)}: ${cnt} services`);
  }

  console.log('\n2. Price Benchmarking: Minimum and Average Price ($/1k) by Segment:\n');

  const segments = [
    { platform: 'Telegram', actionType: 'Subscribers/Followers' },
    { platform: 'Telegram', actionType: 'Views' },
    { platform: 'Telegram', actionType: 'Reactions' },
    { platform: 'Telegram', actionType: 'Boosts' },
    { platform: 'Instagram', actionType: 'Subscribers/Followers' },
    { platform: 'Instagram', actionType: 'Likes' },
    { platform: 'Instagram', actionType: 'Views' },
    { platform: 'YouTube', actionType: 'Views' },
    { platform: 'YouTube', actionType: 'Subscribers/Followers' },
    { platform: 'TikTok', actionType: 'Subscribers/Followers' },
    { platform: 'TikTok', actionType: 'Views' },
    { platform: 'VK', actionType: 'Subscribers/Followers' },
  ];

  for (const seg of segments) {
    const segServices = services.filter(s => s.platform === seg.platform && s.actionType === seg.actionType);
    if (!segServices.length) continue;

    console.log(`📌 [${seg.platform} -> ${seg.actionType}] (Total ${segServices.length} offers):`);

    // Group by provider
    const provStats: Array<{
      name: string;
      count: number;
      minPriceUsd: number;
      minPriceRub: number;
      cheapestName: string;
      cheapestId: string;
      avgPriceUsd: number;
    }> = [];

    const grouped: Record<string, ServiceRecord[]> = {};
    for (const s of segServices) {
      if (!grouped[s.providerName]) grouped[s.providerName] = [];
      grouped[s.providerName].push(s);
    }

    for (const [pName, list] of Object.entries(grouped)) {
      list.sort((a, b) => a.rateUsd - b.rateUsd);
      const minS = list[0];
      const avg = list.reduce((sum, item) => sum + item.rateUsd, 0) / list.length;
      provStats.push({
        name: pName,
        count: list.length,
        minPriceUsd: minS.rateUsd,
        minPriceRub: minS.rateUsd * 95,
        cheapestName: minS.name,
        cheapestId: minS.externalId,
        avgPriceUsd: avg,
      });
    }

    provStats.sort((a, b) => a.minPriceUsd - b.minPriceUsd);

    for (const st of provStats) {
      const isReseller = st.name === 'ResellerSMM';
      const marker = isReseller ? '👉 ResellerSMM' : `   ${st.name}`;
      console.log(`   ${marker.padEnd(18)} | Min: $${st.minPriceUsd.toFixed(4)} (~${st.minPriceRub.toFixed(2)}₽) | Avg: $${st.avgPriceUsd.toFixed(3)} | Offers: ${st.count}`);
    }

    // Direct comparison: ResellerSMM vs Cheapest in segment
    const cheapestOverall = provStats[0];
    const resellerStat = provStats.find(p => p.name === 'ResellerSMM');
    if (resellerStat && cheapestOverall.name !== 'ResellerSMM') {
      const markup = Math.round(((resellerStat.minPriceUsd / cheapestOverall.minPriceUsd) - 1) * 100);
      console.log(`   💡 Вывод по сегменту: Самый дешёвый первоисточник — ${cheapestOverall.name} ($${cheapestOverall.minPriceUsd.toFixed(4)}). ResellerSMM дороже на +${markup}%.`);
    } else if (resellerStat && cheapestOverall.name === 'ResellerSMM') {
      console.log(`   🏆 Вывод по сегменту: ResellerSMM является САМЫМ ДЕШЕВЫМ поставщиком в этом сегменте! ($${resellerStat.minPriceUsd.toFixed(4)})`);
    }

    console.log('');
  }

  console.log('=== 3. ПОИСК ПРЯМЫХ ПЕРЕКУПОВ (ОДИНАКОВЫЕ ОПИСАНИЯ И МАСКИ УСЛУГ) ===\n');

  // Check matching min, max, and exact rate with markup ratios
  // Many SMM panels resell with exact 20%, 30%, 50%, or 100% markup
  interface PotentialMiddleman {
    platform: string;
    serviceA: { provider: string; name: string; id: string; rateUsd: number; min: number; max: number };
    serviceB: { provider: string; name: string; id: string; rateUsd: number; min: number; max: number };
    ratio: number;
    differenceUsd: number;
  }

  const middlemen: PotentialMiddleman[] = [];

  // Filter for services with unique min/max combos (e.g. min 123, max 77777, or distinct speed)
  for (let i = 0; i < resellerServices.length; i += 5) { // sample to avoid n^2 explosion
    const r = resellerServices[i];
    const rTitle = r.name.toLowerCase().replace(/[^a-z0-9]/g, '');

    for (const other of services) {
      if (other.providerName === 'ResellerSMM') continue;
      if (other.platform !== r.platform) continue;
      if (other.min !== r.min || other.max !== r.max) continue; // exact min/max is strong finger-print

      const oTitle = other.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      // If titles have high character overlap
      if (rTitle.length > 15 && oTitle.length > 15 && (rTitle.includes(oTitle.slice(0, 15)) || oTitle.includes(rTitle.slice(0, 15)))) {
        const ratio = Math.max(r.rateUsd, other.rateUsd) / Math.min(r.rateUsd, other.rateUsd);
        if (ratio >= 1.15 && ratio <= 5.0) {
          middlemen.push({
            platform: r.platform,
            serviceA: r.rateUsd < other.rateUsd ? r : other,
            serviceB: r.rateUsd < other.rateUsd ? other : r,
            ratio,
            differenceUsd: Math.abs(r.rateUsd - other.rateUsd)
          });
        }
      }
    }
  }

  console.log(`Найдено подозрительных совпадений по уникальным лимитам [Min/Max] и сигнатурам: ${middlemen.length}`);
  middlemen.slice(0, 10).forEach((m, idx) => {
    console.log(`[Связка #${idx + 1}] [${m.platform}] Совпадение Min: ${m.serviceA.min}, Max: ${m.serviceA.max}`);
    console.log(`   🥇 Источник: ${m.serviceA.providerName.padEnd(16)} -> $${m.serviceA.rateUsd.toFixed(4)} [ID: ${m.serviceA.externalId}] ("${m.serviceA.name.slice(0, 60)}")`);
    console.log(`   🥈 Перекуп:  ${m.serviceB.providerName.padEnd(16)} -> $${m.serviceB.rateUsd.toFixed(4)} [ID: ${m.serviceB.externalId}] ("${m.serviceB.name.slice(0, 60)}")`);
    console.log(`   📈 Наценка перекупа: +${Math.round((m.ratio - 1) * 100)}% (дельта $${m.differenceUsd.toFixed(4)} / 1k)\n`);
  });
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Audit failed:', err);
    process.exit(1);
  });
