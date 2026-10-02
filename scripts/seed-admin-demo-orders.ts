import { db } from '../src/lib/db';
import { OrderStatus } from '@prisma/client';

/**
 * Seed safe synthetic demonstration orders for Admin Panel visual inspection.
 * INVARIANT: Never touches categories or services (CATALOG_LOCKED=true).
 * All demo orders are flagged with `isTest: true`.
 * 
 * Usage:
 *   npx tsx scripts/seed-admin-demo-orders.ts         # seeds ~20 demo orders
 *   npx tsx scripts/seed-admin-demo-orders.ts --clean # deletes all test orders
 */
async function main() {
  const isCleanOnly = process.argv.includes('--clean');

  if (isCleanOnly) {
    console.log('🧹 Cleaning up demo test orders...');
    const deleted = await db.order.deleteMany({
      where: { isTest: true }
    });
    console.log(`✅ Removed ${deleted.count} synthetic test orders.`);
    return;
  }

  console.log('🔍 Locating available services and user for demo orders...');

  // 1. Find or create a dedicated demo test user
  let demoUser = await db.user.findFirst({
    where: { email: 'demo_tester@smmplan.pro' }
  });

  if (!demoUser) {
    const existingUser = await db.user.findFirst();
    if (existingUser) {
      demoUser = existingUser;
    } else {
      demoUser = await db.user.create({
        data: {
          email: 'demo_tester@smmplan.pro',
          name: 'Demo Inspector',
          role: 'USER',
          balance: 1000000n, // 10,000 ₽ test balance
          tenantId: 'smmplan'
        }
      });
    }
  }

  // 2. Fetch existing services (READ-ONLY, strictly NO MUTATION of catalog)
  const services = await db.service.findMany({
    take: 10,
    select: {
      id: true,
      name: true,
      providerId: true,
      externalId: true,
      tenantId: true
    }
  });

  if (services.length === 0) {
    console.error('❌ No services found in database! Aborting to protect catalog.');
    return;
  }

  console.log(`📋 Found ${services.length} existing services for demo order binding.`);

  // 3. Clear any existing demo test orders first to prevent bloat
  const cleaned = await db.order.deleteMany({
    where: { isTest: true }
  });
  if (cleaned.count > 0) {
    console.log(`ℹ️ Cleared ${cleaned.count} previous test orders.`);
  }

  // 4. Sample status list for diverse visual tabs in /admin/orders
  const statusPool: Array<{
    status: OrderStatus;
    qty: number;
    remains: number;
    link: string;
    error?: string;
  }> = [
    { status: OrderStatus.COMPLETED, qty: 1000, remains: 0, link: 'https://t.me/durov' },
    { status: OrderStatus.COMPLETED, qty: 500, remains: 0, link: 'https://vk.com/wall-1_12345' },
    { status: OrderStatus.COMPLETED, qty: 2500, remains: 0, link: 'https://instagram.com/p/Cxy_123' },
    { status: OrderStatus.IN_PROGRESS, qty: 3000, remains: 1200, link: 'https://t.me/telegram' },
    { status: OrderStatus.IN_PROGRESS, qty: 1500, remains: 800, link: 'https://vk.com/club123456' },
    { status: OrderStatus.IN_PROGRESS, qty: 5000, remains: 3400, link: 'https://youtube.com/watch?v=dQw4w9WgXcQ' },
    { status: OrderStatus.PENDING, qty: 1000, remains: 1000, link: 'https://t.me/tech_news' },
    { status: OrderStatus.PENDING, qty: 200, remains: 200, link: 'https://vk.com/photo-1_67890' },
    { status: OrderStatus.PARTIAL, qty: 2000, remains: 650, link: 'https://t.me/crypto_daily' },
    { status: OrderStatus.PARTIAL, qty: 1000, remains: 300, link: 'https://instagram.com/p/Cz_abc' },
    { status: OrderStatus.CANCELED, qty: 500, remains: 500, link: 'https://t.me/invalid_channel' },
    { status: OrderStatus.CANCELED, qty: 100, remains: 100, link: 'https://vk.com/deleted_post' },
    { status: OrderStatus.ERROR, qty: 800, remains: 800, link: 'https://t.me/banned_channel', error: 'Provider Error: Target channel is private or restricted' },
    { status: OrderStatus.ERROR, qty: 1200, remains: 1200, link: 'https://instagram.com/p/error_link', error: 'Provider Timeout: Upstream gateway 504' },
    { status: OrderStatus.AWAITING_PAYMENT, qty: 500, remains: 500, link: 'https://t.me/start_blog' },
    { status: OrderStatus.CANCELING, qty: 1500, remains: 900, link: 'https://t.me/refund_req' },
    { status: OrderStatus.COMPLETED, qty: 10000, remains: 0, link: 'https://vk.com/public_smm' },
    { status: OrderStatus.IN_PROGRESS, qty: 4000, remains: 2100, link: 'https://t.me/marketing_hub' },
  ];

  console.log(`🚀 Creating ${statusPool.length} synthetic demonstration orders...`);

  for (let i = 0; i < statusPool.length; i++) {
    const item = statusPool[i];
    const service = services[i % services.length];
    
    // Spread created date across the past 7 days
    const hoursAgo = (i * 9) + 1;
    const createdAt = new Date(Date.now() - hoursAgo * 3600 * 1000);

    const chargeCents = BigInt(Math.round((item.qty * 0.15) * 100)); // 0.15 ₽/unit in cents
    const costCents = BigInt(Math.round((item.qty * 0.08) * 100));   // 0.08 ₽/unit cost

    await db.order.create({
      data: {
        userId: demoUser.id,
        serviceId: service.id,
        providerId: service.providerId,
        providerServiceId: service.externalId,
        externalId: `DEMO-EXT-${10000 + i}`,
        link: item.link,
        quantity: item.qty,
        remains: item.remains,
        status: item.status,
        charge: chargeCents,
        providerCost: costCents,
        error: item.error || null,
        isTest: true,
        tenantId: (i % 5 === 0) ? 'flux' : 'smmplan',
        environmentMode: 'DEMO',
        createdAt,
        updatedAt: createdAt
      }
    });
  }

  const totalOrders = await db.order.count();
  const testOrders = await db.order.count({ where: { isTest: true } });

  console.log(`🎉 Demo orders seeded successfully! Total orders in DB: ${totalOrders} (Demo test orders: ${testOrders})`);
}

main()
  .catch((err) => {
    console.error('❌ Failed to seed demo orders:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(0);
  });
