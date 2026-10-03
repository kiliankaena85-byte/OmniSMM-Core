import dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/lib/db';
import { encrypt } from '../src/lib/crypto/encryption';

async function main() {
  const name = 'ResellerSMM';
  const apiUrl = 'https://resellersmm.com/api/v2';
  const rawApiKey = '100232817c11fb83d1532c5ac1f8b22e';
  const balanceCurrency = 'USD';
  const providerType = 'SMM_PANEL';

  const encryptedKey = encrypt(rawApiKey);

  const existing = await db.provider.findFirst({
    where: {
      OR: [
        { name },
        { apiUrl }
      ]
    }
  });

  if (existing) {
    console.log(`Provider already exists with ID: ${existing.id}. Updating...`);
    const updated = await db.provider.update({
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
    console.log('Provider updated successfully:', {
      id: updated.id,
      name: updated.name,
      apiUrl: updated.apiUrl,
      balanceCurrency: updated.balanceCurrency,
      isActive: updated.isActive,
    });
    return updated;
  }

  const created = await db.provider.create({
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

  console.log('Provider created successfully:', {
    id: created.id,
    name: created.name,
    apiUrl: created.apiUrl,
    balanceCurrency: created.balanceCurrency,
    isActive: created.isActive,
  });

  return created;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to add provider:', err);
    process.exit(1);
  });
