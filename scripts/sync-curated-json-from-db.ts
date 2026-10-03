import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 [SYNC CURATED JSON] Updating docs/CURATED_SERVICES_400.json with canonical categories...');
  const filePath = path.resolve('docs/CURATED_SERVICES_400.json');
  if (!fs.existsSync(filePath)) {
    console.error('File not found:', filePath);
    return;
  }

  const items = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const dbServices = await prisma.service.findMany({
    include: {
      category: {
        include: {
          network: true
        }
      }
    }
  });

  const serviceCatMap = new Map<string, string>();
  for (const s of dbServices) {
    if (s.category && s.category.network) {
      serviceCatMap.set(s.slug, `${s.category.network.name} — ${s.category.name}`);
      serviceCatMap.set(s.name, `${s.category.network.name} — ${s.category.name}`);
    }
  }

  let updatedCount = 0;
  for (const item of items) {
    const srvSlug = `srv-${item.id}-${item.name.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 40)}`.slice(0, 50);
    const catName = serviceCatMap.get(srvSlug) || serviceCatMap.get(item.name);
    if (catName && item.category !== catName) {
      item.category = catName;
      updatedCount++;
    }
  }

  fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf-8');
  console.log(`✅ Updated ${updatedCount} items in ${filePath}. Canonical categories locked in master JSON.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
