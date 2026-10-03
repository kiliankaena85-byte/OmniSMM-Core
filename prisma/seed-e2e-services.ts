/**
 * seed-e2e-services.ts
 * Аддитивный seed для E2E-тестирования формы заказа.
 * Создаёт минимальный набор услуг для 4 платформ (Telegram, Instagram, YouTube, VK)
 * с реалистичными targetType, ценами и минимальными количествами.
 * НЕ УДАЛЯЕТ существующие данные.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function inferTargetType(categoryName: string): string {
  const lower = categoryName.toLowerCase();
  if (['подписчик', 'участник', 'буст', 'группы', 'автопросмотр'].some(k => lower.includes(k))) return 'CHANNEL';
  if (['стори', 'story', 'истори'].some(k => lower.includes(k))) return 'STORY';
  if (['звёзд', 'звезд', 'star'].some(k => lower.includes(k))) return 'CUSTOM';
  return 'POST';
}

const SEED_DATA = [
  {
    network: { name: 'Telegram', slug: 'telegram' },
    categories: [
      {
        name: 'Подписчики Telegram',
        services: [
          { tier: 'Эконом',   rate: 0.05, min: 100,  max: 50000  },
          { tier: 'Стандарт', rate: 0.10, min: 100,  max: 100000 },
          { tier: 'Премиум',  rate: 0.30, min: 50,   max: 20000  },
        ],
      },
      {
        name: 'Просмотры постов Telegram',
        services: [
          { tier: 'Эконом',   rate: 0.015, min: 500,  max: 1000000 },
          { tier: 'Стандарт', rate: 0.025, min: 200,  max: 500000  },
        ],
      },
      {
        name: 'Реакции Telegram',
        services: [
          { tier: 'Стандарт', rate: 0.08, min: 20,  max: 10000 },
          { tier: 'Премиум',  rate: 0.20, min: 10,  max: 5000  },
        ],
      },
      {
        name: 'Бусты Telegram',
        services: [
          { tier: 'Стандарт', rate: 1.50, min: 1,   max: 100   },
          { tier: 'Премиум',  rate: 3.00, min: 1,   max: 50    },
        ],
      },
    ],
  },
  {
    network: { name: 'Instagram', slug: 'instagram' },
    categories: [
      {
        name: 'Подписчики Instagram',
        services: [
          { tier: 'Эконом',   rate: 0.04, min: 100, max: 500000 },
          { tier: 'Стандарт', rate: 0.08, min: 100, max: 200000 },
          { tier: 'Премиум',  rate: 0.25, min: 50,  max: 50000  },
        ],
      },
      {
        name: 'Лайки Instagram',
        services: [
          { tier: 'Эконом',   rate: 0.02, min: 50,  max: 100000 },
          { tier: 'Стандарт', rate: 0.04, min: 50,  max: 50000  },
        ],
      },
      {
        name: 'Просмотры Reels Instagram',
        services: [
          { tier: 'Эконом',   rate: 0.008, min: 1000, max: 10000000 },
          { tier: 'Стандарт', rate: 0.015, min: 500,  max: 5000000  },
        ],
      },
    ],
  },
  {
    network: { name: 'YouTube', slug: 'youtube' },
    categories: [
      {
        name: 'Подписчики YouTube',
        services: [
          { tier: 'Стандарт', rate: 0.15, min: 50,  max: 10000 },
          { tier: 'Премиум',  rate: 0.50, min: 10,  max: 5000  },
        ],
      },
      {
        name: 'Просмотры YouTube',
        services: [
          { tier: 'Эконом',   rate: 0.006, min: 500,  max: 10000000 },
          { tier: 'Стандарт', rate: 0.015, min: 100,  max: 5000000  },
          { tier: 'Премиум',  rate: 0.060, min: 100,  max: 1000000  },
        ],
      },
      {
        name: 'Лайки YouTube',
        services: [
          { tier: 'Эконом',   rate: 0.03, min: 50, max: 100000 },
          { tier: 'Стандарт', rate: 0.07, min: 20, max: 50000  },
        ],
      },
    ],
  },
  {
    network: { name: 'VKontakte', slug: 'vk' },
    categories: [
      {
        name: 'Подписчики VK',
        services: [
          { tier: 'Эконом',   rate: 0.03, min: 100, max: 200000 },
          { tier: 'Стандарт', rate: 0.06, min: 100, max: 100000 },
        ],
      },
      {
        name: 'Лайки VK',
        services: [
          { tier: 'Эконом',   rate: 0.015, min: 50, max: 50000 },
          { tier: 'Стандарт', rate: 0.030, min: 20, max: 20000 },
        ],
      },
    ],
  },
  {
    network: { name: 'TikTok', slug: 'tiktok' },
    categories: [
      {
        name: 'Подписчики TikTok',
        services: [
          { tier: 'Эконом',   rate: 0.06, min: 100, max: 300000 },
          { tier: 'Стандарт', rate: 0.12, min: 100, max: 100000 },
          { tier: 'Премиум',  rate: 0.35, min: 50,  max: 30000  },
        ],
      },
      {
        name: 'Просмотры TikTok',
        services: [
          { tier: 'Эконом',   rate: 0.003, min: 1000, max: 100000000 },
          { tier: 'Стандарт', rate: 0.008, min: 500,  max: 50000000  },
        ],
      },
      {
        name: 'Лайки TikTok',
        services: [
          { tier: 'Стандарт', rate: 0.025, min: 100, max: 100000 },
          { tier: 'Премиум',  rate: 0.070, min: 50,  max: 20000  },
        ],
      },
    ],
  },
];

async function main() {
  const { CatalogLockGuard } = await import('../src/lib/catalog-lock');
  const isLocked = await CatalogLockGuard.isLocked().catch(() => true);
  if (isLocked) {
    console.log('🛡️ [Catalog Preserved] Catalog is LOCKED and INVIOLABLE. Skipping seed-e2e-services.');
    return;
  }

  console.log('\n🌱 E2E Service Seeder — аддитивный режим (данные не удаляются)\n');

  // Найти или создать провайдера
  let provider = await prisma.provider.findFirst({ where: { name: 'E2E Test Provider' } });
  if (!provider) {
    provider = await prisma.provider.create({
      data: {
        name: 'E2E Test Provider',
        apiUrl: 'https://mock-provider.e2e/api/v2',
        apiKey: 'e2e_mock_key_12345',
        isActive: true,
      },
    });
    console.log(`✅ Создан провайдер: ${provider.name}`);
  } else {
    console.log(`⚡ Провайдер уже есть: ${provider.name}`);
  }

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const netData of SEED_DATA) {
    // Upsert Network
    let network = await prisma.network.findFirst({ where: { slug: netData.network.slug } });
    if (!network) {
      network = await prisma.network.create({
        data: { name: netData.network.name, slug: netData.network.slug, isActive: true, sort: SEED_DATA.indexOf(netData) },
      });
      console.log(`\n📡 Создана сеть: ${network.name}`);
    } else {
      // Активируем если была выключена
      if (!network.isActive) {
        await prisma.network.update({ where: { id: network.id }, data: { isActive: true } });
      }
      console.log(`\n📡 Сеть уже есть: ${network.name}`);
    }

    for (const catData of netData.categories) {
      // Upsert Category
      let category = await prisma.category.findFirst({
        where: { name: catData.name, networkId: network.id },
      });
      if (!category) {
        category = await prisma.category.create({
          data: { name: catData.name, networkId: network.id, sort: netData.categories.indexOf(catData) },
        });
        console.log(`  📂 Создана категория: ${category.name}`);
      }

      const targetType = inferTargetType(catData.name);

      for (const svcData of catData.services) {
        const serviceName = `${catData.name} • ${svcData.tier}`;
        const externalId = `e2e_${network.slug}_${catData.name.replace(/\s/g, '_').toLowerCase()}_${svcData.tier.toLowerCase()}`;
        const markup = 2.2;

        const existing = await prisma.service.findFirst({ where: { externalId } });
        if (existing) {
          // Убеждаемся что услуга активна
          if (!existing.isActive) {
            await prisma.service.update({ where: { id: existing.id }, data: { isActive: true } });
            console.log(`    ♻️  Активирована: ${serviceName}`);
          } else {
            console.log(`    ⏭️  Уже есть: ${serviceName}`);
          }
          totalSkipped++;
          continue;
        }

        await prisma.service.create({
          data: {
            name: serviceName,
            categoryId: category.id,
            providerId: provider.id,
            rate: svcData.rate,
            markup,
            minQty: svcData.min,
            maxQty: svcData.max,
            externalId,
            isActive: true,
            targetType,
          },
        });
        console.log(`    ✅ Создана услуга: ${serviceName} (${svcData.min}-${svcData.max} шт, $${svcData.rate}/1k)`);
        totalCreated++;
      }
    }
  }

  const totalServices = await prisma.service.count({ where: { isActive: true } });
  console.log(`\n✅ Готово! Создано: ${totalCreated} услуг, пропущено: ${totalSkipped}`);
  console.log(`📊 Всего активных услуг в БД: ${totalServices}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
