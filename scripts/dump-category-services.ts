import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const cats = await db.category.findMany({
    include: {
      network: true,
      services: {
        select: {
          id: true,
          name: true,
          rate: true,
          costPer1kRub: true,
          pricePer1000Cents: true,
          minQty: true,
          maxQty: true,
          qualityTier: true
        }
      }
    },
    orderBy: [
      { network: { sort: 'asc' } },
      { sort: 'asc' }
    ]
  });

  console.log(`Found ${cats.length} categories.`);
  for (const c of cats) {
    console.log(`\n========================================`);
    console.log(`Category: [${c.network?.name}] ${c.name} (${c.services.length} services)`);
    console.log(`ActivityType: ${c.activityType}`);
    c.services.slice(0, 3).forEach(s => {
      console.log(`   * ${s.name} | ${s.qualityTier} | min: ${s.minQty} max: ${s.maxQty}`);
    });
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
