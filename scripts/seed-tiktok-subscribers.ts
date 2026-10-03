import 'dotenv/config';
import { db } from '../src/lib/db';
import { CatalogLockGuard } from '../src/lib/catalog-lock';
import { invalidateL1CatalogCache, invalidateCatalogCache } from '../src/services/catalog/catalog-cache.service';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('Unlocking catalog...');
  await CatalogLockGuard.unlockCatalog('admin@smmplan.pro', 'Seed authentic TikTok subscribers and battle points');

  try {
    const tkSubCat = await db.category.findUnique({
      where: { slug: 'tiktok-subscribers' }
    });

    const tkOtherCat = await db.category.findUnique({
      where: { slug: 'tiktok-other' }
    });

    if (tkSubCat) {
      const realTkSubs = [
        { extId: '2998', name: 'TikTok Подписчики (Плавный старт, гарантия 30 дней) [Эконом]', rate: 192.7, tier: 'ECONOMY' },
        { extId: '2891', name: 'TikTok Реальные подписчики (Минимум списаний, гарантия 30 дней) [Стандарт]', rate: 253.8, tier: 'STANDARD' },
        { extId: '2444', name: 'TikTok Быстрые подписчики (США / Global, гарантия 15 дней) [Премиум]', rate: 393.8, tier: 'PREMIUM' },
        { extId: '1896', name: 'TikTok Подписчики (Живые пользователи РФ и СНГ, вечная гарантия) [Живые]', rate: 1007.5, tier: 'LIVE' },
      ];

      for (const item of realTkSubs) {
        const sh = await db.shadowService.findFirst({
          where: { externalId: item.extId, platform: { in: ['tiktok', 'TikTok'] } }
        });
        if (sh) {
          const existing = await db.service.findFirst({
            where: { externalId: item.extId, categoryId: tkSubCat.id }
          });
          if (!existing) {
            await db.service.create({
              data: {
                name: item.name,
                category: { connect: { id: tkSubCat.id } },
                provider: sh.providerId ? { connect: { id: sh.providerId } } : undefined,
                externalId: sh.externalId,
                rate: sh.rateRub || item.rate,
                costPer1kRub: sh.rateRub || item.rate,
                minQty: sh.min || 10,
                maxQty: sh.max || 100000,
                qualityTier: item.tier,
                customDataType: 'NONE',
                targetType: 'PROFILE',
              }
            });
            console.log(`  + Created authentic TikTok subscriber: ${item.name}`);
          }
        }
      }
    }

    if (tkOtherCat) {
      const sh = await db.shadowService.findFirst({
        where: { externalId: '2144', platform: { in: ['tiktok', 'TikTok'] } }
      });
      if (sh) {
        const existing = await db.service.findFirst({
          where: { externalId: '2144', categoryId: tkOtherCat.id }
        });
        if (!existing) {
          await db.service.create({
            data: {
              name: 'TikTok Баттл-поинты (PK Battle Points для эфиров) [Стандарт]',
              category: { connect: { id: tkOtherCat.id } },
              provider: sh.providerId ? { connect: { id: sh.providerId } } : undefined,
              externalId: sh.externalId,
              rate: sh.rateRub || 38.8,
              costPer1kRub: sh.rateRub || 38.8,
              minQty: sh.min || 10,
              maxQty: sh.max || 100000,
              qualityTier: 'STANDARD',
              customDataType: 'NONE',
              targetType: 'PROFILE',
            }
          });
          console.log(`  + Created authentic TikTok battle points in tiktok-other`);
        }
      }
    }

    // Export CURATED_SERVICES_400.json
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
      targetType: s.targetType,
    }));

    fs.writeFileSync(path.resolve('docs/CURATED_SERVICES_400.json'), JSON.stringify(exportItems, null, 2), 'utf8');
    console.log(`Saved ${exportItems.length} curated services to docs/CURATED_SERVICES_400.json`);

    invalidateL1CatalogCache();
    await invalidateCatalogCache('smmplan');
    await invalidateCatalogCache('smmflux');
  } finally {
    await CatalogLockGuard.lockCatalog('admin@smmplan.pro');
    console.log('Catalog locked successfully.');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
