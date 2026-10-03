/**
 * (c) 2024-2026 SMMplan. All rights reserved.
 * 
 * ЕДИНЫЙ ИСТОЧНИК ФИНАНСОВЫХ КОНСТАНТ ПЛАТФОРМЫ
 * =============================================
 * Все налоговые ставки, комиссии и наценки определяются ТОЛЬКО здесь.
 * Любой другой файл ОБЯЗАН импортировать константы из этого модуля.
 * 
 * Правовая основа: УСН 6% + НДС 5% (спецставка), ФЗ №176-ФЗ
 * Верифицировано: апрель 2026
 */

// ═══════════════════════════════════════════════════════
// 💰 НАЛОГИ (Россия, 2026)
// ═══════════════════════════════════════════════════════

/** УСН «Доходы» — 6% с полной суммы поступления (до вычета комиссий) */
const TAX_USN_INCOME_RATE = 0.06;

/** НДС спецставка для УСН при обороте 20–272.5 млн руб./год */
const TAX_VAT_USN_SPECIAL_RATE = 0.05;

// ═══════════════════════════════════════════════════════
// 💳 ЭКВАЙРИНГ (Payment Gateways)
// ═══════════════════════════════════════════════════════

/** YooKassa — карты РФ (safe-константа, верхняя граница 2.8–3.5%) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ACQUIRING_YOOKASSA_CARDS = 0.035;

/** Safe-константа для расчётов: максимальная комиссия шлюза */
const ACQUIRING_SAFE_MAX = 0.035;

// ═══════════════════════════════════════════════════════
// 📊 НАЦЕНКИ (Markup)
// ═══════════════════════════════════════════════════════

/**
 * Абсолютный нижний порог защиты (Safety Floor) по стандарту Овнера:
 * 3.0 = 200% минимальная маржа поверх себестоимости (розница = себестоимость × 3.0).
 */
export const SAFETY_FLOOR_MARKUP = 3.0;

/** Максимальный множитель наценки (x151 = 15000%) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MAX_MARKUP_MULTIPLIER = 151.0;

/** L-07: Максимальная суммарная скидка (Loyalty + Promo) в процентах.
 *  Предотвращает стекинг до 50–60% и продажу ниже себестоимости. */
export const MAX_TOTAL_DISCOUNT = 30;

// ═══════════════════════════════════════════════════════
// 🌐 ВАЛЮТА
// ═══════════════════════════════════════════════════════

/** Буфер на банковский спред при конвертации USD → RUB */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CURRENCY_SPREAD_BUFFER = 0.03;

// ═══════════════════════════════════════════════════════
// 📐 SYNC ENGINE
// ═══════════════════════════════════════════════════════

/** Anti-Jitter: порог минимального изменения цены при синхронизации.
 *  Изменения < 5% от текущей цены игнорируются для стабильности витрины. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SYNC_JITTER_THRESHOLD = 0.05;

/** Anomaly Detector: изменение rate > 20% считается аномалией и генерирует алерт */
export const SYNC_ANOMALY_THRESHOLD = 0.20;

/** Active Quarantine Threshold: скачок себестоимости > 50% автоматически изолирует услугу в карантин */
export const ANOMALY_PRICE_SPIKE_THRESHOLD = 0.50;

/** Верхний предел разумной себестоимости закупки (RUB за 1000 единиц) для защиты от валютных аномалий: 500 000 ₽/1k (= 500 ₽/шт) */
export const UPPER_SANITY_LIMIT_RUB = 500000;

/**
 * INV-CAT-01 (SPEC-REDTEAM-FIN-CORE-2026): коридор адекватности курса USD/RUB для фоновой
 * сверки цен. Курс вне коридора = битые входные данные (сбой ЦБ/прокси/парсинга) →
 * RECONCILE_PRICES прерывается ДО любых мутаций витрины. Коридор намеренно широкий
 * (×0.25…×2.5 от текущего уровня), пересматривается при структурном сдвиге курса.
 */
export const USD_RUB_SANITY_MIN = 30;
export const USD_RUB_SANITY_MAX = 300;

// ═══════════════════════════════════════════════════════
// 🪜 PRICING LADDER (Лестница наценок по умолчанию)
// ═══════════════════════════════════════════════════════

export interface LadderLevel {
  /** Верхняя граница закупочной цены (RUB/1000) для этого уровня */
  threshold: number;
  /** Множитель наценки */
  multiplier: number;
  /** Фиксированная надбавка в RUB (для micro-услуг) */
  fixedMarkup: number;
}

/**
 * Лестница наценок v1 для SMMplan.
 * Адаптивная: дешёвые услуги получают высокий множитель,
 * дорогие — умеренный. fixedMarkup = 0 для простоты на старте.
 * 
 * cost (RUB/1k) → multiplier → Пример ($0.01 → 0.95₽ по курсу 95)
 * < 1₽           → x50       → 50₽ (вместо 3₽ при flat x3)
 * 1–10₽          → x11       → 110₽ максимум
 * 10–50₽         → x8        → 400₽ максимум
 * 50–150₽        → x6        → 900₽ максимум
 * > 150₽         → x4        → масштабируемо
 */
const DEFAULT_PRICING_LADDER: LadderLevel[] = [
  { threshold: 1,        multiplier: 50, fixedMarkup: 0 },
  { threshold: 10,       multiplier: 11, fixedMarkup: 0 },
  { threshold: 50,       multiplier: 8,  fixedMarkup: 0 },
  { threshold: 150,      multiplier: 6,  fixedMarkup: 0 },
  { threshold: Infinity, multiplier: 4,  fixedMarkup: 0 },
];

