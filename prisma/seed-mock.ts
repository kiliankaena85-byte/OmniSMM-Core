import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

/** Infer targetType from category name for seeding. Must stay in sync with src/utils/target-type.ts */
/** Infer targetType from category name for seeding. Must stay in sync with src/utils/target-type.ts */
function inferTargetTypeForSeed(categoryName: string): string {
  const lower = categoryName.toLowerCase();
  if (['подписчик', 'участник', 'subscriber', 'follower', 'буст', 'boost', 'груп', 'group', 'друз', 'friend', 'автопросмотр', 'массовые просмотры', 'auto view'].some(k => lower.includes(k))) return 'CHANNEL';
  if (['стори', 'story', 'stories', 'истори'].some(k => lower.includes(k))) return 'STORY';
  if (['звёзд', 'звезд', 'star'].some(k => lower.includes(k))) return 'CUSTOM';
  return 'POST';
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Error: Running this seed script in production is strictly forbidden.');
    process.exit(1);
  }

  const { CatalogLockGuard } = await import('../src/lib/catalog-lock');
  const isLocked = await CatalogLockGuard.isLocked().catch(() => true);
  if (isLocked) {
    console.error('⛔ [INVIOLABLE DATABASE GUARD] Catalog is LOCKED. seed-mock is BLOCKED to prevent wiping configured database.');
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl.includes('test') && !dbUrl.includes('smmplan_test')) {
    console.error(`⛔ [SAFETY GUARD] seed-mock can ONLY run against a dedicated test database (smmplan_test). Current: ${dbUrl}`);
    process.exit(1);
  }

  console.log('Seeding massive mock data for Enterprise UX testing...');

  console.log('Clearing old mock records...');
  await prisma.order.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.ticket.deleteMany({});
  await prisma.service.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.network.deleteMany({});

  // 1. Providers
  const providerNames = ['Vexboost', 'HQ-SMM', 'SMM-Panel-Pro', 'Cheap-SMM'];
  for (const name of providerNames) {
    await prisma.provider.upsert({
      where: { name },
      update: {
        ticketUrl: `https://${name.toLowerCase().replace(/-/g, '')}.com/support`
      },
      create: {
        name,
        apiUrl: `https://${name.toLowerCase().replace(/-/g, '')}.com/api/v2`,
        apiKey: `mock_key_${name}`,
        isActive: true,
        ticketUrl: `https://${name.toLowerCase().replace(/-/g, '')}.com/support`
      }
    });
  }
  const providers = await prisma.provider.findMany();

  // 2. Networks & Categories
  const networks = ['Instagram', 'Telegram', 'VKontakte', 'YouTube', 'TikTok'];
  for (let i = 0; i < networks.length; i++) {
    const name = networks[i];
    const slug = name.toLowerCase();
    
    const nw = await prisma.network.create({
      data: { name, slug, sort: i }
    });
    console.log(`Created Network: ${name}`);

    let categoryNames = ['Лайки', 'Подписчики', 'Просмотры', 'Комментарии'];
    if (name === 'Telegram') {
      categoryNames = [...categoryNames, 'Реакции', 'Бусты (Telegram Levels)', 'Звезды (Telegram Stars)', 'Автопросмотры'];
    }

    for (let j = 0; j < categoryNames.length; j++) {
      const catName = categoryNames[j];
      const slugMap: Record<string, string> = {
        'Лайки': 'likes',
        'Подписчики': 'subscribers',
        'Просмотры': 'views',
        'Комментарии': 'comments',
        'Реакции': 'reactions',
        'Бусты (Telegram Levels)': 'boosts',
        'Звезды (Telegram Stars)': 'stars',
        'Автопросмотры': 'autoviews'
      };
      const catSlug = `${nw.slug}-${slugMap[catName] || `cat-${j}`}`;
      const cat = await prisma.category.create({
        data: { name: catName, slug: catSlug, networkId: nw.id, sort: j }
      });
      console.log(`Created Category: "${cat.name}" (${cat.slug}) in Network "${name}"`);
    }
  }

  const categories = await prisma.category.findMany();

  // 3. Services (generate 3 tiers for every category)
  let serviceCounter = 0;
  for (const cat of categories) {
    const tiers = ['Эконом', 'Стандарт', 'Премиум'];
    for (let t = 0; t < tiers.length; t++) {
      const prv = providers[serviceCounter % providers.length];
      const baseRate = 0.05 + (t * 0.1) + (serviceCounter % 3) * 0.02; // $0.05 to $0.35 USD
      const markupMultiplier = 1.6;
      const pricePer1000Cents = Math.round(baseRate * markupMultiplier * 90 * 100);

      const externalId = `srv_${cat.id}_${t}`;
      let srv = await prisma.service.findFirst({
        where: { externalId }
      });
      if (!srv) {
        // eslint-disable-next-line no-useless-assignment
        srv = await prisma.service.create({
          data: {
            name: `${cat.name} • ${tiers[t]}`,
            categoryId: cat.id,
            providerId: prv.id,
            rate: baseRate,
            markup: markupMultiplier,
            pricePer1000Cents: pricePer1000Cents,
            minQty: 10,
            maxQty: 100000,
            externalId,
            isActive: true,
            targetType: inferTargetTypeForSeed(cat.name)
          }
        });
      }
      serviceCounter++;
    }
  }
  const services = await prisma.service.findMany();

  // 4. Users (Clients)
  const roles = ['USER', 'USER', 'USER', 'MANAGER', 'ADMIN', 'BANNED'];
  for (let i = 1; i <= 25; i++) {
    await prisma.user.upsert({
      where: { email_tenantId: { email: `mockclient${i}@example.com`, tenantId: 'smmplan' } },
      update: {},
      create: {
        email: `mockclient${i}@example.com`,
        tenantId: 'smmplan',
        role: roles[i % roles.length] as any,
        balance: Math.floor(Math.random() * 1000000), // Random up to 10k RUB
        totalSpent: Math.floor(Math.random() * 5000000),
      }
    });
  }
  const users = await prisma.user.findMany();

  // 5. Orders (Generating 150 diverse orders)
  const statuses = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL', 'CANCELED', 'ERROR'];
  const errorMsgs = [
    'Not enough funds on provider balance',
    'Invalid link format (private profile)',
    'Service disabled by provider',
    'API Rate Limit Exceeded'
  ];

  console.log('Generating Orders...');
  for (let i = 0; i < 150; i++) {
    const u = users[Math.floor(Math.random() * users.length)];
    const s = services[Math.floor(Math.random() * services.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const isDripFeed = Math.random() > 0.8;
    const qty = Math.floor(Math.random() * 5000) + 100;
    
    const createdAt = new Date(Date.now() - Math.floor(Math.random() * 2592000000 * 3)); // up to 3 months ago

    await prisma.order.create({
      data: {
        userId: u.id,
        serviceId: s.id,
        externalId: `ord_ext_${crypto.randomUUID().substring(0, 8)}`,
        link: `https://social.com/p/${crypto.randomUUID().substring(0, 8)}`,
        quantity: qty,
        charge: Math.floor((qty * s.pricePer1000Cents) / 1000), // cents
        providerCost: Math.floor((qty * (s.rate * 90 * 100)) / 1000), // cents
        remains: status === 'PARTIAL' ? Math.floor(qty / 2) : (status === 'CANCELED' ? qty : 0),
        status: status as any,
        error: status === 'ERROR' ? errorMsgs[Math.floor(Math.random() * errorMsgs.length)] : null,
        isDripFeed: isDripFeed,
        runs: isDripFeed ? 5 : undefined,
        interval: isDripFeed ? 15 : undefined,
        currentRun: isDripFeed && status === 'IN_PROGRESS' ? 2 : undefined,
        dripExternalIds: isDripFeed ? ['drip1', 'drip2'] : [],
        createdAt: createdAt
      }
    });
  }

  // 6. Support Tickets
  console.log('Generating Tickets...');
  const ticketStatuses = ['OPEN', 'PENDING', 'CLOSED'];
  for (let i = 0; i < 30; i++) {
    const u = users[Math.floor(Math.random() * users.length)];
    await prisma.ticket.create({
      data: {
        userId: u.id,
        subject: `Order Issue #${Math.floor(Math.random() * 1000)}`,
        status: ticketStatuses[Math.floor(Math.random() * ticketStatuses.length)] as any,
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 1000000000)),
        messages: {
          create: {
            sender: 'USER',
            text: `Hello, please check my order. It's stuck for a week now!`,
          }
        }
      }
    });
  }

  // 7. Payments for Finance Graphs
  console.log('Generating Payments...');
  for (let i = 0; i < 80; i++) {
    const u = users[Math.floor(Math.random() * users.length)];
    await prisma.payment.create({
      data: {
        userId: u.id,
        amount: Math.floor(Math.random() * 500000) + 50000,
        gateway: 'yookassa',
        status: 'SUCCEEDED',
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 2592000000 * 3)) // up to 3 months ago
      }
    });
  }

  console.log('Massive seeding completed successfully! 🎉');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
