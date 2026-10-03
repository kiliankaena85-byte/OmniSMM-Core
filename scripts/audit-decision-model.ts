import 'dotenv/config';
import { db } from '../src/lib/db';
import fs from 'fs';
import { decodeHtmlEntities, cleanServiceName } from './decision-arbiter';

interface ServiceItem {
  id: string;
  numericId: number;
  name: string;
  network: string;
  networkSlug: string;
  category: string;
  categorySlug: string;
  externalId: string | null;
  providerId: string | null;
  customDataType: string;
  isPrivate: boolean;
}

const services: ServiceItem[] = JSON.parse(fs.readFileSync('docs/CURATED_SERVICES_400.json', 'utf8'));

// Helper to determine real activity from name & shadow service
function classifyActivity(name: string, cat: string): string {
  const n = name.toLowerCase();
  
  if (n.includes('прослушиван') || n.includes('плейлист') || n.includes('трек') || n.includes('музык') || n.includes('spotify') || n.includes('альбом')) {
    return 'MUSIC';
  }
  if (n.includes('коммент') || n.includes('comment') || n.includes('отзыв')) {
    return 'COMMENTS';
  }
  if (n.includes('опрос') || n.includes('голос') || n.includes('vote') || n.includes('poll')) {
    return 'POLLS';
  }
  if (n.includes('репост') || n.includes('поделит') || n.includes('share') || n.includes('retweet')) {
    return 'REPOSTS';
  }
  if (n.includes('клики') || n.includes('посещен') || n.includes('вовлеченност') || n.includes('переход') || n.includes('engagement')) {
    return 'CLICKS';
  }
  if (n.includes('чат-бот') || n.includes('чат бот')) {
    return 'CHAT_BOTS';
  }
  if (n.includes('зрител') || n.includes('стрим') || n.includes('эфир') || n.includes('трансляц') || n.includes('live')) {
    if (n.includes('лайк') && n.includes('live')) {
      return 'STREAM_LIKES';
    }
    return 'STREAMS';
  }
  if (n.includes('буст') || n.includes('boost')) {
    return 'BOOSTS';
  }
  if (n.includes('реакци') || n.includes('reaction') || n.includes('эмодзи') || n.includes('👍') || n.includes('❤️') || n.includes('🔥') || n.includes('🎉') || n.includes('позитивные') || n.includes('негативные') || n.includes('дизлайк') || n.includes('в топ')) {
    return 'REACTIONS_OR_LIKES';
  }
  if (n.includes('лайк') || n.includes('like')) {
    return 'LIKES';
  }
  if (n.includes('просмотр') || n.includes('views') || n.includes('глазик') || n.includes('охват')) {
    if (n.includes('авто')) return 'AUTO_VIEWS';
    return 'VIEWS';
  }
  if (n.includes('подписчик') || n.includes('фолловер') || n.includes('subscribers') || n.includes('follower') || n.includes('участник') || n.includes('members')) {
    if (n.includes('premium') || n.includes('премиум')) {
      // Check if it's Telegram Premium with boosts/stars or regular
      if (n.includes('звезд') || n.includes('буст') || n.includes('3 дня') || n.includes('7 дней') || n.includes('30 дней') || n.includes('60 дней') || n.includes('tg premium') || n.includes('telegram премиум')) {
        return 'TELEGRAM_PREMIUM';
      }
    }
    return 'SUBSCRIBERS';
  }

  // Fallback
  return 'OTHER';
}

async function main() {
  console.log(`=== RUNNING DECISION MODEL AUDIT ON ${services.length} SERVICES ===\n`);

  let mismatches = 0;
  let brandsFound = 0;
  let htmlEntities = 0;
  let truncatedFound = 0;

  const results: any[] = [];

  for (const s of services) {
    const activity = classifyActivity(s.name, s.category);
    let isMismatch = false;
    let recommendedCategory = s.category;

    // Check Category Activity Invariants
    if (s.category === 'Подписчики') {
      if (activity === 'LIKES' || activity === 'REACTIONS_OR_LIKES' || activity === 'VIEWS' || activity === 'STREAM_LIKES') {
        isMismatch = true;
        recommendedCategory = activity === 'VIEWS' ? 'Просмотры' : 'Лайки';
      }
    } else if (s.category === 'Фолловеры') {
      if (activity === 'VIEWS' || activity === 'STREAMS') {
        isMismatch = true;
        recommendedCategory = activity === 'STREAMS' ? 'Зрители на Стрим' : 'Просмотры';
      }
    } else if (s.category === 'Комментарии') {
      if (activity === 'VIEWS') {
        isMismatch = true;
        recommendedCategory = 'Просмотры';
      }
    } else if (s.category === 'Прослушивания') {
      if (activity === 'VIEWS' || activity === 'AUTO_VIEWS' || activity === 'CLICKS') {
        isMismatch = true;
        recommendedCategory = activity === 'AUTO_VIEWS' ? 'Автоуслуги' : 'Просмотры';
      }
    } else if (s.category === 'Зрители на Стрим') {
      if (activity === 'VIEWS' && !s.name.toLowerCase().includes('стрим') && !s.name.toLowerCase().includes('трансляц') && !s.name.toLowerCase().includes('live')) {
        isMismatch = true;
        recommendedCategory = 'Просмотры';
      }
    } else if (s.category === 'Подписчики премиум') {
      // Must be Telegram Premium account (yielding boosts)
      if (activity !== 'TELEGRAM_PREMIUM' && (s.name.includes('Индия') || s.name.includes('Турбо') || !s.name.toLowerCase().includes('премиум'))) {
        isMismatch = true;
        recommendedCategory = 'Подписчики';
      }
    }

    if (isMismatch) {
      mismatches++;
      console.log(`[MISMATCH #${mismatches}] Network: ${s.network} | Current Cat: "${s.category}"`);
      console.log(`  Service: [${s.numericId}] "${s.name}"`);
      console.log(`  Detected Activity: ${activity} => Recommended Cat: "${recommendedCategory}"\n`);
    }

    // Check White-Label
    const brandRegex = /\b(?:soc[- ]?rocket|vexboost|stream[- ]?promotion|smmprime|smm[- ]?prime|smm[- ]?panel[- ]?us|smmpanelus|prosmm[- ]?shop|prosmm)\b/i;
    if (brandRegex.test(s.name)) {
      brandsFound++;
    }

    // Check HTML entities
    if (/&(?:amp;|quot;|#\d+;|lt;|gt;)/.test(s.name)) {
      htmlEntities++;
    }

    // Check Truncation
    if (s.name.includes('...')) {
      truncatedFound++;
    }
  }

  console.log('========================================');
  console.log('DECISION MODEL AUDIT SUMMARY:');
  console.log(`Total Services Audited: ${services.length}`);
  console.log(`Category Invariant Mismatches: ${mismatches}`);
  console.log(`Provider Brands Detected: ${brandsFound}`);
  console.log(`HTML Entities Detected: ${htmlEntities}`);
  console.log(`Truncated Names Detected: ${truncatedFound}`);
  console.log('========================================');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
