import 'dotenv/config';
import { db } from '../src/lib/db';
import { CatalogLockGuard } from '../src/lib/catalog-lock';
import fs from 'fs';
import path from 'path';

async function main() {
  await CatalogLockGuard.unlockCatalog('admin@smmplan.pro', 'Fix single remaining truncated service name');
  try {
    const fixedName = 'TikTok Комментарии (Для стрима, настраиваемые) [Премиум]';
    await db.service.update({
      where: { id: 'cmupoiexy0120dq8i6duffrys' },
      data: { name: fixedName }
    });

    const items = JSON.parse(fs.readFileSync('docs/CURATED_SERVICES_400.json', 'utf8'));
    for (const it of items) {
      if (it.id === 'cmupoiexy0120dq8i6duffrys') {
        it.name = fixedName;
      }
    }
    fs.writeFileSync(path.resolve('docs/CURATED_SERVICES_400.json'), JSON.stringify(items, null, 2), 'utf8');
    console.log('Fixed single truncated service successfully.');
  } finally {
    await CatalogLockGuard.lockCatalog('admin@smmplan.pro');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
