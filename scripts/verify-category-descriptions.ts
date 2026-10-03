import 'dotenv/config';
import { db } from '../src/lib/db';
import { CATEGORY_DESCRIPTIONS } from './category-descriptions';

async function main() {
  const cats = await db.category.findMany({
    include: { network: true }
  });

  console.log(`DB Categories: ${cats.length}`);
  let matched = 0;
  let missing = 0;

  for (const c of cats) {
    const netSlug = c.network?.slug || '';
    const key = `${netSlug}:::${c.name}`;
    if (CATEGORY_DESCRIPTIONS[key]) {
      matched++;
    } else {
      console.log(`MISSING: ${key}`);
      missing++;
    }
  }

  console.log(`Matched: ${matched} / ${cats.length}, Missing: ${missing}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
