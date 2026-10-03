import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const services = await db.service.findMany({
    include: {
      category: {
        include: { network: true }
      }
    },
    orderBy: [
      { numericId: 'asc' }
    ]
  });

  console.log(`Inspecting ${services.length} services...`);
  
  // Group by Network -> Category
  const tree: Record<string, Record<string, Array<{ id: string; name: string; externalId: string | null; providerId: string | null }>>> = {};

  for (const s of services) {
    const net = s.category.network?.name || 'Unknown';
    const cat = s.category.name;
    if (!tree[net]) tree[net] = {};
    if (!tree[net][cat]) tree[net][cat] = [];
    tree[net][cat].push({
      id: s.id,
      name: s.name,
      externalId: s.externalId,
      providerId: s.providerId
    });
  }

  for (const [net, cats] of Object.entries(tree)) {
    console.log(`\n========================================`);
    console.log(`NETWORK: ${net}`);
    console.log(`========================================`);
    for (const [cat, sList] of Object.entries(cats)) {
      console.log(`\n  --- Category: "${cat}" (${sList.length} services) ---`);
      for (const s of sList) {
        console.log(`    [${s.externalId || 'NO-EXT'}] ${s.name}`);
      }
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
