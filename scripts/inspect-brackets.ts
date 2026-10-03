import fs from 'fs';
import path from 'path';

const catalogPath = path.resolve('docs/CURATED_SERVICES_400.json');
const items = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const bracketContents = new Set<string>();
for (const it of items) {
  const matches = it.name.match(/\[([^\]]+)\]/g);
  if (matches) {
    matches.forEach((m: string) => bracketContents.add(m));
  }
}

console.log(`Found ${bracketContents.size} unique bracket tags:`);
console.log(Array.from(bracketContents).sort().slice(0, 100));
