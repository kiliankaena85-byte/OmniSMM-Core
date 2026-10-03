import { db } from '../src/lib/db';

async function main() {
  console.log('🔍 Searching shadow services for Telegram Subscribers...');
  const tgSubs = await db.shadowService.findMany({
    where: {
      category: { contains: 'Telegram', mode: 'insensitive' },
      name: { contains: 'подписч', mode: 'insensitive' }
    },
    select: {
      id: true,
      externalId: true,
      name: true,
      category: true,
      rate: true,
      rateRub: true,
      cleanName: true,
      min: true,
      max: true,
      dripfeed: true,
      refill: true,
      cancel: true,
      provider: { select: { name: true } }
    },
    take: 15
  });

  console.log(`Found ${tgSubs.length} sample Telegram subscriber services:`);
  for (const s of tgSubs) {
    console.log(`- [${s.provider?.name}] ID: ${s.externalId} | RateRub: ${s.rateRub || s.rate} | Refill: ${s.refill} | Min: ${s.min} Max: ${s.max} | "${s.name}"`);
  }

  console.log('\n🔍 Searching shadow services for VK Subscribers...');
  const vkSubs = await db.shadowService.findMany({
    where: {
      category: { contains: 'VK', mode: 'insensitive' },
      name: { contains: 'подписч', mode: 'insensitive' }
    },
    select: {
      id: true,
      externalId: true,
      name: true,
      category: true,
      rate: true,
      rateRub: true,
      min: true,
      max: true,
      refill: true,
      provider: { select: { name: true } }
    },
    take: 10
  });
  console.log(`Found ${vkSubs.length} VK subscriber services:`);
  for (const s of vkSubs) {
    console.log(`- [${s.provider?.name}] ID: ${s.externalId} | RateRub: ${s.rateRub || s.rate} | Refill: ${s.refill} | "${s.name}"`);
  }
}

main().catch(console.error).finally(() => process.exit(0));
