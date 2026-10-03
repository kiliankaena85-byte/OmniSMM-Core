import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const p = await prisma.provider.findFirst({ where: { name: 'PRSkill' } });
  if (!p) return;

  const seo = await prisma.shadowService.findMany({
    where: {
      providerId: p.id,
      OR: [
        { category: { contains: 'ссылк', mode: 'insensitive' } },
        { category: { contains: 'трафик', mode: 'insensitive' } },
        { category: { contains: 'посев', mode: 'insensitive' } },
        { category: { contains: 'отзыв', mode: 'insensitive' } },
        { name: { contains: 'посев', mode: 'insensitive' } },
        { name: { contains: 'крауд', mode: 'insensitive' } },
        { name: { contains: 'стать', mode: 'insensitive' } },
      ]
    },
    take: 20
  });

  console.log(`Unique SEO / Manual Services in PRSkill (${seo.length}):\n`);
  for (const s of seo) {
    console.log(`- [ID: ${s.externalId}] ${s.name} | Rate: ${s.rate} ₽ | Category: ${s.category}`);
  }
}

main().catch(console.error);
