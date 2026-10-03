import 'dotenv/config';
import { db } from '../src/lib/db';
import { redis } from '../src/lib/redis';
import { encrypt } from '../src/lib/crypto/encryption';
import { CatalogLockGuard } from '../src/lib/catalog-lock';
import fs from 'fs';
import path from 'path';


interface CuratedItem {
  id: string;
  network: string;
  category: string;
  tier: 'Эконом' | 'Стандарт' | 'Премиум';
  name: string;
  providerName: string;
  providerId: string;
  providerServiceId: string;
  costPer1kRub: number;
  recommendedPriceRub: number;
  marginPercent: number;
  minQty: number;
  maxQty: number;
  refill: boolean;
  warrantyDays: number;
  targetType: string;
  serviceType?: string;
  extraParams?: string[];
}

const CANONICAL_NETWORKS = [
  { name: 'Telegram', slug: 'telegram', sort: 1, icon: 'brand:telegram' },
  { name: 'ВКонтакте', slug: 'vk', sort: 2, icon: 'brand:vk' },
  { name: 'Instagram', slug: 'instagram', sort: 3, icon: 'brand:instagram' },
  { name: 'YouTube', slug: 'youtube', sort: 4, icon: 'brand:youtube' },
  { name: 'TikTok', slug: 'tiktok', sort: 5, icon: 'brand:tiktok' },
  { name: 'Twitch & Стримы', slug: 'twitch', sort: 6, icon: 'brand:twitch' },
  { name: 'Rutube', slug: 'rutube', sort: 7, icon: 'brand:rutube' },
  { name: 'Twitter (X)', slug: 'twitter', sort: 8, icon: 'brand:twitter' },
  { name: 'Другие (Facebook, Discord, Kick)', slug: 'other', sort: 9, icon: 'brand:other' },
];

const CANONICAL_PROVIDERS = [
  {
    name: 'VexBoost',
    url: 'https://vexboost.ru/api/v2',
    key: process.env.VEXBOOST_API_KEY || 'NrgY6iwm34j6JwDVwdSqGpCLQ7DzPpdWWP3UQzfRTNhuW42UkvoOZ6GsDCfD',
    currency: 'RUB',
  },
  {
    name: 'Soc-Rocket',
    url: 'https://soc-rocket.ru/api/v2',
    key: process.env.SOC_ROCKET_API_KEY || 'a4rhzjHA6oirPXVDVYth5ENDgERTgoOi',
    currency: 'RUB',
  },
  {
    name: 'SMMPrime',
    url: 'https://smmprime.com/api/v2',
    key: process.env.SMMPRIME_API_KEY || 'fdca04c435054be29eb5b487dbd336b7',
    currency: 'USD',
  },
  {
    name: 'Stream-Promotion',
    url: 'https://stream-promotion.ru/api/v2',
    key: process.env.STREAM_PROMOTION_API_KEY || 'pB7LK6auFhmsuntExn9gYvgo5myeDmS4',
    currency: 'RUB',
  },
  {
    name: 'SMMPanelUS',
    url: 'https://smmpanelus.com/api/v2',
    key: process.env.SMMPANELUS_API_KEY || '62c587ccc0b54a28f35d3840b93c72b8',
    currency: 'USD',
  },
  {
    name: 'ProSMM-Shop',
    url: 'https://prosmm-shop.com/api/v2',
    key: process.env.PROSMM_SHOP_API_KEY || '4ecef90f16dea697ef32404efe293ba1',
    currency: 'RUB',
  },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 45)
    .replace(/^-|-$/g, '');
}

