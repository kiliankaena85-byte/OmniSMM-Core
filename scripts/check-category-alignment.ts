import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const services = await db.service.findMany({
    include: {
      category: {
        include: {
          network: true
        }
      }
    }
  });

  console.log(`Checking category alignment for ${services.length} services...`);
  const misplaced: any[] = [];

  for (const s of services) {
    const net = s.category.network?.name || '';
    const cat = s.category.name;
    const name = s.name.toLowerCase();

    // Check if service name clearly belongs to a different activity type
    if (cat === 'Подписчики') {
      if (name.includes('лайк') || name.includes('дизлайк') || name.includes('в топ') || name.includes('просмотр')) {
        misplaced.push({ id: s.id, name: s.name, current: `[${net}] ${cat}` });
      }
    } else if (cat === 'Комментарии') {
      if (name.includes('просмотр') && !name.includes('коммент')) {
        misplaced.push({ id: s.id, name: s.name, current: `[${net}] ${cat}` });
      }
    } else if (cat === 'Фолловеры') {
      if (name.includes('просмотр') && !name.includes('фолловер') && !name.includes('подписчик')) {
        misplaced.push({ id: s.id, name: s.name, current: `[${net}] ${cat}` });
      }
    } else if (cat === 'Зрители на Стрим') {
      if (name.includes('просмотр') && !name.includes('зрител') && !name.includes('стрим') && !name.includes('трансляц')) {
        misplaced.push({ id: s.id, name: s.name, current: `[${net}] ${cat}` });
      }
    }
  }

  console.log(`Found ${misplaced.length} potentially misplaced services:`);
  for (const m of misplaced) {
    console.log(`  - ${m.current}: ${m.name}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
