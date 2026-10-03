import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const rutubeSubs = await db.shadowService.findMany({
    where: {
      platform: { in: ['rutube', 'Rutube'] },
      name: { contains: 'подписчик', mode: 'insensitive' }
    },
    take: 10
  });

  console.log(`Found ${rutubeSubs.length} Rutube subscriber shadow services:`);
  for (const s of rutubeSubs) {
    console.log(`  - [${s.externalId}] ${s.name} | rate: ${s.rateRub} RUB | min: ${s.min} max: ${s.max}`);
  }

  const tiktokSubs = await db.shadowService.findMany({
    where: {
      platform: { in: ['tiktok', 'TikTok'] },
      name: { contains: 'подписчик', mode: 'insensitive' }
    },
    take: 10
  });

  console.log(`\nFound ${tiktokSubs.length} TikTok subscriber shadow services:`);
  for (const s of tiktokSubs) {
    console.log(`  - [${s.externalId}] ${s.name} | rate: ${s.rateRub} RUB | min: ${s.min} max: ${s.max}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
