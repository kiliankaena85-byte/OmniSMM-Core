import dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/lib/db';
import { CatalogSyncService } from '../src/services/admin/catalog/catalog-sync.service';

async function main() {
  const provider = await db.provider.findFirst({
    where: { name: 'ResellerSMM' }
  });

  if (!provider) {
    console.error('ResellerSMM not found');
    process.exit(1);
  }

  console.log(`Starting shadow catalog refresh for ${provider.name} (${provider.id})...`);
  const count = await CatalogSyncService.refreshShadowCatalog(provider.id);
  console.log(`Shadow catalog refreshed successfully! Total services in shadow catalog: ${count}`);

  const sample = await db.shadowService.findFirst({
    where: { providerId: provider.id },
    select: {
      externalId: true,
      name: true,
      category: true,
      rate: true,
      min: true,
      max: true,
      costRub: true
    }
  });

  console.log('Sample shadow service:', sample);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Shadow refresh failed:', err);
    process.exit(1);
  });
