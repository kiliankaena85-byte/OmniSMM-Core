/**
 * (c) 2024-2026 SMMplan. All rights reserved.
 * 
 * POST-SYNC RULES ENGINE
 * ========================
 * Этот файл — единый источник правил, которые АВТОМАТИЧЕСКИ применяются
 * после каждой синхронизации каталога (и CLI, и admin panel).
 * 
 * Правила зафиксированы здесь, а не в базе, чтобы:
 * 1. Они не терялись при пересинке / wipe базы
 * 2. Были видны в git history
 * 3. Не нужно было повторять ручные фиксы
 * 
 * ДОБАВЛЕНИЕ НОВЫХ ПРАВИЛ:
 * - Блеклист услуг: добавить externalId в BLACKLISTED_SERVICES
 * - Скрытие (но не удаление): добавить externalId в HIDDEN_SERVICES
 * - Переклассификация: добавить запись в RECLASSIFY_RULES
 * - Лимиты: обновить MAX_QTY_CAP
 */

import { db } from '@/lib/db';
import { CatalogLockGuard } from '@/lib/catalog-lock';


// ============================================
// CONFIGURATION
// ============================================

/** Услуги, которые НИКОГДА не должны импортироваться (удаляются при синке) */
const BLACKLISTED_SERVICES: string[] = [
  // Wibes — мёртвая платформа
  '3068', '3072', '3073', '3071', '3070',
];

/** Услуги, которые импортируются, но скрываются (isActive=false) */
const HIDDEN_SERVICES: string[] = [
  // Жалобы / Reports — юридический риск (ст.272, 306 УК РФ)
  '2392', // Жалоба [Без причины]
  '2402', // Жалоба [Авторское право]
  '2404', // Жалоба [Другое]
  '2398', // Жалоба [Насилие]
  '2400', // Жалоба [Порнография]
  '2394', // Жалоба [Спам]
  '2396', // Жалоба [Фейк]

  // Непонятные названия
  '2284', // "Активность для услуги ID2283 [Читать описание]"
];

/** Максимальное количество для заказа (cap для INT_MAX от провайдера) */
const MAX_QTY_CAP = 10_000_000;

/**
 * Правила переклассификации: externalId → { network, category }
 * Применяются ПОСЛЕ основного анализатора SmartAnalyzerLogic.
 * Если анализатор ошибся — правило перезаписывает результат.
 */
const RECLASSIFY_RULES: Record<string, { network: string; category: string }> = {
  // Instagram Сохранения — анализатор путает с Лайками
  '991':  { network: 'INSTAGRAM', category: '📌 Сохранения' },

  // TikTok Сохранения — аналогично
  '1479': { network: 'TIKTOK',    category: '📌 Сохранения' },

  // Spotify Сохранения
  '2366': { network: 'SPOTIFY',   category: '📌 Сохранения' },

  // Likee Подписчики — анализатор бросает в Лайки из-за "Likee"
  '2486': { network: 'LIKEE',     category: '👨‍👩‍👧‍👦 Подписчики / Участники' },
  '2492': { network: 'LIKEE',     category: '👨‍👩‍👧‍👦 Подписчики / Участники' },

  // VK Play Зрители — должны быть в Стримах, не Прослушиваниях
  '1829': { network: 'VK',        category: '🔴 Стримы' },
  '1830': { network: 'VK',        category: '🔴 Стримы' },
  '1831': { network: 'VK',        category: '🔴 Стримы' },
  '1832': { network: 'VK',        category: '🔴 Стримы' },

  // VK Play Подписчики
  '1833': { network: 'VK',        category: '👨‍👩‍👧‍👦 Подписчики / Участники' },

  // VK Просмотры — анализатор бросает в Прослушивания из-за "play"
  '2382': { network: 'VK',        category: '👁 Просмотры / Охват' },
  '1803': { network: 'VK',        category: '👁 Просмотры / Охват' },
  '1804': { network: 'VK',        category: '👁 Просмотры / Охват' },
  '2755': { network: 'VK',        category: '👁 Просмотры / Охват' },

  // Telegram Premium Участники — попадают в Просмотры из-за "+Просмотры" в названии
  '1763': { network: 'TELEGRAM',  category: '💎 Premium Подписчики' },
  '2079': { network: 'TELEGRAM',  category: '💎 Premium Подписчики' },
  '2077': { network: 'TELEGRAM',  category: '💎 Premium Подписчики' },
  '2072': { network: 'TELEGRAM',  category: '💎 Premium Подписчики' },
};

// ============================================
// ENGINE
// ============================================

interface PostSyncResult {
  blacklisted: number;
  hidden: number;
  reclassified: number;
  capped: number;
  emptyCategoriesRemoved: number;
}

/**
 * Применяет все пост-синк правила к базе.
 * Вызывать ПОСЛЕ завершения синхронизации.
 */
