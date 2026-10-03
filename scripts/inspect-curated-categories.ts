import fs from 'fs';
import path from 'path';

const catalogPath = path.resolve('docs/CURATED_SERVICES_400.json');
const items = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const catMap = new Map<string, { count: number; network: string; sample: string }>();

for (const it of items) {
  const key = `${it.network} ::: ${it.category}`;
  const curr = catMap.get(key) || { count: 0, network: it.network, sample: it.name };
  curr.count++;
  catMap.set(key, curr);
}

console.log(`Total Curated Services: ${items.length}`);
console.log(`Total Categories: ${catMap.size}\n`);
for (const [k, v] of catMap.entries()) {
  console.log(`[${v.network}] ${k.split(' ::: ')[1]} (${v.count} services) - e.g. ${v.sample.slice(0, 50)}`);
}
