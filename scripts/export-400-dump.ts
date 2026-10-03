import 'dotenv/config';
import { db } from '../src/lib/db';
import fs from 'fs';

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

  const fullDump: any[] = [];
  for (const s of services) {
    fullDump.push({
      numericId: s.numericId,
      id: s.id,
      name: s.name,
      network: s.category.network?.name,
      networkSlug: s.category.network?.slug,
      category: s.category.name,
      categorySlug: s.category.slug,
      externalId: s.externalId,
      providerId: s.providerId,
      customDataType: s.customDataType,
      isPrivate: s.isPrivate
    });
  }

  fs.writeFileSync('scripts/full_400_services_dump.json', JSON.stringify(fullDump, null, 2), 'utf8');
  console.log(`Saved ${fullDump.length} services to scripts/full_400_services_dump.json`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