function cleanCategory(raw: string, net: string): string {
  let s = raw
    .replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\uFE0E\uFE0F\u2700-\u27BF\uE000-\uF8FF\s]+/gu, '')
    .replace(/\s*\[(?:Сервер|Server|Srv|API|Провайдер)[\s:]*\d+\]/gi, '')
    .replace(/\s*\((?:vexboost live|vexboost|api\s*\d+|srv\s*\d+|сервер\s*\d+)\)/gi, '')
    .replace(/\bvexboost live\b/gi, 'Онлайн-просмотры')
    .replace(/\bvexboost\b/gi, '')
    .replace(/\s*♻️/gu, '')
    .replace(/\s*\|?\s*[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\uFE0E\uFE0F]*\s*(?:С гарантией|Без гарантии)/gui, '')
    .replace(/\s*\|\s*$/g, '')
    .trim();

  // Strip prefixes
  const prefixRegex = /^(?:Telegram\s+Premium|Telegram|ВКонтакте|Вконтакте|VK|YouTube|Youtube|TikTok|Tiktok|Instagram|Insta|Rutube|RuTube|Twitch|Facebook|Twitter|Twitter\s*\|\s*X\.com|Discord|Kick|X\.com)\s*(?:—|–|-|>|:|\/|\s)\s*/i;
  s = s.replace(prefixRegex, '').trim();

  s = s.replace(/^[—–\-:>\/\s]+/g, '').replace(/\s{2,}/g, ' ').trim();
  if (!s) return raw.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function main() {
  const isForce = process.argv.includes('--force-dangerously-wipe-and-reseed');
  const isLocked = await CatalogLockGuard.isLocked();
  const existingCatCount = await db.category.count();
  const existingSrvCount = await db.service.count();

  // 1. Inviolable Lock check: Even with --force, cannot wipe a LOCKED catalog without first explicitly unlocking
  if (isLocked) {
    console.error('\n⛔ [INVIOLABLE DATABASE GUARD] Production catalog seeding is BLOCKED.');
    console.error(`   Status: Catalog is LOCKED. Database contains ${existingCatCount} categories and ${existingSrvCount} services.`);
    console.error('   To protect configured categories and custom tariffs from being overwritten, automated seeding is prohibited.');
    console.error('   Even with --force-dangerously-wipe-and-reseed, you must FIRST explicitly unlock the catalog via:');
    console.error('   npx tsx scripts/lock-database.ts unlock "Reason for reseeding"');
    console.error('   Administrators (ADMIN and OWNER) have full control to manage categories and services directly via the Admin Panel.\n');
    process.exit(1);
  }

  // 2. Preservation check: If unlocked but data exists, require explicit --force flag
  if (!isForce) {
    if (existingCatCount > 0 || existingSrvCount > 0) {
      console.error('\n🛡️ [DATABASE PRESERVATION] Database is already configured with categories and services.');
      console.error(`   Found ${existingCatCount} categories and ${existingSrvCount} services. Aborting to protect existing catalog.`);
      console.error('   If you are 100% sure you want to completely wipe and reseed, specify --force-dangerously-wipe-and-reseed.\n');
      process.exit(1);
    }
  }

  console.log('🚀 [PRODUCTION CATALOG SEEDER] Starting clean production catalog population...\n');


  // 1. Clean synthetic benchmark data
  console.log('🧹 [1/6] Cleaning synthetic benchmark networks and test services...');
  const testNetworks = await db.network.findMany({
    where: {
      OR: [
        { name: { contains: 'Test', mode: 'insensitive' } },
        { slug: { contains: 'test', mode: 'insensitive' } }
      ]
    },
    include: {
      categories: {
        include: {
          services: true
        }
      }
    }
  });

  for (const net of testNetworks) {
    for (const cat of net.categories) {
      for (const srv of cat.services) {
        // Delete related orders and routes for test services
        await db.order.deleteMany({ where: { serviceId: srv.id } });
        await db.serviceRoute.deleteMany({ where: { serviceId: srv.id } });
        await db.servicePriceHistory.deleteMany({ where: { serviceId: srv.id } });
        await db.serviceSmartConfig.deleteMany({ where: { serviceId: srv.id } });
        await db.service.delete({ where: { id: srv.id } });
      }
      await db.category.delete({ where: { id: cat.id } });
    }
    await db.network.delete({ where: { id: net.id } });
    console.log(`  🗑️ Removed test network: ${net.name} (${net.slug})`);
  }

  // 2. Ensure Tenants exist
  console.log('🏢 [2/6] Verifying tenants (smmplan, flux)...');
  await db.tenant.upsert({
    where: { id: 'smmplan' },
    update: { slug: 'smmplan', name: 'SMMplan', domain: 'smmplan.pro', isActive: true },
    create: {
      id: 'smmplan',
      name: 'SMMplan',
      slug: 'smmplan',
      domain: 'smmplan.pro',
      isActive: true
    }
  });
  await db.tenant.upsert({
    where: { id: 'flux' },
    update: { slug: 'flux', name: 'SMMflux', domain: 'smmflux.ru', isActive: true },
    create: {
      id: 'flux',
      name: 'SMMflux',
      slug: 'flux',
      domain: 'smmflux.ru',
      isActive: true
    }
  });
  console.log('  ✅ Tenants verified: SMMplan & SMMflux');

  // 3. Ensure Canonical Networks exist
  console.log('🌐 [3/6] Upserting canonical social networks...');
  const networkMap = new Map<string, string>(); // slug -> id
  for (const n of CANONICAL_NETWORKS) {
    const netRecord = await db.network.upsert({
      where: { slug: n.slug },
      update: { name: n.name, sort: n.sort, icon: n.icon, isActive: true },
      create: { name: n.name, slug: n.slug, sort: n.sort, icon: n.icon, isActive: true }
    });
    networkMap.set(n.slug, netRecord.id);
    networkMap.set(n.name.toLowerCase(), netRecord.id);
  }
  console.log(`  ✅ Canonical networks ready: ${CANONICAL_NETWORKS.length} networks`);

  // 4. Initialize Providers
  console.log('📡 [4/6] Initializing wholesale API providers with AES-256-GCM encryption...');
  const providerDbMap = new Map<string, string>(); // normalized name -> id
  for (const prov of CANONICAL_PROVIDERS) {
    const encKey = encrypt(prov.key);
    const existing = await db.provider.findFirst({
      where: {
        OR: [
          { name: { equals: prov.name, mode: 'insensitive' } },
          { apiUrl: { equals: prov.url, mode: 'insensitive' } }
        ]
      }
    });

    let provId: string;
    if (existing) {
      const updated = await db.provider.update({
        where: { id: existing.id },
        data: {
          name: prov.name,
          apiUrl: prov.url,
          apiKey: encKey,
          balanceCurrency: prov.currency,
          isActive: true
        }
      });
      provId = updated.id;
    } else {
      const created = await db.provider.create({
        data: {
          name: prov.name,
          apiUrl: prov.url,
          apiKey: encKey,
          balanceCurrency: prov.currency,
          isActive: true
        }
      });
      provId = created.id;
    }

    providerDbMap.set(prov.name.toLowerCase().replace(/[^a-z0-9]/g, ''), provId);
    providerDbMap.set(prov.name.toLowerCase(), provId);
  }
  console.log(`  ✅ Providers initialized: ${CANONICAL_PROVIDERS.length} providers`);

  // 5. Load and process CURATED_SERVICES_400.json
  console.log('📦 [5/6] Importing 400 curated services into shared catalog (tenantId = "all")...');
  const catalogPath = path.resolve('docs/CURATED_SERVICES_400.json');
  const items: CuratedItem[] = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

  function findNetworkId(netName: string): string {
    const lower = netName.toLowerCase();
    if (lower.includes('telegram')) return networkMap.get('telegram')!;
    if (lower.includes('вконтакте') || lower.includes('vk')) return networkMap.get('vk')!;
    if (lower.includes('youtube')) return networkMap.get('youtube')!;
    if (lower.includes('instagram')) return networkMap.get('instagram')!;
    if (lower.includes('tiktok')) return networkMap.get('tiktok')!;
    if (lower.includes('twitch') || lower.includes('стрим')) return networkMap.get('twitch')!;
    if (lower.includes('rutube')) return networkMap.get('rutube')!;
    if (lower.includes('twitter') || lower.includes('x')) return networkMap.get('twitter')!;
    return networkMap.get('other')!;
  }

  function findProviderId(provName: string): string | null {
    const norm = provName.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [k, v] of providerDbMap.entries()) {
      if (norm.includes(k) || k.includes(norm)) return v;
    }
    // Fallback to first provider
    return providerDbMap.values().next().value || null;
  }

  // Group items by category to create clean categories
  const categoriesMap = new Map<string, string>(); // (networkId + cleanCatName) -> categoryId

  let servicesCreated = 0;
  let servicesUpdated = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const networkId = findNetworkId(it.network);
    const cleanCatName = cleanCategory(it.category, it.network);
    const catKey = `${networkId}:::${cleanCatName}`;

    let categoryId = categoriesMap.get(catKey);
    if (!categoryId) {
      // Find or create Category
      const catSlug = `cat-${it.id.split('-')[0] || 'all'}-${slugify(cleanCatName)}`.slice(0, 48);
      const existingCat = await db.category.findFirst({
        where: {
          networkId,
          name: cleanCatName
        }
      });

      function getCategorySort(name: string): number {
        const n = name.toLowerCase();
        if (n === 'подписчики' || n.startsWith('подписчики (')) return 10;
        if (n.includes('премиум') || n.includes('со звездой')) return 15;
        if (n.includes('просмотр')) return 20;
        if (n.includes('реакц') || n.includes('лайк')) return 30;
        if (n.includes('буст')) return 40;
        if (n.includes('репост')) return 50;
        if (n.includes('опрос') || n.includes('голос')) return 60;
        if (n.includes('коммент')) return 70;
        if (n.includes('прослуш')) return 80;
        if (n.includes('авто')) return 90;
        if (n.includes('стрим') || n.includes('зрител')) return 100;
        if (n.includes('бот')) return 110;
        if (n.includes('звезд')) return 120;
        return 999;
      }

      const catSort = getCategorySort(cleanCatName);

      if (existingCat) {
        categoryId = existingCat.id;
        await db.category.update({
          where: { id: existingCat.id },
          data: { tenantId: 'all', requireWarning: false, sort: catSort }
        });
      } else {
        // Ensure slug unique
        let finalSlug = catSlug;
        const slugExists = await db.category.findFirst({ where: { slug: finalSlug } });
        if (slugExists) finalSlug = `${catSlug}-${Math.random().toString(36).slice(2, 6)}`;

        const newCat = await db.category.create({
          data: {
            name: cleanCatName,
            slug: finalSlug,
            networkId,
            tenantId: 'all',
            requireWarning: false,
            sort: catSort
          }
        });
        categoryId = newCat.id;
      }
      categoriesMap.set(catKey, categoryId);
    }

    // Resolve Provider
    const provId = findProviderId(it.providerName);

    // Map quality tier
    const tierMap: Record<string, string> = {
      'Эконом': 'ECONOMY',
      'Стандарт': 'STANDARD',
      'Премиум': 'PREMIUM'
    };
    const qualityTier = tierMap[it.tier] || 'STANDARD';

    // Pricing
    const priceCents = Math.round(it.recommendedPriceRub * 100);
    const markupMult = it.costPer1kRub > 0 ? Number((it.recommendedPriceRub / it.costPer1kRub).toFixed(2)) : 2.5;

    // Service Type & Custom Inputs
    let customDataType = 'NONE';
    let customDataLabel: string | null = null;
    if (it.serviceType === 'Custom Comments') {
      customDataType = 'TEXTAREA';
      customDataLabel = 'Введите комментарии (каждый с новой строки)';
    } else if (it.serviceType === 'Poll') {
      customDataType = 'NUMBER';
      customDataLabel = 'Номер варианта ответа (например: 1)';
    }

    const srvSlug = `srv-${it.id}-${slugify(it.name)}`.slice(0, 50);

    // Check existing service by provider + externalId or slug
    const existingSrv = await db.service.findFirst({
      where: {
        OR: [
          { slug: srvSlug },
          provId && it.providerServiceId ? { providerId: provId, externalId: String(it.providerServiceId) } : { slug: srvSlug }
        ]
      }
    });

    let serviceRecordId: string;
    if (existingSrv) {
      await db.service.update({
        where: { id: existingSrv.id },
        data: {
          name: it.name,
          categoryId,
          providerId: provId,
          externalId: String(it.providerServiceId),
          rate: it.costPer1kRub,
          costPer1kRub: it.costPer1kRub,
          pricePer1000Cents: priceCents,
          markup: markupMult,
          minQty: it.minQty,
          maxQty: it.maxQty,
          qualityTier,
          targetType: it.targetType || 'POST',
          customDataType,
          customDataLabel,
          isRefillEnabled: it.refill,
          tenantId: 'all',
          isActive: true,
          isQuarantined: false
        }
      });
      serviceRecordId = existingSrv.id;
      servicesUpdated++;
    } else {
      let finalSrvSlug = srvSlug;
      const srvSlugExists = await db.service.findFirst({ where: { slug: finalSrvSlug } });
      if (srvSlugExists) finalSrvSlug = `${srvSlug}-${Math.random().toString(36).slice(2, 6)}`;

      const newSrv = await db.service.create({
        data: {
          name: it.name,
          slug: finalSrvSlug,
          categoryId,
          providerId: provId,
          externalId: String(it.providerServiceId),
          rate: it.costPer1kRub,
          costPer1kRub: it.costPer1kRub,
          pricePer1000Cents: priceCents,
          markup: markupMult,
          minQty: it.minQty,
          maxQty: it.maxQty,
          qualityTier,
          targetType: it.targetType || 'POST',
          customDataType,
          customDataLabel,
          isRefillEnabled: it.refill,
          tenantId: 'all',
          isActive: true,
          isQuarantined: false
        }
      });
      serviceRecordId = newSrv.id;
      servicesCreated++;
    }

    // Upsert ServiceRoute
    if (provId) {
      const existingRoute = await db.serviceRoute.findFirst({
        where: { serviceId: serviceRecordId }
      });
      if (existingRoute) {
        await db.serviceRoute.update({
          where: { id: existingRoute.id },
          data: {
            providerId: provId,
            providerServiceId: String(it.providerServiceId),
            isActive: true
          }
        });
      } else {
        await db.serviceRoute.create({
          data: {
            serviceId: serviceRecordId,
            providerId: provId,
            providerServiceId: String(it.providerServiceId),
            priority: 1,
            isActive: true
          }
        });
      }
    }
  }

  console.log(`  ✅ Services: ${servicesCreated} created, ${servicesUpdated} updated (Total 400 processed)`);
  console.log(`  ✅ Distinct Categories created: ${categoriesMap.size}`);

  // 6. Redis Cache invalidation & warm up
  console.log('⚡ [6/6] Invalidating and warming up Redis Catalog Cache...');
  try {
    const keys = await redis.keys('*catalog*');
    const serviceKeys = await redis.keys('*services*');
    const catKeys = await redis.keys('*categories*');
    const allKeys = [...keys, ...serviceKeys, ...catKeys];
    if (allKeys.length > 0) {
      await redis.del(...allKeys);
      console.log(`  🧹 Purged ${allKeys.length} stale Redis cache keys`);
    } else {
      console.log(`  ℹ️ No stale Redis cache keys found`);
    }
  } catch (err: any) {
    console.warn(`  ⚠️ Redis purge warning: ${err.message}`);
  }

  console.log('\n🎉 [COMPLETE] Production Catalog 400 successfully seeded and verified!');
}

main()
  .catch((err) => {
    console.error('❌ [FATAL] Seeding failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    await redis.quit();
  });
