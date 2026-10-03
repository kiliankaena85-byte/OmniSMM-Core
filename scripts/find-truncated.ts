import fs from 'fs';

const items = JSON.parse(fs.readFileSync('docs/CURATED_SERVICES_400.json', 'utf8'));
for (const it of items) {
  if (it.name.includes('...')) {
    console.log('Truncated item:');
    console.log(JSON.stringify(it, null, 2));
  }
}
