import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

interface CleanedService {
  id: string;
  providerId: string;
  providerName: string;
  externalId: string;
  name: string;
  category: string;
  rate: number;
  currency: string;
  rateUsd: number;
  min: number;
  max: number;
  platform: string;
  normalizedKey: string;
}

// Normalized USD conversion rates
const USD_RATES: Record<string, number> = {
  USD: 1.0,
  RUB: 1 / 95.0, // approximate 95 RUB per USD
};

function detectPlatform(category: string, name: string): string {
  const text = `${category} ${name}`.toLowerCase();
  if (text.includes('telegram') || text.includes('телеграм') || text.includes(' tg ') || text.includes('[tg]')) return 'Telegram';
  if (text.includes('instagram') || text.includes('инстаграм') || text.includes(' ig ') || text.includes('[ig]')) return 'Instagram';
  if (text.includes('youtube') || text.includes('ютуб') || text.includes(' yt ') || text.includes('[yt]')) return 'YouTube';
  if (text.includes('vk') || text.includes('вконтакте') || text.includes('вк')) return 'VK';
  if (text.includes('tiktok') || text.includes('тикток') || text.includes(' tt ')) return 'TikTok';
  if (text.includes('rutube') || text.includes('рутуб')) return 'Rutube';
  if (text.includes('twitter') || text.includes(' x.com ') || text.includes(' твиттер')) return 'Twitter';
  if (text.includes('facebook') || text.includes('фейсбук')) return 'Facebook';
  if (text.includes('twitch') || text.includes('твич')) return 'Twitch';
  return 'Other';
}

