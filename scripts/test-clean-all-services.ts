import 'dotenv/config';
import { db } from '../src/lib/db';

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanServiceName(name: string, shadowName?: string | null): string {
  // If original name has truncation '...', try to use shadowName if available
  let text = name;
  if (text.includes('...') && shadowName && shadowName.length > text.length - 15) {
    // shadowName doesn't have the tier badge, so extract existing tier badge
    const tierMatch = text.match(/\[(Эконом|Стандарт|Премиум|VIP)\]$/i);
    text = shadowName + (tierMatch ? ` [${tierMatch[1]}]` : '');
  }

  let cleaned = decodeHtmlEntities(text);

  // 1. Remove Provider Brands
  const providerRegex = /\b(?:soc[- ]?rocket|vexboost|stream[- ]?promotion|smmprime|smm[- ]?prime|smm[- ]?panel[- ]?us|smmpanelus|prosmm[- ]?shop|prosmm)\b/gi;
  cleaned = cleaned.replace(providerRegex, '');

  // 2. Remove Technical IDs and leading numbers like "ID1238 ", "928. "
  cleaned = cleaned.replace(/^\s*(?:id\s*\d+|\d+\.)\s*/i, '');

  // 3. Clean internal provider tags inside brackets
  // E.g. "| S4", "| S2", "| S3", "| B2", "| MQ", "MQ |", "База #1", "Сервер: 1"
  cleaned = cleaned.replace(/\|\s*(?:S\d+|B\d+|MQ|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\b/gi, '');
  cleaned = cleaned.replace(/\b(?:S\d+|B\d+|MQ|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\s*\|/gi, '');
  cleaned = cleaned.replace(/\[\s*(?:S\d+|B\d+|MQ|База\s*#?\d+|Сервер\s*#?:?\s*\d+)\s*\]/gi, '');

  // 4. Remove speed and capacity tags: [0-1/Ч], [0-15/М], [100К/Д], [1000/day], etc.
  cleaned = cleaned.replace(/\[\s*\d+-\d+\/[ЧМчмHDhd]\s*\]/gi, '');
  cleaned = cleaned.replace(/\[\s*\d+[КkK]?\/[ДдDdHhЧч]\s*\]/gi, '');
  cleaned = cleaned.replace(/\[\s*\d+\/(?:day|stream)\s*\]/gi, '');

  // Remove speed/capacity inside pipe lists: " | 0-1/Ч | ", " | 100К/Д | "
  cleaned = cleaned.replace(/\|\s*\d+-\d+\/[ЧМчмHDhd]\s*\|/gi, '|');
  cleaned = cleaned.replace(/\|\s*\d+[КkK]?\/[ДдDdHhЧч]\s*\|/gi, '|');
  cleaned = cleaned.replace(/\|\s*\d+-\d+\/[ЧМчмHDhd]\s*/gi, '');
  cleaned = cleaned.replace(/\|\s*\d+[КkK]?\/[ДдDdHhЧч]\s*/gi, '');
  cleaned = cleaned.replace(/\s*\d+-\d+\/[ЧМчмHDhd]\s*\|/gi, '');
  cleaned = cleaned.replace(/\s*\d+[КkK]?\/[ДдDdHhЧч]\s*\|/gi, '');

  // 5. Clean up pipe residues inside brackets: "[ | ... ]" or "[ ... | ]"
  cleaned = cleaned.replace(/\[\s*\|\s*/g, '[');
  cleaned = cleaned.replace(/\s*\|\s*\]/g, ']');
  cleaned = cleaned.replace(/\|\s*\|+/g, '|');

  // 6. Clean up empty brackets and parentheses
  cleaned = cleaned.replace(/\[\s*\]/g, '');
  cleaned = cleaned.replace(/\(\s*\)/g, '');

  // 7. Clean up ellipsis artifacts like "... [Эконом]" or "Возм..."
  cleaned = cleaned.replace(/\.{2,}/g, '');

  // 8. Normalise whitespace and punctuation
  cleaned = cleaned.replace(/\s{2,}/g, ' ');
  cleaned = cleaned.replace(/\|\s*\|/g, '|');
  cleaned = cleaned.replace(/\[\s*\|\s*/g, '[');
  cleaned = cleaned.replace(/\s*\|\s*\]/g, ']');
  cleaned = cleaned.replace(/^[\s\-_—·|]+|[\s\-_—·|]+$/g, '');

  return cleaned.trim();
}

async function main() {
  const services = await db.service.findMany({
    include: {
      category: {
        include: { network: true }
      }
    },
    take: 30
  });

  for (const s of services) {
    const shadow = s.providerId && s.externalId
      ? await db.shadowService.findFirst({ where: { providerId: s.providerId, externalId: s.externalId } })
      : null;

    const cleaned = cleanServiceName(s.name, shadow?.name);
    console.log(`BEFORE: ${s.name}`);
    console.log(`AFTER:  ${cleaned}\n`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
