import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const networks = await db.network.findMany({
    include: {
      categories: {
        include: {
          _count: {
            select: { services: true }
          }
        },
        orderBy: { sort: 'asc' }
      }
    },
    orderBy: { sort: 'asc' }
  });

  console.log(`Networks: ${networks.length}`);
  for (const net of networks) {
    console.log(`\nPlatform: ${net.name} (${net.slug}) - ${net.categories.length} categories`);
    for (const cat of net.categories) {
      console.log(`  - [${cat.id}] ${cat.name} (${cat._count.services} services) | desc: ${cat.description || 'NONE'} | type: ${cat.activityType}`);
    }
  }

  const shadowCount = await db.shadowService.count();
  console.log(`\nTotal ShadowServices in DB: ${shadowCount}`);

  // Sample shadow services
  const sampleShadow = await db.shadowService.findMany({
    take: 10,
    select: {
      id: true,
      name: true,
      category: true,
      originalCategory: true,
      rate: true,
      min: true,
      max: true,
      type: true
    }
  });
  console.log('\nSample ShadowServices:');
  console.log(JSON.stringify(sampleShadow, null, 2));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
