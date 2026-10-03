import fs from 'fs';
import path from 'path';

const catalogPath = path.resolve('docs/CURATED_SERVICES_400.json');
const items = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const brandRegex = /\b(?:soc[- ]?rocket|vexboost|stream[- ]?promotion|smmprime|smm[- ]?prime|smm[- ]?panel[- ]?us|prosmm[- ]?shop|prosmm)\b/i;
const htmlEntityRegex = /&(?:amp;|quot;|#\d+;|lt;|gt;)/;
const techTagRegex = /\[\s*(?:\d+-\d+\/[ЧМчмHDhd]|\d+[КkK]?\/[ДдDdHhЧч]|MQ|S\d+|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\s*\]/i;

let brandCount = 0;
let htmlCount = 0;
let tagCount = 0;

for (const it of items) {
  if (brandRegex.test(it.name)) {
    brandCount++;
    console.log(`Brand in name: ${it.name}`);
  }
  if (htmlEntityRegex.test(it.name)) {
    htmlCount++;
    console.log(`HTML entity in name: ${it.name}`);
  }
  if (techTagRegex.test(it.name)) {
    tagCount++;
    console.log(`Tech tag in name: ${it.name}`);
  }
}

console.log(`\nIn CURATED_SERVICES_400.json:`);
console.log(`Brands in names: ${brandCount}`);
console.log(`HTML entities in names: ${htmlCount}`);
console.log(`Tech tags in names: ${tagCount}`);
