import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const tkServices = await db.shadowService.findMany({
    where: {
      platform: { in: ['tiktok', 'TikTok'] }
    },
    take: 20
  });

  console.log(`Found ${tkServices.length} TikTok services in shadow:`);
  for (const s of tkServices) {
    console.log(`ExtId: ${s.externalId} | Rate: ${s.rateRub} RUB | Name: "${s.name}"`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
