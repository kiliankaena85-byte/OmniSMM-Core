import { db } from '../src/lib/db';

async function main() {
  console.log('🔍 Searching shadow services for Instagram Subscribers...');
  const instaSubs = await db.shadowService.findMany({
    where: {
      category: { contains: 'Instagram', mode: 'insensitive' },
      name: { contains: 'подписч', mode: 'insensitive' }
    },
    select: {
      id: true,
      externalId: true,
      name: true,
      category: true,
      rateRub: true,
      refill: true,
      min: true,
      max: true,
      provider: { select: { name: true } }
    },
    take: 10
  });
  console.log(`Found ${instaSubs.length} Instagram subscriber services:`);
  for (const s of instaSubs) {
    console.log(`- [${s.provider?.name}] ID: ${s.externalId} | RateRub: ${s.rateRub} | Refill: ${s.refill} | "${s.name}"`);
  }

  console.log('\n🔍 Searching shadow services for Telegram Reactions...');
  const tgReactions = await db.shadowService.findMany({
    where: {
      category: { contains: 'Telegram', mode: 'insensitive' },
      name: { contains: 'реакц', mode: 'insensitive' }
    },
    select: {
      id: true,
      externalId: true,
      name: true,
      category: true,
      rateRub: true,
      refill: true,
      provider: { select: { name: true } }
    },
    take: 15
  });
  console.log(`Found ${tgReactions.length} Telegram reaction services:`);
  for (const s of tgReactions) {
    console.log(`- [${s.provider?.name}] ID: ${s.externalId} | RateRub: ${s.rateRub} | "${s.name}"`);
  }
}

main().catch(console.error).finally(() => process.exit(0));
