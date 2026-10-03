import { db } from '../src/lib/db';

async function main() {
  console.log('=== NETWORKS ===');
  const networks = await db.network.findMany({
    orderBy: { sort: 'asc' },
    include: {
      categories: {
        orderBy: { sort: 'asc' },
        include: {
          _count: { select: { services: true } }
        }
      }
    }
  });

  for (const net of networks) {
    console.log(`\nNetwork: ${net.name} (slug: ${net.slug}, categories: ${net.categories.length})`);
    for (const cat of net.categories) {
      console.log(`  - [${cat.id}] "${cat.name}" (slug: ${cat.slug}, services: ${cat._count.services}, activity: ${cat.activityType || 'none'})`);
    }
  }

  console.log('\n=== PROVIDERS IN DB ===');
  const providers = await db.provider.findMany({
    select: { id: true, name: true, providerType: true, isActive: true, _count: { select: { services: true } } }
  });
  console.log(providers);
}

main().catch(console.error).finally(() => process.exit(0));
