import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const vkSubs = await db.shadowService.findMany({
    where: {
      platform: { in: ['vk', 'VK', 'vkontakte'] },
      name: { contains: 'подписчик', mode: 'insensitive' }
    },
    take: 5
  });

  console.log(`Found ${vkSubs.length} VK subscriber shadow services:`);
  for (const s of vkSubs) {
    console.log(`ExtId: ${s.externalId} | Rate: ${s.rateRub} RUB | Name: "${s.name}"`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