function cleanTitle(title: string): string {
  return title
    .replace(/[🟢🔵🔴⚡🔥💎👑⭐✨🚀➜➔▶️]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractKeyFeatures(name: string, category: string): string {
  const clean = cleanTitle(`${category} ${name}`);
  // Extract key tokens like lifetime, 30d, real, bot, no drop, speed etc.
  const tokens: string[] = [];
  if (clean.includes('no drop') || clean.includes('без списаний') || clean.includes('non drop')) tokens.push('nodrop');
  if (clean.includes('lifetime') || clean.includes('вечная') || clean.includes('вечный')) tokens.push('lifetime');
  if (clean.includes('30d') || clean.includes('30 day') || clean.includes('30 дней')) tokens.push('30d');
  if (clean.includes('real') || clean.includes('живые') || clean.includes('hq')) tokens.push('real');
  if (clean.includes('bot') || clean.includes('боты')) tokens.push('bot');
  if (clean.includes('ru') || clean.includes('россия') || clean.includes('русские')) tokens.push('ru');
  if (clean.includes('cis') || clean.includes('снг')) tokens.push('cis');
  if (clean.includes('female') || clean.includes('женск')) tokens.push('female');
  if (clean.includes('male') || clean.includes('мужск')) tokens.push('male');
  return tokens.sort().join('_');
}

async function main() {
  console.log('=== OMNISMM PROVIDER CATALOG COMPARISON & RESELLER AUDIT ===\n');

  const providers = await prisma.provider.findMany({
    select: { id: true, name: true, apiUrl: true, balanceCurrency: true, isActive: true }
  });

  const providerMap = new Map<string, { name: string; currency: string }>();
  for (const p of providers) {
    providerMap.set(p.id, { name: p.name, currency: p.balanceCurrency || 'USD' });
  }

  console.log('1. Active Providers in System:');
  for (const p of providers) {
    const count = await prisma.shadowService.count({ where: { providerId: p.id } });
    console.log(`   - ${p.name.padEnd(18)} | ID: ${p.id} | Services: ${String(count).padStart(5)} | Currency: ${p.balanceCurrency}`);
  }

  console.log('\n2. Loading all shadow services into memory for deep cross-comparison...');
  const allShadow = await prisma.shadowService.findMany({
    select: {
      id: true,
      providerId: true,
      externalId: true,
      name: true,
      category: true,
      rate: true,
      min: true,
      max: true,
    }
  });

  console.log(`   Total shadow services loaded: ${allShadow.length}`);

  const cleanedServices: CleanedService[] = [];

  for (const s of allShadow) {
    const pInfo = providerMap.get(s.providerId);
    if (!pInfo) continue;

    const rateNum = Number(s.rate);
    if (isNaN(rateNum) || rateNum <= 0) continue;

    const rateUsd = pInfo.currency === 'USD' ? rateNum : rateNum * (USD_RATES[pInfo.currency] || (1 / 95.0));
    const platform = detectPlatform(s.category, s.name);
    const cleaned = cleanTitle(s.name);
    const features = extractKeyFeatures(s.name, s.category);

    cleanedServices.push({
      id: s.id,
      providerId: s.providerId,
      providerName: pInfo.name,
      externalId: s.externalId,
      name: s.name,
      category: s.category,
      rate: rateNum,
      currency: pInfo.currency,
      rateUsd,
      min: s.min,
      max: s.max,
      platform,
      normalizedKey: `${platform}|${cleaned.slice(0, 40)}|${s.min}-${s.max}|${features}`
    });
  }

  console.log('\n3. Analyzing Service Name and Signature Overlaps across Providers...');

  // Group services by cleaned name signature
  const signatureMap = new Map<string, CleanedService[]>();

  for (const s of cleanedServices) {
    // Also test exact name match (normalized)
    const exactNameKey = `${s.platform}|${cleanTitle(s.name)}`;
    if (!signatureMap.has(exactNameKey)) {
      signatureMap.set(exactNameKey, []);
    }
    signatureMap.get(exactNameKey)!.push(s);
  }

  // Find exact duplicates across DIFFERENT providers
  const crossProviderExactMatches: Array<{
    title: string;
    platform: string;
    services: CleanedService[];
  }> = [];

  for (const [key, list] of signatureMap.entries()) {
    const distinctProviders = new Set(list.map(x => x.providerName));
    if (distinctProviders.size >= 2) {
      crossProviderExactMatches.push({
        title: key,
        platform: list[0].platform,
        services: list
      });
    }
  }

  console.log(`   Found ${crossProviderExactMatches.length} services with EXACT MATCHING names across 2+ providers!`);

  console.log('\n=== TOP IDENTIFIED RESELLING CHAINS (SAME SERVICE, BIG PRICE MARKUP) ===\n');

  interface ResellingCase {
    platform: string;
    title: string;
    cheapest: { provider: string; rate: number; currency: string; rateUsd: number; id: string };
    expensive: { provider: string; rate: number; currency: string; rateUsd: number; id: string };
    ratio: number;
    differenceUsd: number;
  }

  const resellingCases: ResellingCase[] = [];

  for (const match of crossProviderExactMatches) {
    // Sort by rateUsd ascending
    const sorted = [...match.services].sort((a, b) => a.rateUsd - b.rateUsd);
    const cheapest = sorted[0];
    const mostExpensive = sorted[sorted.length - 1];

    if (mostExpensive.providerName !== cheapest.providerName && cheapest.rateUsd > 0.001) {
      const ratio = mostExpensive.rateUsd / cheapest.rateUsd;
      if (ratio >= 1.25) { // At least 25% markup
        resellingCases.push({
          platform: match.platform,
          title: cheapest.name,
          cheapest: {
            provider: cheapest.providerName,
            rate: cheapest.rate,
            currency: cheapest.currency,
            rateUsd: cheapest.rateUsd,
            id: cheapest.externalId
          },
          expensive: {
            provider: mostExpensive.providerName,
            rate: mostExpensive.rate,
            currency: mostExpensive.currency,
            rateUsd: mostExpensive.rateUsd,
            id: mostExpensive.externalId
          },
          ratio,
          differenceUsd: mostExpensive.rateUsd - cheapest.rateUsd
        });
      }
    }
  }

  // Sort by ratio descending
  resellingCases.sort((a, b) => b.ratio - a.ratio);

  console.log(`Identified ${resellingCases.length} blatant reselling cases (>= 25% markup on identical titles):\n`);

  const topCases = resellingCases.slice(0, 15);
  topCases.forEach((c, idx) => {
    console.log(`[Case #${idx + 1}] Platform: [${c.platform}] | Markup: +${Math.round((c.ratio - 1) * 100)}% (${c.ratio.toFixed(2)}x)`);
    console.log(`   Service: "${c.title}"`);
    console.log(`   🥇 Source/Cheapest: ${c.cheapest.provider.padEnd(14)} -> $${c.cheapest.rateUsd.toFixed(4)} USD (${c.cheapest.rate} ${c.cheapest.currency}) [ID: ${c.cheapest.id}]`);
    console.log(`   🥈 Reseller/Costly: ${c.expensive.provider.padEnd(14)} -> $${c.expensive.rateUsd.toFixed(4)} USD (${c.expensive.rate} ${c.expensive.currency}) [ID: ${c.expensive.id}]`);
    console.log(`   💵 Direct Savings: $${c.differenceUsd.toFixed(4)} USD per 1,000 units\n`);
  });

  // Calculate Provider Ranking: Who is most often the direct source vs reseller?
  console.log('=== OVERALL PROVIDER ROLES & PRICING STATS ===\n');

  const statsByProvider: Record<string, {
    cheapestCount: number;
    expensiveCount: number;
    totalCrossMatches: number;
    avgMarkupAsReseller: number[];
  }> = {};

  for (const p of providers) {
    statsByProvider[p.name] = { cheapestCount: 0, expensiveCount: 0, totalCrossMatches: 0, avgMarkupAsReseller: [] };
  }

  for (const c of resellingCases) {
    if (statsByProvider[c.cheapest.provider]) {
      statsByProvider[c.cheapest.provider].cheapestCount++;
      statsByProvider[c.cheapest.provider].totalCrossMatches++;
    }
    if (statsByProvider[c.expensive.provider]) {
      statsByProvider[c.expensive.provider].expensiveCount++;
      statsByProvider[c.expensive.provider].totalCrossMatches++;
      statsByProvider[c.expensive.provider].avgMarkupAsReseller.push(c.ratio);
    }
  }

  for (const [name, stats] of Object.entries(statsByProvider)) {
    const avgMarkup = stats.avgMarkupAsReseller.length > 0 
      ? `+${Math.round((stats.avgMarkupAsReseller.reduce((a, b) => a + b, 0) / stats.avgMarkupAsReseller.length - 1) * 100)}%` 
      : 'N/A (Never marked up)';
    console.log(`Provider: ${name.padEnd(18)} | Direct Source (Cheapest): ${String(stats.cheapestCount).padStart(3)} times | Marked Up (Reseller): ${String(stats.expensiveCount).padStart(3)} times | Avg Resale Markup: ${avgMarkup}`);
  }

  console.log('\n=== SPECIFIC COMPARISON FOR NEW PROVIDER: ResellerSMM ===\n');
  const resellerSmmCases = resellingCases.filter(c => c.cheapest.provider === 'ResellerSMM' || c.expensive.provider === 'ResellerSMM');
  console.log(`Total overlaps involving ResellerSMM: ${resellerSmmCases.length}`);
  const resellerIsCheaper = resellerSmmCases.filter(c => c.cheapest.provider === 'ResellerSMM');
  const resellerIsExpensive = resellerSmmCases.filter(c => c.expensive.provider === 'ResellerSMM');

  console.log(`- ResellerSMM is the CHEAPEST (Direct Source): ${resellerIsCheaper.length} times`);
  console.log(`- ResellerSMM is MORE EXPENSIVE (Reseller): ${resellerIsExpensive.length} times`);

  if (resellerIsCheaper.length > 0) {
    console.log('\nTop 5 Services where ResellerSMM offers HUGE SAVINGS over existing providers:');
    resellerIsCheaper.slice(0, 5).forEach((c, i) => {
      console.log(`  ${i+1}. [${c.platform}] ${c.title}`);
      console.log(`     ResellerSMM: $${c.cheapest.rateUsd.toFixed(4)} USD vs ${c.expensive.provider}: $${c.expensive.rateUsd.toFixed(4)} USD (+${Math.round((c.ratio - 1) * 100)}% markup at competitor)`);
    });
  }

  if (resellerIsExpensive.length > 0) {
    console.log('\nTop 5 Services where ResellerSMM is RESELLING from other providers with markup:');
    resellerIsExpensive.slice(0, 5).forEach((c, i) => {
      console.log(`  ${i+1}. [${c.platform}] ${c.title}`);
      console.log(`     ResellerSMM: $${c.expensive.rateUsd.toFixed(4)} USD vs Source (${c.cheapest.provider}): $${c.cheapest.rateUsd.toFixed(4)} USD (ResellerSMM markup: +${Math.round((c.ratio - 1) * 100)}%)`);
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Comparison error:', err);
    process.exit(1);
  });
