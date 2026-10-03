import 'dotenv/config';
import { db } from '../src/lib/db';

async function run() {
  const cats = await db.category.findMany({
    include: { network: true, _count: { select: { services: true } } },
    orderBy: [{ network: { sort: 'asc' } }, { sort: 'asc' }, { name: 'asc' }]
  });
  console.log('Total categories:', cats.length);
  for (const c of cats) {
    console.log(`[${c.network.slug}] id=${c.id} sort=${c.sort} name="${c.name}" slug=${c.slug} srv=${c._count.services}`);
  }
}
run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
