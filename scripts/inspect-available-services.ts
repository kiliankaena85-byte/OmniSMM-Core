import { db } from '../src/lib/db';

async function main() {
  // Check how many services exist in db.service
  const services = await db.service.findMany({
    select: {
      id: true,
      name: true,
      categoryId: true,
      category: { select: { name: true, network: { select: { name: true } } } },
      provider: { select: { name: true } },
      costPer1kRub: true,
      pricePer1000Cents: true,
      minQty: true,
      maxQty: true,
      qualityTier: true,
      isDripFeedEnabled: true,
      isRefillEnabled: true,
      isCancelEnabled: true,
      description: true
    },
    take: 30
  });

  console.log(`Total services in DB: ${await db.service.count()}`);
  console.log('Sample services:');
  for (const s of services) {
    console.log(`[${s.id}] [${s.category?.network?.name} -> ${s.category?.name}] ${s.name} | Price: ${Number(s.pricePer1000Cents)/100}₽/1k | Cost: ${s.costPer1kRub}₽ | Provider: ${s.provider?.name}`);
  }
}

main().catch(console.error).finally(() => process.exit(0));
