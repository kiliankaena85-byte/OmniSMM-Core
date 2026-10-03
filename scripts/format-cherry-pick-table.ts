import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const USD_RUB = 95.0;

async function main() {
  const p = await prisma.provider.findFirst({ where: { name: 'ResellerSMM' } });
  if (!p) return;

  // Let's get the specific services we found:
  // Telegram Subscribers, Telegram Views, Telegram Reactions
  // Instagram Followers, Instagram Likes, Instagram Views
  // YouTube Views, YouTube Shorts, YouTube Subscribers
  // TikTok Views, TikTok Followers, TikTok Likes
  // Spotify Plays, Twitter Followers

  const queryIds = ['2304', '8012', '7699', '2588', '5120', '838', '7784', '2598', '7749', '2032', '2273', '7899', '8376', '5187', '2751', '7410'];

  const services = await prisma.shadowService.findMany({
    where: {
      providerId: p.id,
      externalId: { in: queryIds }
    }
  });

  console.log('Found services:', services.length);
  for (const s of services) {
    const rateNum = Number(s.rate);
    const rub = rateNum * USD_RUB;
    console.log(`[${s.externalId}] ${s.name} | Rate: $${rateNum} (${rub.toFixed(2)}₽) | Min: ${s.min} | Max: ${s.max}`);
  }
}
main();
