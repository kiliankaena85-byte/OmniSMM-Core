import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const tgReactions = await db.shadowService.findMany({
    where: {
      platform: { contains: 'telegram', mode: 'insensitive' },
      name: { contains: 'реакц', mode: 'insensitive' }
    },
    take: 30,
    select: { id: true, name: true, rateRub: true, min: true, max: true, externalId: true, providerId: true }
  });
  console.log('TG Reactions:');
  tgReactions.forEach(r => console.log(`- [${r.externalId}] ${r.name} (${r.rateRub}₽)`));

  const discordBoosts = await db.shadowService.findMany({
    where: {
      name: { contains: 'discord', mode: 'insensitive' }
    },
    take: 20,
    select: { id: true, name: true, rateRub: true, min: true, max: true, externalId: true }
  });
  console.log('\nDiscord:');
  discordBoosts.forEach(r => console.log(`- [${r.externalId}] ${r.name} (${r.rateRub}₽)`));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
