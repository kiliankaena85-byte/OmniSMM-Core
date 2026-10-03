import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const sample = await db.service.findFirst({
    where: {
      name: { contains: '...' }
    },
    include: {
      category: true
    }
  });

  if (!sample) {
    console.log('No service with "..." found');
    return;
  }

  console.log(`Service: ${sample.name}`);
  console.log(`ProviderId: ${sample.providerId}, ExternalId: ${sample.externalId}`);

  if (sample.providerId && sample.externalId) {
    const shadow = await db.shadowService.findFirst({
      where: {
        providerId: sample.providerId,
        externalId: sample.externalId
      }
    });
    console.log(`ShadowService:`, shadow ? {
      name: shadow.name,
      cleanName: shadow.cleanName,
      type: shadow.type,
      customDataType: shadow.customDataType,
      isPrivate: shadow.isPrivate
    } : 'NOT FOUND');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
