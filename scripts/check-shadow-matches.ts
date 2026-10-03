import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const services = await db.service.findMany({
    select: {
      id: true,
      name: true,
      providerId: true,
      externalId: true
    }
  });

  let matched = 0;
  for (const s of services) {
    if (s.providerId && s.externalId) {
      const sh = await db.shadowService.findFirst({
        where: { providerId: s.providerId, externalId: s.externalId }
      });
      if (sh) matched++;
    }
  }

  console.log(`Matched ${matched} of ${services.length} services with ShadowService.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
