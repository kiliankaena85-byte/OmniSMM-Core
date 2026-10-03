import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const shadowRutubeSubs = await db.shadowService.findMany({
    where: {
      platform: { in: ['rutube', 'Rutube'] },
      name: { contains: 'подписчик', mode: 'insensitive' }
    }
  });

  console.log(`Found ${shadowRutubeSubs.length} Rutube subscriber shadow services:`);
  for (const s of shadowRutubeSubs) {
    console.log(`ID: ${s.id} | ExtId: ${s.externalId} | Provider: ${s.providerId} | Rate: ${s.rateRub} RUB | Min: ${s.min} | Max: ${s.max} | Name: "${s.name}"`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
