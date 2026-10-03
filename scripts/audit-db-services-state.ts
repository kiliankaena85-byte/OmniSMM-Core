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

  console.log(`Total services in DB: ${services.length}`);

  let providerBrandsFound = 0;
  let htmlEntitiesFound = 0;
  let technicalTagsFound = 0;
  let commentsFound = 0;
  let pollsFound = 0;
  let privateFound = 0;

  const brandRegex = /\b(?:soc[- ]?rocket|vexboost|stream[- ]?promotion|smmprime|smm[- ]?prime|smm[- ]?panel[- ]?us|prosmm[- ]?shop|prosmm)\b/i;
  const htmlEntityRegex = /&(?:amp;|quot;|#\d+;|lt;|gt;)/;
  const techTagRegex = /\[\s*(?:\d+-\d+\/[ЧМчмHDhd]|\d+[КkK]?\/[ДдDdHhЧч]|MQ|S\d+|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\s*\]/i;

  for (const s of services) {
    if (brandRegex.test(s.name) || (s.description && brandRegex.test(s.description))) {
      providerBrandsFound++;
    }
    if (htmlEntityRegex.test(s.name) || (s.description && htmlEntityRegex.test(s.description))) {
      htmlEntitiesFound++;
    }
    if (techTagRegex.test(s.name)) {
      technicalTagsFound++;
    }
    const catName = s.category.name.toLowerCase();
    const sName = s.name.toLowerCase();
    if (catName.includes('коммент') || sName.includes('коммент')) {
      commentsFound++;
    }
    if (catName.includes('опрос') || catName.includes('голос') || sName.includes('опрос') || sName.includes('голос')) {
      pollsFound++;
    }
    if (sName.includes('закрыт') || sName.includes('private') || sName.includes('/c/')) {
      privateFound++;
    }
  }

  console.log(`Provider Brands in Services: ${providerBrandsFound}`);
  console.log(`HTML Entities in Services: ${htmlEntitiesFound}`);
  console.log(`Technical Tags in Services: ${technicalTagsFound}`);
  console.log(`Comments Services: ${commentsFound} (current customDataType TEXTAREA: ${services.filter(s => s.customDataType === 'TEXTAREA').length})`);
  console.log(`Polls Services: ${pollsFound} (current customDataType NUMBER: ${services.filter(s => s.customDataType === 'NUMBER').length})`);
  console.log(`Private Services: ${privateFound}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