// ═══════════════════════════════════════════════════════
// 🧮 ВЫЧИСЛЯЕМЫЕ ЗНАЧЕНИЯ
// ═══════════════════════════════════════════════════════

/** Суммарные налоги с выручки (УСН + НДС спецставка) */
const TOTAL_TAX_FROM_REVENUE = TAX_USN_INCOME_RATE + TAX_VAT_USN_SPECIAL_RATE; // 0.11

/** Суммарные обязательные отчисления с выручки (Налоги + Эквайринг) */
export const TOTAL_MANDATORY_DEDUCTIONS = TOTAL_TAX_FROM_REVENUE + ACQUIRING_SAFE_MAX; // 0.145

/**
 * Вычисляет минимальную розничную цену, гарантирующую покрытие налогов,
 * эквайринга и целевую маржу поверх себестоимости провайдера.
 * 
 * Формула: SafetyPrice = Cost × (1 + SAFETY_FLOOR_MARKUP) / (1 − TOTAL_MANDATORY_DEDUCTIONS)
 * При defaults: cost × 2.0 / 0.855 ≈ cost × 2.34
 * 
 * @param providerCostCents — себестоимость провайдера в ЦЕНТАХ
 * @returns минимальная допустимая розничная цена в ЦЕНТАХ
 */
export function calculateSafetyFloorCents(providerCostCents: number): number {
  if (providerCostCents <= 0) return 0;
  const safetyCents = (providerCostCents * (1 + SAFETY_FLOOR_MARKUP)) / (1 - TOTAL_MANDATORY_DEDUCTIONS);
  return Math.ceil(safetyCents); // Округляем вверх до целого цента
}

/**
 * Применяет Pricing Ladder к закупочной цене.
 * Находит подходящий уровень и возвращает розничную цену.
 * 
 * @param providerCostRubPer1000 — цена провайдера в RUB за 1000 (float)
 * @param ladder — лестница наценок (по умолчанию DEFAULT_PRICING_LADDER)
 * @returns розничная цена в RUB за 1000
 */
export function applyPricingLadder(
  providerCostRubPer1000: number,
  ladder: LadderLevel[] = DEFAULT_PRICING_LADDER
): number {
  if (providerCostRubPer1000 <= 0) return 0;
  
  const level = ladder.find(l => providerCostRubPer1000 < l.threshold) || ladder[ladder.length - 1];
  const rawPrice = providerCostRubPer1000 * level.multiplier + level.fixedMarkup;
  
  // Добавляем буфер платежного шлюза
  const withGateway = rawPrice * (1 + ACQUIRING_SAFE_MAX);
  
  return withGateway;
}

/**
 * Психологическое округление розничных цен.
 * Для цен < 1000₽/1000 — округляем до кратного 10 вверх.
 * Для цен ≥ 1000₽/1000 — округляем до кратного 100 вверх.
 * 
 * @param priceRubPer1000 — цена в RUB за 1000
 * @returns красиво округлённая цена
 */
export function applyBeautifulRounding(priceRubPer1000: number): number {
  if (priceRubPer1000 <= 0) return 0;
  
  // Clean up floating point precision jitter (e.g. 220.00000000000003 -> 220)
  const cleanedPrice = Math.round(priceRubPer1000 * 100000) / 100000;
  
  if (cleanedPrice < 1000) {
    return Math.ceil(cleanedPrice / 10) * 10;
  }
  return Math.ceil(cleanedPrice / 100) * 100;
}

export interface SanityCheckResult {
  isExceeded: boolean;
  price: number;
  limit: number;
  clampedPrice: number;
}

/**
 * Проверяет цену на непревышение верхнего порога адекватности (UPPER_SANITY_LIMIT_RUB = 50000).
 * Если расчетная цена превышает лимит, возвращает флаг isExceeded: true.
 *
 * @param priceRub - расчетная цена в RUB
 * @param limit - порог адекватности (по умолчанию UPPER_SANITY_LIMIT_RUB)
 */
export function checkPriceSanityLimit(
  priceRub: number,
  limit: number = UPPER_SANITY_LIMIT_RUB
): SanityCheckResult {
  const isExceeded = typeof priceRub === 'number' && isFinite(priceRub) && priceRub > limit;
  return {
    isExceeded,
    price: priceRub,
    limit,
    clampedPrice: isExceeded ? limit : priceRub
  };
}

export interface PricingLadderResult {
  retailPrice: number;
  isSanityLimitExceeded: boolean;
  sanityLimit: number;
  multiplier: number;
}

/**
 * Применяет Pricing Ladder и проверяет розничную цену на непревышение порога адекватности.
 */
export function applyPricingLadderWithSanity(
  providerCostRubPer1000: number,
  ladder: LadderLevel[] = DEFAULT_PRICING_LADDER,
  sanityLimit: number = UPPER_SANITY_LIMIT_RUB
): PricingLadderResult {
  const retailPrice = applyPricingLadder(providerCostRubPer1000, ladder);
  const sanity = checkPriceSanityLimit(retailPrice, sanityLimit);
  const level = ladder.find(l => providerCostRubPer1000 < l.threshold) || ladder[ladder.length - 1];

  return {
    retailPrice,
    isSanityLimitExceeded: sanity.isExceeded,
    sanityLimit,
    multiplier: level.multiplier
  };
}

