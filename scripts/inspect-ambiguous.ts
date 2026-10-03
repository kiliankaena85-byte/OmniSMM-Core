import fs from 'fs';

const services = JSON.parse(fs.readFileSync('scripts/full_400_services_dump.json', 'utf8'));

console.log('=== SERVICES IN AMBIGUOUS CATEGORIES ===\n');

for (const s of services) {
  if (s.category.includes('Другое') || s.category.includes('Авто') || s.category === 'Подписчики премиум' || s.category === 'Прослушивания') {
    console.log(`[${s.network}] Cat: "${s.category}" (Slug: ${s.categorySlug}) | [${s.externalId}] ${s.name}`);
  }
}
