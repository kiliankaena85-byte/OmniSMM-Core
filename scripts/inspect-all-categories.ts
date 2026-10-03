import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
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

  console.log(`=== FOUND ${networks.length} NETWORKS ===`);
  let totalCategories = 0;
  let totalServices = 0;

  for (const net of networks) {
    console.log(`\nNetwork: [${net.slug}] "${net.name}" (${net.categories.length} categories)`);
    for (const cat of net.categories) {
      totalCategories++;
      totalServices += cat._count.services;
      console.log(`  - Category ID: ${cat.id} | Slug: "${cat.slug}" | Name: "${cat.name}" | Services: ${cat._count.services} | Has Desc: ${!!cat.description}`);
    }
  }

  console.log(`\nTOTAL: ${totalCategories} categories, ${totalServices} services in DB.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
