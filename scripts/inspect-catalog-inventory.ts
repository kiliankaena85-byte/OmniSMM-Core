import { db } from '../src/lib/db';

async function main() {
  const srvCount = await db.service.count();
  const shadowCount = await db.shadowService.count();
  console.log('Active Services in DB:', srvCount);
  console.log('Shadow Services in DB:', shadowCount);

  // Group services by network and category
  const services = await db.service.findMany({
    select: {
      id: true,
      name: true,
      qualityTier: true,
      pricePer1000Cents: true,
      costPer1kRub: true,
      category: {
        select: {
          id: true,
          name: true,
          slug: true,
          network: {
            select: { id: true, name: true, slug: true }
          }
        }
      }
    }
  });

  const map = new Map<string, { total: number; sampleNames: string[] }>();
  for (const s of services) {
    const key = `${s.category?.network?.name || 'Unknown'} -> ${s.category?.name || 'Unknown'}`;
    const entry = map.get(key) || { total: 0, sampleNames: [] };
    entry.total++;
    if (entry.sampleNames.length < 3) entry.sampleNames.push(s.name);
    map.set(key, entry);
  }

  console.log('\n--- SERVICES DISTRIBUTION BY CATEGORY ---');
  for (const [cat, data] of map.entries()) {
    console.log(`\n${cat} (${data.total} services)`);
    data.sampleNames.forEach(n => console.log(`   * ${n}`));
  }
}

main().catch(console.error).finally(() => process.exit(0));
