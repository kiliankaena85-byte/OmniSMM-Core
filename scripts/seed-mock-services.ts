import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DATA = [
  {
    network: 'telegram',
    name: 'Telegram',
    categories: [
      {
        name: 'Подписчики',
        services: [
          { name: 'Эконом', rate: 0.05, desc: 'Быстрые подписчики низкого качества. Возможны списания.', reqs: ['Канал/Группа должны быть открытыми', 'Услуга только для публичных каналов/групп'] },
          { name: 'Стандарт', rate: 0.15, desc: 'Подписчики среднего качества. Умеренная скорость.', reqs: ['Канал/Группа должны быть открытыми', 'Услуга только для публичных каналов/групп'] },
          { name: 'Премиум', rate: 0.5, desc: 'Высокое качество, с гарантией.', reqs: ['Канал должен быть открытым', 'Ссылка формата t.me/username', 'Только для каналов (не группы)'] },
          { name: 'Живые', rate: 1.2, desc: 'Реальные пользователи. Могут проявлять активность.', reqs: ['Канал должен быть открытым', 'Не менее 5 постов на канале', 'Запрещены тематики 18+', 'Только для каналов'] },
        ]
      },
      {
        name: 'Просмотры',
        services: [
          { name: 'Эконом', rate: 0.02, desc: 'Быстрые просмотры постов. Низкое качество.', reqs: ['Канал должен быть открытым', 'Если в посте несколько медиа (медиа-группа), необходимо оформить 2 заказа: на ПЕРВОЕ и ПОСЛЕДНЕЕ медиа в группе'] },
          { name: 'Стандарт', rate: 0.08, desc: 'Просмотры среднего качества. Стабильная скорость.', reqs: ['Канал должен быть открытым', 'Если в посте несколько медиа (медиа-группа), необходимо оформить 2 заказа: на ПЕРВОЕ и ПОСЛЕДНЕЕ медиа в группе'] },
          { name: 'Премиум', rate: 0.20, desc: 'Высокое качество просмотров с удержанием.', reqs: ['Канал должен быть открытым', 'Ссылка должна вести на конкретный пост (t.me/channel/123)', 'Если в посте несколько медиа (медиа-группа), необходимо оформить 2 заказа: на ПЕРВОЕ и ПОСЛЕДНЕЕ медиа в группе'] },
        ]
      }
    ]
  },
  {
    network: 'vk',
    name: 'VKontakte',
    categories: [
      {
        name: 'Подписчики',
        services: [
          { name: 'Эконом', rate: 0.04, desc: 'Бот-аккаунты ВК.', reqs: ['Группа/Профиль должны быть открыты', 'Список подписчиков должен быть открыт'] },
          { name: 'Стандарт', rate: 0.12, desc: 'Микс ботов и офферов.', reqs: ['Группа/Профиль должны быть открыты', 'Список подписчиков должен быть открыт'] },
          { name: 'Премиум', rate: 0.45, desc: 'Офферы высокого качества с заполненными профилями.', reqs: ['Группа должна быть открыта', 'Список подписчиков должен быть открыт', 'Ссылка формата vk.com/group_name'] },
          { name: 'Живые', rate: 1.0, desc: 'Рекламный трафик ВК.', reqs: ['Группа должна быть открыта', 'Список подписчиков должен быть открыт', 'Наличие минимум 3 постов', 'Включены комментарии'] },
        ]
      }
    ]
  },
  {
    network: 'instagram',
    name: 'Instagram',
    categories: [
      {
        name: 'Подписчики',
        services: [
          { name: 'Эконом', rate: 0.06, desc: 'Дешевые подписчики со всего мира.', reqs: ['Профиль должен быть строго открытым (публичным)', 'Обязательно выключите функцию "Пометить для проверки". Инструкция: https://telegra.ph/Kak-otklyuchit-Pometit-dlya-proverki-05-04'] },
          { name: 'Стандарт', rate: 0.20, desc: 'СНГ подписчики, среднее качество.', reqs: ['Профиль должен быть строго открытым (публичным)', 'Обязательно выключите функцию "Пометить для проверки". Инструкция: https://telegra.ph/Kak-otklyuchit-Pometit-dlya-proverki-05-04'] },
          { name: 'Премиум', rate: 0.60, desc: 'Высокое качество, аватарки и публикации.', reqs: ['Профиль должен быть публичным', 'Отсутствие возрастных ограничений', 'Обязательно выключите функцию "Пометить для проверки". Инструкция: https://telegra.ph/Kak-otklyuchit-Pometit-dlya-proverki-05-04'] },
          { name: 'Живые', rate: 1.5, desc: 'Реальные люди из рекомендаций.', reqs: ['Профиль строго открыт', 'Реальные фото в профиле', 'Не меняйте username во время накрутки', 'Обязательно выключите функцию "Пометить для проверки". Инструкция: https://telegra.ph/Kak-otklyuchit-Pometit-dlya-proverki-05-04'] },
        ]
      }
    ]
  }
];

async function main() {
  const { CatalogLockGuard } = await import('../src/lib/catalog-lock');
  const isLocked = await CatalogLockGuard.isLocked().catch(() => true);
  if (isLocked) {
    console.error('⛔ [INVIOLABLE DATABASE GUARD] Catalog is LOCKED. seed-mock-services is aborted.');
    process.exit(1);
  }

  console.log('🌱 Starting DB Seeding for TG, VK, Insta...');

  // Ensure mock provider
  let provider = await prisma.provider.findFirst({ where: { name: 'MockProvider' } });
  if (!provider) {
    provider = await prisma.provider.create({
      data: {
        name: 'MockProvider',
        apiUrl: 'https://mock.com/api',
        apiKey: 'mock123'
      }
    });
  }

  for (const net of DATA) {
    let network = await prisma.network.findFirst({
      where: { OR: [{ slug: net.network }, { name: net.name }] }
    });
    if (!network) {
      network = await prisma.network.create({
        data: { name: net.name, slug: net.network, isActive: true, sort: 0 }
      });
    } else if (network.slug !== net.network) {
      network = await prisma.network.update({
        where: { id: network.id },
        data: { slug: net.network }
      });
    }

    for (const cat of net.categories) {
      let category = await prisma.category.findFirst({
        where: { networkId: network.id, name: cat.name }
      });

      if (!category) {
        category = await prisma.category.create({
          data: { name: cat.name, networkId: network.id }
        });
      }

      for (const srv of cat.services) {
        // Skip if already exists
        const exists = await prisma.service.findFirst({
          where: { categoryId: category.id, name: srv.name }
        });

        if (!exists) {
          await prisma.service.create({
            data: {
              categoryId: category.id,
              providerId: provider.id,
              name: srv.name,
              description: srv.desc,
              rate: srv.rate,
              markup: 3.0,
              minQty: 100,
              maxQty: 10000,
              externalId: `mock_${net.network}_${Math.floor(Math.random() * 10000)}`,
              features: {
                requirements: srv.reqs
              },
              isActive: true
            }
          });
          console.log(`✅ Created Service: ${srv.name} for ${net.name}`);
        } else {
          // Update existing just in case
          await prisma.service.update({
            where: { id: exists.id },
            data: {
              features: { requirements: srv.reqs },
              description: srv.desc
            }
          });
          console.log(`🔄 Updated Service: ${srv.name} for ${net.name}`);
        }
      }
    }
  }

  console.log('✅ Seeding completed!');
}

main().catch(console.error).finally(() => prisma.$disconnect());
