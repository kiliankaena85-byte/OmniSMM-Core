import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { encrypt } from '../src/lib/crypto/encryption';

const prisma = new PrismaClient();

async function main() {
  const name = 'PRSkill';
  const apiUrl = 'https://prskill.ru/api';
  const rawApiKey = '682ebc7ebd6fc4c432711b3658b8405c';
  const balanceCurrency = 'RUB';
  const providerType = 'SMM_PANEL';

  const encryptedKey = encrypt(rawApiKey);

  const existing = await prisma.provider.findFirst({
    where: {
      OR: [
        { name },
        { apiUrl }
      ]
    }
  });

  let providerRecord;
  if (existing) {
    console.log(`Provider already exists with ID: ${existing.id}. Updating...`);
    providerRecord = await prisma.provider.update({
      where: { id: existing.id },
      data: {
        name,
        apiUrl,
        apiKey: encryptedKey,
        isActive: true,
        balanceCurrency,
        providerType,
        lastSuccessAt: new Date(),
      }
    });
  } else {
    providerRecord = await prisma.provider.create({
      data: {
        name,
        apiUrl,
        apiKey: encryptedKey,
        isActive: true,
        balanceCurrency,
        providerType,
        lastSuccessAt: new Date(),
      }
    });
  }

  console.log('Provider PRSkill saved:', {
    id: providerRecord.id,
    name: providerRecord.name,
    apiUrl: providerRecord.apiUrl,
    balanceCurrency: providerRecord.balanceCurrency
  });

  // Now fetch their 578 services
  console.log('Fetching services from https://prskill.ru/api...');
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ key: rawApiKey, action: 'services' }),
    signal: AbortSignal.timeout(20000)
  });

  const text = await res.text();
  let rawServices: any[] = [];
  try {
    const parsed = JSON.parse(text);
    rawServices = Array.isArray(parsed) ? parsed : (parsed.services || parsed.data || []);
  } catch (e) {
    console.error('Failed to parse JSON:', text.slice(0, 200));
  }
  console.log(`Received ${rawServices.length} services from PRSkill.`);

  // Clear previous shadow records for PRSkill
  await prisma.shadowService.deleteMany({ where: { providerId: providerRecord.id } });

  const BATCH_SIZE = 100;
  let savedCount = 0;

  for (let i = 0; i < rawServices.length; i += BATCH_SIZE) {
    const batch = rawServices.slice(i, i + BATCH_SIZE).map(s => {
      const rateNum = Number(s.rate) || 0;
      return {
        providerId: providerRecord.id,
        externalId: String(s.service),
        name: String(s.name || ''),
        category: String(s.category || 'Other'),
        rate: rateNum,
        rateRub: rateNum,
        min: Number(s.min) || 10,
        max: Number(s.max) || 100000,
        type: String(s.type || 'Default'),
        refill: false,
        cancel: false,
        dripfeed: false,
      };
    });

    await prisma.shadowService.createMany({ data: batch });
    savedCount += batch.length;
  }

  console.log(`Successfully saved ${savedCount} PRSkill services to ShadowService table!`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Failed to add PRSkill:', err);
    process.exit(1);
  });