export async function applyPostSyncRules(tenantId: string = 'smmplan'): Promise<PostSyncResult> {
  const result: PostSyncResult = {
    blacklisted: 0,
    hidden: 0,
    reclassified: 0,
    capped: 0,
    emptyCategoriesRemoved: 0,
  };

  // 1. Inviolable Database Guard: If catalog is locked, NEVER delete services, reclassify, or mutate categories
  const isCatalogLocked = await CatalogLockGuard.isLocked();
  if (isCatalogLocked) {
    const capResult = await db.service.updateMany({
      where: { tenantId, maxQty: { gt: MAX_QTY_CAP } },
      data: { maxQty: MAX_QTY_CAP },
    });
    result.capped = capResult.count;
    return result;
  }

  // 2. Заблокированные — мягкое отключение (INV-CAT-02: строки витрины автоматика НЕ удаляет:
  //    FK Order.serviceId + история цен/аудита)
  if (BLACKLISTED_SERVICES.length > 0) {
    const r = await db.service.updateMany({
      where: { tenantId, externalId: { in: BLACKLISTED_SERVICES } },
      data: { isActive: false },
    });
    result.blacklisted = r.count;
  }

  // 3. Скрыть опасные/непонятные
  if (HIDDEN_SERVICES.length > 0) {
    const r = await db.service.updateMany({
      where: { tenantId, externalId: { in: HIDDEN_SERVICES } },
      data: { isActive: false },
    });
    result.hidden = r.count;
  }


  // Preload all categories and networks into Map to eliminate N+1 queries (DEF-005)

  const [allCategories, allNetworks] = await Promise.all([
    db.category.findMany({ where: { tenantId } }),
    db.network.findMany(),
  ]);

  const categoryMap = new Map<string, (typeof allCategories)[0]>();
  for (const cat of allCategories) {
    categoryMap.set(`${cat.networkId}:${cat.name}`, cat);
  }

  const networkMap = new Map(allNetworks.map(n => [n.name, n]));

  async function getOrCreateCategory(name: string, networkId: string) {
    const key = `${networkId}:${name}`;
    let cat = categoryMap.get(key);
    if (!cat) {
      cat = await db.category.create({
        data: { name, networkId, sort: 0, tenantId },
      });
      categoryMap.set(key, cat);
    }
    return cat;
  }

  // 3. Применить переклассификацию
  for (const [extId, rule] of Object.entries(RECLASSIFY_RULES)) {
    const network = networkMap.get(rule.network);
    if (!network) continue;

    const category = await getOrCreateCategory(rule.category, network.id);

    const r = await db.service.updateMany({
      where: { tenantId, externalId: extId },
      data: { categoryId: category.id },
    });
    result.reclassified += r.count;
  }

  // 3.5 Динамическое выделение Автоуслуг и исправление мискатегоризаций
  const servicesToCheck = await db.service.findMany({ where: { tenantId }, include: { category: { include: { network: true } } } });
  let autoReclassified = 0;
  for (const s of servicesToCheck) {
    if (!s.category || !s.category.networkId) continue;
    const n = s.name.toLowerCase();
    const isAuto = n.includes('авто') || n.includes('auto') || n.includes('последн') || n.includes('будущ') || n.includes('на 5 пост') || n.includes('на 10 пост') || n.includes('на 50 пост') || n.includes('на 100 пост') || n.includes('7 дней') || n.includes('7 дн') || n.includes('30 дн') || n.includes('подписк на');
    
    let targetCatName: string | null = null;
    const netName = s.category?.network?.name;

    // Исправление: VK Автопросмотры из Голосований
    if (netName === 'VK' && s.category.name.includes('Голос') && isAuto && n.includes('просмотр')) {
        targetCatName = '👁 Автопросмотры';
    } 
    // Исправление: VK 150 зрителей стрима (содержит "Премиум" и "зрител")
    else if (netName === 'VK' && s.category.name.includes('Premium') && n.includes('зрител')) {
        targetCatName = '🔴 Стримы';
    }
    // Исправление: TG Репорты разлетелись
    else if (netName === 'TELEGRAM' && n.includes('репорт')) {
        targetCatName = '🚫 Жалобы / Reports';
    }
    // Исправление: TG Реакции "Признательный буст"
    else if (netName === 'TELEGRAM' && s.category.name.includes('Буст') && n.includes('реакци')) {
        targetCatName = '🎭 Реакции / Эмодзи';
    }
    // Исправление: Премиум просмотры на 5 постов
    else if (netName === 'TELEGRAM' && s.category.name.includes('Буст') && n.includes('просмотр')) {
        targetCatName = '👁 Автопросмотры';
    }
    else if (isAuto) {
        if (s.category.name === '👁 Просмотры / Охват') targetCatName = '👁 Автопросмотры';
        else if (s.category.name === '❤️ Лайки / Нравится') targetCatName = '❤️ Автолайки';
        else if (s.category.name === '📢 Репосты / Поделиться') targetCatName = '📢 Авторепосты';
        else if (s.category.name === '🎭 Реакции / Эмодзи') targetCatName = '🎭 Автореакции';
    }

    if (targetCatName && s.category.name !== targetCatName) {
      const category = await getOrCreateCategory(targetCatName, s.category.networkId);
      await db.service.update({
        where: { id: s.id },
        data: { categoryId: category.id }
      });
      autoReclassified++;
    }
  }
  result.reclassified += autoReclassified;

  // 4. Cap maxQty
  const capResult = await db.service.updateMany({
    where: { tenantId, maxQty: { gt: MAX_QTY_CAP } },
    data: { maxQty: MAX_QTY_CAP },
  });
  result.capped = capResult.count;

  // 5. Preserve empty categories — automated deletion is disabled
  // Empty categories created by administrators in Admin Panel must be preserved.
  result.emptyCategoriesRemoved = 0;

  return result;

}
