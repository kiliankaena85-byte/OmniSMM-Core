import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  console.log('Searching ShadowService candidates...');

  // Search single reactions & packs
  const reactions = await db.shadowService.findMany({
    where: {
      platform: { contains: 'telegram', mode: 'insensitive' },
      name: { contains: 'реакц', mode: 'insensitive' }
    },
    take: 15,
    select: { id: true, name: true, rateRub: true, min: true, max: true, providerId: true, externalId: true, type: true }
  });
  console.log('\n--- Telegram Reactions Candidates ---');
  reactions.forEach(r => console.log(`[${r.externalId}] ${r.name} | ${r.rateRub}₽ | min:${r.min} max:${r.max}`));

  // Search comments
  const comments = await db.shadowService.findMany({
    where: {
      name: { contains: 'коммент', mode: 'insensitive' }
    },
    take: 15,
    select: { id: true, name: true, platform: true, rateRub: true, min: true, max: true, providerId: true, externalId: true, customDataType: true }
  });
  console.log('\n--- Comments Candidates ---');
  comments.forEach(r => console.log(`[${r.platform}] [${r.externalId}] ${r.name} | ${r.rateRub}₽ | type:${r.customDataType}`));

  // Search private channel subscribers & private posts
  const privates = await db.shadowService.findMany({
    where: {
      OR: [
        { name: { contains: 'закрыт', mode: 'insensitive' } },
        { name: { contains: 'private', mode: 'insensitive' } }
      ]
    },
    take: 15,
    select: { id: true, name: true, platform: true, rateRub: true, min: true, max: true, providerId: true, externalId: true }
  });
  console.log('\n--- Private Channel Candidates ---');
  privates.forEach(r => console.log(`[${r.platform}] [${r.externalId}] ${r.name} | ${r.rateRub}₽`));

  // Search bots and referrals
  const bots = await db.shadowService.findMany({
    where: {
      OR: [
        { name: { contains: 'бот', mode: 'insensitive' } },
        { name: { contains: 'рефер', mode: 'insensitive' } }
      ]
    },
    take: 15,
    select: { id: true, name: true, platform: true, rateRub: true, min: true, max: true, providerId: true, externalId: true }
  });
  console.log('\n--- Bots & Referrals Candidates ---');
  bots.forEach(r => console.log(`[${r.platform}] [${r.externalId}] ${r.name} | ${r.rateRub}₽`));

  // Search boosts
  const boosts = await db.shadowService.findMany({
    where: {
      name: { contains: 'boost', mode: 'insensitive' }
    },
    take: 15,
    select: { id: true, name: true, platform: true, rateRub: true, min: true, max: true, providerId: true, externalId: true }
  });
  console.log('\n--- Boosts Candidates ---');
  boosts.forEach(r => console.log(`[${r.platform}] [${r.externalId}] ${r.name} | ${r.rateRub}₽`));

  // Search music/plays
  const music = await db.shadowService.findMany({
    where: {
      OR: [
        { name: { contains: 'прослуш', mode: 'insensitive' } },
        { name: { contains: 'плейлист', mode: 'insensitive' } },
        { name: { contains: 'трек', mode: 'insensitive' } }
      ]
    },
    take: 15,
    select: { id: true, name: true, platform: true, rateRub: true, min: true, max: true, providerId: true, externalId: true }
  });
  console.log('\n--- Music Candidates ---');
  music.forEach(r => console.log(`[${r.platform}] [${r.externalId}] ${r.name} | ${r.rateRub}₽`));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
