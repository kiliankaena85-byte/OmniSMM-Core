import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const USD_RUB = 95.0;

async function main() {
  const p = await prisma.provider.findFirst({ where: { name: 'ResellerSMM' } });
  if (!p) return;

  // Let's search Telegram subscribers in ResellerSMM
  const tgSubs = await prisma.shadowService.findMany({
    where: {
      providerId: p.id,
      category: { contains: 'Telegram', mode: 'insensitive' },
      name: { contains: 'member', mode: 'insensitive' }
    },
    orderBy: { rate: 'asc' },
    take: 10
  });

  console.log('Top Cheapest Telegram Subscribers in ResellerSMM:');
  for (const s of tgSubs) {
    const rub = Number(s.rate) * USD_RUB;
    console.log(`- ID: ${s.externalId} | Rate: $${s.rate} (~${rub.toFixed(2)}₽) | ${s.name}`);
  }

  // Telegram Views
  const tgViews = await prisma.shadowService.findMany({
    where: {
      providerId: p.id,
      category: { contains: 'Telegram', mode: 'insensitive' },
      name: { contains: 'view', mode: 'insensitive' }
    },
    orderBy: { rate: 'asc' },
    take: 5
  });

  console.log('\nTop Cheapest Telegram Views in ResellerSMM:');
  for (const s of tgViews) {
    const rub = Number(s.rate) * USD_RUB;
    console.log(`- ID: ${s.externalId} | Rate: $${s.rate} (~${rub.toFixed(2)}₽) | ${s.name}`);
  }

  // Instagram Followers
  const igSubs = await prisma.shadowService.findMany({
    where: {
      providerId: p.id,
      category: { contains: 'Instagram', mode: 'insensitive' },
      name: { contains: 'follower', mode: 'insensitive' }
    },
    orderBy: { rate: 'asc' },
    take: 8
  });

  console.log('\nTop Cheapest Instagram Followers in ResellerSMM:');
  for (const s of igSubs) {
    const rub = Number(s.rate) * USD_RUB;
    console.log(`- ID: ${s.externalId} | Rate: $${s.rate} (~${rub.toFixed(2)}₽) | ${s.name}`);
  }
}
main();
