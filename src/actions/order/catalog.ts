'use server';

import { db } from "@/lib/db";
import { IntelligencePlatform } from "@/services/analyzer/link-rules";
import { applyBeautifulRounding, SAFETY_FLOOR_MARKUP } from "@/lib/financial-constants";
import { getCostRub } from "@/lib/pricing/currency-invariant";
import { applyAntiNegativeMargin } from "@/lib/pricing/anti-negative-margin";
import { SettingsProvider } from "@/lib/settings";
import { unstable_cache } from "next/cache";
import { tenantVisibilityFilter, normalizeTenantId } from "@/lib/tenant-scope";

import { sanitizeServiceDescription } from "@/lib/sanitize";
import { logger } from "@/lib/logger";
import { SmartAnalyzerLogic } from "@/services/providers/smart-analyzer.logic";
import { resolveServiceTargetType } from "@/utils/target-type-mapper";
import {
  getCachedNetworksWithRedis,
  getCachedCategoryServicesWithRedis,
  getCachedPublicCatalogWithRedis,
  getCachedProcessedServicesWithRedis,
  invalidateL1CatalogCache as clearCatalogL1Cache,
  invalidateCatalogCache,
} from "@/services/catalog/catalog-cache.service";

export { clearCatalogL1Cache, invalidateCatalogCache };

/**
 * AUD-05 (3.1): shared visibility condition for storefront taxonomy.
 * A network shows a category only if the category AND at least one of its
 * active services belong to the current tenant (or are shared as 'all').
 * Without the tenant check on both levels the tree shows "ghost" categories
 * that open into an empty services list.
 *
 * FIX(BUG-B2): добавлена проверка cooldownUntil — ровно та же, что и в
 * getCachedServicesByCategory. Раньше категория, у которой все услуги были
 * в cooldown, проходила проверку видимости (services.some без cooldown),
 * отображалась в шаге 2 визарда, а шаг 3 показывал «В выбранной категории
 * нет доступных активных услуг». Условия видимости дерева и списка услуг
 * теперь идентичны.
 */
function storefrontCategoryVisibility(tenantId: string) {
  const tenant = tenantVisibilityFilter(tenantId);
  return {
    tenantId: tenant,
    services: {
      some: {
        isActive: true,
        isQuarantined: false,
        tenantId: tenant,
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
      },
    },
  };
}

export async function getCachedNetworks(rawTenantId: string) {
  const tenantId = normalizeTenantId(rawTenantId);
  return getCachedNetworksWithRedis(tenantId, async () => {
    const fetchNetworksFromDb = async () => {
      return await db.network.findMany({
        where: {
          isActive: true,
          tenantId: tenantVisibilityFilter(tenantId),
          categories: { some: storefrontCategoryVisibility(tenantId) },
        },
        include: {
          categories: {
            where: storefrontCategoryVisibility(tenantId),
            orderBy: { sort: 'asc' },
            include: {
              _count: {
                select: {
                  services: {
                    where: {
                      isActive: true,
                      isQuarantined: false,
                      tenantId: tenantVisibilityFilter(tenantId),
                      OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
                    }
                  }
                }
              },
              services: {
                where: {
                  isActive: true,
                  isQuarantined: false,
                  tenantId: tenantVisibilityFilter(tenantId),
                  OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
                },
                select: {
                  targetType: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: { sort: 'asc' }
      });
    };

    try {
      return await unstable_cache(
        fetchNetworksFromDb,
        [`public-catalog-networks-v5-${tenantId}`],
        { revalidate: 60, tags: ['catalog', `catalog-${tenantId}`, `networks-${tenantId}`] }
      )();
    } catch {
      return await fetchNetworksFromDb();
    }
  });
}

/**
 * AUD-07 (3.2): hard limit raised from 100 to 500 — realistic provider catalogs
 * fit without silent truncation; anything above is logged loudly and the
 * storefront renders progressively (client-side "show more").
 */
const CATEGORY_SERVICES_HARD_LIMIT = 500;

export async function getCachedServicesByCategory(categoryId: string, tenantId: string = 'smmplan') {
  const normalizedTenant = normalizeTenantId(tenantId);
  return getCachedCategoryServicesWithRedis(categoryId, normalizedTenant, async () => {
    const fetchServicesFromDb = async () => {
      const services = await db.service.findMany({
        where: {
          categoryId: categoryId,
          isActive: true,
          isQuarantined: false,
          tenantId: tenantVisibilityFilter(normalizedTenant),
          OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }]
        },
        select: {
          id: true,
          numericId: true,
          slug: true,
          categoryId: true,
          name: true,
          description: true,
          minQty: true,
          maxQty: true,
          isDripFeedEnabled: true,
          isRefillEnabled: true,
          targetType: true,
          qualityTier: true,
          customDataType: true,
          customDataLabel: true,
          clientRequirement: true,
          clientConfirmation: true,
          features: true,
          cooldownUntil: true,
          etaP50Seconds: true,
          etaP90Seconds: true,
          etaSpeedClass: true,
          requireWarning: true,
          warningMessage: true,
          providerCurrency: true,
          costPer1kRub: true,
          pricePer1000Cents: true,
          markup: true,
          rate: true,
          linkPlaceholder: true,
          linkHint: true,
          smartConfig: {
            select: {
              isEnabled: true,
              isTestMode: true,
              minChunk: true,
              maxChunk: true,
              markup: true,
              useInviteBuffer: true,
              autoCompensate: true,
              checkIntervalMins: true
            }
          }
        },
        orderBy: { rate: 'asc' },
        take: CATEGORY_SERVICES_HARD_LIMIT + 1
      });
      if (services.length > CATEGORY_SERVICES_HARD_LIMIT) {
        logger.warn(`[catalog] AUD-07: category ${categoryId} exceeds ${CATEGORY_SERVICES_HARD_LIMIT} services (${services.length}); storefront shows the cheapest ${CATEGORY_SERVICES_HARD_LIMIT} — consider splitting the category`, { categoryId, tenantId: normalizedTenant, count: services.length });
      }
      
      // Convert BigInt to Number for JSON serialization in unstable_cache and Redis
      return services.slice(0, CATEGORY_SERVICES_HARD_LIMIT).map(s => ({
        ...s,
        pricePer1000Cents: typeof s.pricePer1000Cents === 'bigint' ? Number(s.pricePer1000Cents) : s.pricePer1000Cents
      }));
    };

    try {
      return await unstable_cache(
        fetchServicesFromDb,
        [`public-services-by-category-v4-tenant-${normalizedTenant}-${categoryId}`],
        { revalidate: 60, tags: ['catalog', 'services', `catalog-${normalizedTenant}`, `category-${categoryId}-${normalizedTenant}`] }
      )();
    } catch {
      return await fetchServicesFromDb();
    }
  });
}

export async function getCachedServices(categoryId: string, tenantId: string = 'smmplan') {
  return getCachedServicesByCategory(categoryId, tenantId);
}

export type PublicService = {
  id: string;
  numericId: number;
  slug?: string | null;
  categoryId: string;
  name: string;
  pricePer1kRub: number;
  pricePerUnitRub: number;
  minQty: number;
  maxQty: number;
  description: string | null;
  speed?: string;
  speedDisplay?: string | null;
  startTime?: string | null;
  warrantyDays?: number | null;
  qualityLabel?: string | null;
  qualityTier?: string | null;
  tierName?: string | null;
  badge: string;
  isActive?: boolean;
  isDripFeedEnabled: boolean;
  isRefillEnabled?: boolean;
  isCancelEnabled?: boolean;
  targetType?: string | null;
  customDataType?: string | null;
  customDataLabel?: string | null;
  clientRequirement?: string | null;
  clientConfirmation?: string | null;
  etaP50Seconds?: number | null;
  etaP90Seconds?: number | null;
  etaSpeedClass?: string | null;
  features?: unknown;
  cooldownUntil?: string | null;
  smartConfig?: {
    isEnabled: boolean;
    isTestMode: boolean;
    minChunk: number;
    maxChunk: number;
    markup: number;
    useInviteBuffer?: boolean;
    autoCompensate?: boolean;
    checkIntervalMins?: number;
  } | null;
  requireWarning?: boolean;
  warningMessage?: string | null;
  linkPlaceholder?: string | null;
  linkHint?: string | null;
};

export type PublicCategory = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  networkId: string | null;
  requireWarning?: boolean;
  warningMessage?: string | null;
  serviceCount?: number;
  targetTypes?: string[];
  analyzerTags?: string | null;
};

export type PublicNetwork = {
  id: string;
  name: string;
  slug: string;
  icon: string;
  categories: PublicCategory[];
};

/** @public Public catalog fetching action for storefront */
export async function getPublicCatalogAction(rawTenantId: string = 'smmplan') {
  const tenantId = normalizeTenantId(rawTenantId);
  try {

    const computeCatalog = async (): Promise<PublicNetwork[]> => {
      const rawNetworks = SettingsProvider.isTestEnvironment()
        ? await db.network.findMany({
            where: {
              isActive: true,
              tenantId: tenantVisibilityFilter(tenantId),
              categories: { some: storefrontCategoryVisibility(tenantId) }
            },
            include: {
              categories: {
                where: storefrontCategoryVisibility(tenantId),
                orderBy: { name: 'asc' },
                include: {
                  _count: {
                    select: {
                      services: {
                        where: {
                          isActive: true,
                          isQuarantined: false,
                          tenantId: tenantVisibilityFilter(tenantId),
                          OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
                        }
                      }
                    }
                  },
                  services: {
                    where: {
                      isActive: true,
                      isQuarantined: false,
                      tenantId: tenantVisibilityFilter(tenantId),
                      OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
                    },
                    select: {
                      targetType: true,
                      name: true
                    }
                  }
                }
              }
            },
            orderBy: { sort: 'asc' }
          })
        : await getCachedNetworks(tenantId);

      return rawNetworks.map(net => {
        const icon = `/brands/${net.slug}.svg`;
        let finalIcon = net.icon && (net.icon.startsWith('/') || net.icon.startsWith('http')) ? net.icon : icon;
        if (finalIcon.startsWith('/icons/')) {
          finalIcon = finalIcon.replace('/icons/', '/brands/');
        }

        return {
          id: net.id,
          name: net.name,
          slug: net.slug,
          icon: finalIcon, // prefer valid absolute/relative SVG custom icons or fallback
          categories: net.categories.map(cat => {
            const countObj = '_count' in cat && cat._count ? (cat._count as { services?: number }) : null;
            const rawServiceCount = 'serviceCount' in cat ? (cat as unknown as { serviceCount?: number }).serviceCount : undefined;
            const serviceCount = typeof countObj?.services === 'number'
              ? countObj.services
              : (typeof rawServiceCount === 'number' ? rawServiceCount : 0);

            const rawServices = 'services' in cat && Array.isArray((cat as { services?: Array<{ targetType?: string | null; name?: string }> }).services)
              ? (cat as { services: Array<{ targetType?: string | null; name?: string }> }).services
              : [];

            const targetTypesSet = new Set<string>();
            for (const s of rawServices) {
              if (s && typeof s.name === 'string') {
                const resolved = resolveServiceTargetType({ name: s.name, targetType: s.targetType });
                if (resolved) targetTypesSet.add(resolved);
              }
            }

            return {
              id: cat.id,
              name: cat.name,
              slug: cat.slug,
              description: 'description' in cat ? (cat as { description?: string | null }).description : null,
              networkId: cat.networkId,
              requireWarning: cat.requireWarning,
              warningMessage: cat.warningMessage,
              serviceCount,
              targetTypes: Array.from(targetTypesSet),
              analyzerTags: 'analyzerTags' in cat ? (cat as { analyzerTags?: string | null }).analyzerTags : null
            };
          }).filter(cat => cat.serviceCount > 0)
        };
      }).filter(net => net.categories.length > 0);
    };

    const catalog = SettingsProvider.isTestEnvironment()
      ? await computeCatalog()
      : await getCachedPublicCatalogWithRedis(tenantId, computeCatalog);

    return { success: true, data: catalog };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("getPublicCatalogAction failed", { tenantId, error: errMsg });

    import('@/lib/notifications').then(({ sendAdminAlert }) => {
      try {
        sendAdminAlert(`🚨 Hero catalog fetch failed (tenant=${tenantId}): ${errMsg}`, 'CRITICAL');
      } catch {
        // audit-ignore: secondary alert failure must not mask primary catalog error
      }
    }).catch(() => {
      // audit-ignore: dynamic import failure for notifications
    });

    return { success: false, error: "Failed to load catalog" };
  }
}

/**
 * @public Public catalog endpoint for category services
 */
export async function getServicesByCategoryAction(categoryId: string, rawTenantId: string = 'smmplan'): Promise<PublicService[]> {
  const tenantId = normalizeTenantId(rawTenantId);
  try {

    const computeServices = async (): Promise<PublicService[]> => {
      const [services, usdToRub] = await Promise.all([
        SettingsProvider.isTestEnvironment()
          ? db.service.findMany({
              where: { 
                categoryId: categoryId, 
                isActive: true,
                isQuarantined: false,
                tenantId: tenantVisibilityFilter(tenantId),
                OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }]
              },
              select: {
                id: true,
                numericId: true,
                slug: true,
                categoryId: true,
                name: true,
                description: true,
                minQty: true,
                maxQty: true,
                isDripFeedEnabled: true,
                isRefillEnabled: true,
                targetType: true,
                qualityTier: true,
                customDataType: true,
                customDataLabel: true,
                clientRequirement: true,
                clientConfirmation: true,
                features: true,
                cooldownUntil: true,
                etaP50Seconds: true,
                etaP90Seconds: true,
                etaSpeedClass: true,
                requireWarning: true,
                warningMessage: true,
                providerCurrency: true,
                costPer1kRub: true,
                pricePer1000Cents: true,
                markup: true,
                rate: true,
                linkPlaceholder: true,
                linkHint: true,
                smartConfig: {
                  select: {
                    isEnabled: true,
                    isTestMode: true,
                    minChunk: true,
                    maxChunk: true,
                    markup: true,
                    useInviteBuffer: true,
                    autoCompensate: true,
                    checkIntervalMins: true
                  }
                }
              },
              orderBy: { rate: 'asc' },
              take: CATEGORY_SERVICES_HARD_LIMIT
            })
          : getCachedServices(categoryId, tenantId),
        SettingsProvider.getExchangeRateUSD()
      ]);

      return services.map(s => {
         const lowerName = s.name.toLowerCase();
         const isExplicitNoRefill =
            lowerName.includes('без гарантии') ||
            lowerName.includes('без гарантий') ||
            lowerName.includes('без автодокрутки') ||
            lowerName.includes('no refill') ||
            lowerName.includes('no-refill') ||
            lowerName.includes('norefill') ||
            /\b0\s*(?:d|day|days)\s*refill/i.test(lowerName) ||
            /\bnon[\s-]refill/i.test(lowerName) ||
            lowerName.includes('no warranty') ||
            lowerName.includes('without warranty') ||
            lowerName.includes('без восстановления');

         // 4-Tier Hybrid Execution Metrics
         const feat = (s.features && typeof s.features === 'object' ? s.features : {}) as Record<string, unknown>;
         const fallbackAnalysis = (!feat.speedText || !feat.startTime)
           ? SmartAnalyzerLogic.detectSync(s.name, s.description || '')
           : null;

         const isRefillActive = !isExplicitNoRefill && Boolean(
            s.isRefillEnabled ||
            (feat.hasRefill) ||
            (typeof feat.warrantyDays === 'number' && feat.warrantyDays > 0) ||
            (fallbackAnalysis?.warranty && fallbackAnalysis.warranty > 0)
         );

         const warrantyDays = isExplicitNoRefill
           ? null
           : ((typeof feat.warrantyDays === 'number' ? feat.warrantyDays : undefined) ?? fallbackAnalysis?.warranty ?? (isRefillActive ? 30 : null));

         // Names are strictly "Category Name • Tier" or custom
         const parts = s.name.split('•');
         const tierName = parts.length > 1 ? parts[parts.length - 1].trim().toLowerCase() : "";

         // Explicit admin badge from features metadata (if set by admin in catalog)
         const rawCustomBadge = (feat.badge as string | undefined)?.trim();
         let badge = "";

         if (rawCustomBadge) {
            const upperBadge = rawCustomBadge.toUpperCase();
            if (upperBadge === 'ГАРАНТИЯ' && (!isRefillActive || isExplicitNoRefill)) {
               // Anti-Contradiction Guard: Cannot have 'ГАРАНТИЯ' badge on no-refill service!
               badge = lowerName.includes('быстр') ? "БЫСТРЫЕ" : (s.rate < 0.1 ? "ХИТ" : "");
            } else if (upperBadge !== 'NONE' && upperBadge !== 'НЕТ' && upperBadge !== 'AUTO') {
               badge = upperBadge;
            }
         }

         if (!badge) {
            if (tierName === 'премиум' || s.qualityTier === 'PREMIUM') badge = "ПРЕМИУМ";
            else if (tierName === 'эконом' || s.qualityTier === 'ECONOMY') badge = "ЭКОНОМ";
            else if (tierName === 'живые') badge = "ЖИВЫЕ";
            else if (tierName === 'стандарт') badge = "СТАНДАРТ";
            else if (isRefillActive && (warrantyDays && warrantyDays > 0) && !isExplicitNoRefill) badge = "ГАРАНТИЯ";
            else if (lowerName.includes('быстр') || lowerName.includes('instant') || lowerName.includes('мгновен')) badge = "БЫСТРЫЕ";
            else if (s.rate < 0.1) badge = "ХИТ";
         }

         // Single Source of Truth & Systemic Beautiful Rounding Invariant
         const rawPricePer1k = typeof s.pricePer1000Cents === 'bigint' && s.pricePer1000Cents > 0n ? Number(s.pricePer1000Cents) / 100 : typeof s.pricePer1000Cents === 'number' && s.pricePer1000Cents > 0 ? s.pricePer1000Cents / 100
           : (s.costPer1kRub || (s.rate * (s.providerCurrency === 'RUB' ? 1.0 : usdToRub))) * (s.markup || SAFETY_FLOOR_MARKUP);
         const pricePer1kRub = applyBeautifulRounding(rawPricePer1k);
         const pricePerUnitRub = Math.round((pricePer1kRub / 1000) * 10000) / 10000;

         const startTime = (feat.startTime as string | undefined) || fallbackAnalysis?.startTime || '5–15 мин';
         const speedDisplay = (feat.speedText as string | undefined) || fallbackAnalysis?.speedText || (lowerName.includes('быстр') ? 'Быстрая' : 'Стандартная');
         const qualityLabel = (feat.qualityLabel as string | undefined) || fallbackAnalysis?.qualityLabel || (badge || 'Стандарт');

         return {
            id: s.id,
            numericId: s.numericId,
            slug: s.slug,
            categoryId: s.categoryId,
            name: s.name,
            description: sanitizeServiceDescription(s.description),
            pricePer1kRub,
            pricePerUnitRub,
            minQty: s.minQty,
            maxQty: s.maxQty,
            speed: startTime, // Backwards-compatible speed field (e.g. 'Мгновенно', '0-1 час')
            speedDisplay,
            startTime,
            warrantyDays,
            qualityLabel,
            badge,
            isDripFeedEnabled: s.isDripFeedEnabled,
            isRefillEnabled: isRefillActive,
            targetType: s.targetType,
            customDataType: s.customDataType,
            customDataLabel: s.customDataLabel,
            features: s.features,
            cooldownUntil: s.cooldownUntil && !isNaN(new Date(s.cooldownUntil).getTime()) ? new Date(s.cooldownUntil).toISOString() : null,
            linkPlaceholder: s.linkPlaceholder,
            linkHint: s.linkHint,
            smartConfig: s.smartConfig ? {
              isEnabled: s.smartConfig.isEnabled,
              isTestMode: s.smartConfig.isTestMode,
              minChunk: s.smartConfig.minChunk,
              maxChunk: s.smartConfig.maxChunk,
              markup: s.smartConfig.markup,
              useInviteBuffer: s.smartConfig.useInviteBuffer,
              autoCompensate: s.smartConfig.autoCompensate,
              checkIntervalMins: s.smartConfig.checkIntervalMins
            } : null,
            requireWarning: s.requireWarning,
            warningMessage: s.warningMessage,
            clientRequirement: s.clientRequirement,
            clientConfirmation: s.clientConfirmation,
            etaP50Seconds: s.etaP50Seconds,
            etaP90Seconds: s.etaP90Seconds,
            etaSpeedClass: s.etaSpeedClass
         };
      });
    };

    const result = SettingsProvider.isTestEnvironment()
      ? await computeServices()
      : await getCachedProcessedServicesWithRedis(categoryId, tenantId, computeServices);

    return result;
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("getServicesByCategoryAction failed", { categoryId, tenantId, error: errMsg });
    throw new Error(`Failed to fetch services: ${errMsg}`);
  }
}

/**
 * @public Public catalog lookup by service slug
 */
export async function getServiceBySlugAction(slug: string, tenantId: string = 'smmplan') {
  try {
    const usdToRub = await SettingsProvider.getExchangeRateUSD();
    const service = await db.service.findFirst({
      where: {
        slug,
        tenantId: { in: [tenantId, 'all'] },
        isActive: true,
        isQuarantined: false,
        OR: [{ cooldownUntil: null }, { cooldownUntil: { lt: new Date() } }],
        category: {
          network: { isActive: true }
        }
      },
      include: {
        category: {
          include: { network: true }
        },
        provider: {
          select: { name: true, ticketUrl: true }
        }
      }
    });

    if (!service) return null;

    // Single Source of Truth & Systemic Beautiful Rounding Invariant
    const rawPricePer1k = typeof service.pricePer1000Cents === 'bigint' && service.pricePer1000Cents > 0n
      ? Number(service.pricePer1000Cents) / 100
      : typeof service.pricePer1000Cents === 'number' && service.pricePer1000Cents > 0
      ? service.pricePer1000Cents / 100
      : (service.costPer1kRub || (service.rate * (service.providerCurrency === 'RUB' ? 1.0 : usdToRub))) * (service.markup || SAFETY_FLOOR_MARKUP);
    const pricePer1kRub = applyBeautifulRounding(rawPricePer1k);
    const pricePerUnitRub = Math.round((pricePer1kRub / 1000) * 10000) / 10000;

    return {
      ...service,
      pricePer1000Cents: typeof service.pricePer1000Cents === 'bigint' ? Number(service.pricePer1000Cents) : service.pricePer1000Cents,
      pricePer1kRub,
      pricePerUnitRub,
    };
  } catch (error) {
    console.error("Failed to fetch service by slug:", error);
    return null;
  }
}

/**
 * @public Fetches fresh, live un-cached service details for JIT modal refresh
 */
export async function getFreshServiceAction(serviceId: string, tenantId: string = 'smmplan'): Promise<PublicService | null> {
  try {
    const usdToRub = await SettingsProvider.getExchangeRateUSD();
    const s = await db.service.findUnique({
      where: { id: serviceId },
      include: {
        smartConfig: {
          select: {
            isEnabled: true,
            isTestMode: true,
            minChunk: true,
            maxChunk: true,
            markup: true,
            useInviteBuffer: true,
            autoCompensate: true,
            checkIntervalMins: true,
          }
        }
      }
    });

    if (!s) return null;

    const lowerName = s.name.toLowerCase();
    const isExplicitNoRefill =
      lowerName.includes('без гарантии') ||
      lowerName.includes('без гарантий') ||
      lowerName.includes('без автодокрутки') ||
      lowerName.includes('no refill') ||
      lowerName.includes('no-refill') ||
      lowerName.includes('norefill') ||
      /\b0\s*(?:d|day|days)\s*refill/i.test(lowerName) ||
      /\bnon[\s-]refill/i.test(lowerName) ||
      lowerName.includes('no warranty') ||
      lowerName.includes('without warranty') ||
      lowerName.includes('без восстановления');

    const feat = (s.features && typeof s.features === 'object' ? s.features : {}) as Record<string, unknown>;
    const fallbackAnalysis = (!feat.speedText || !feat.startTime)
      ? SmartAnalyzerLogic.detectSync(s.name, s.description || '')
      : null;

    const isRefillActive = !isExplicitNoRefill && Boolean(
      s.isRefillEnabled ||
      feat.hasRefill ||
      (typeof feat.warrantyDays === 'number' && feat.warrantyDays > 0) ||
      (fallbackAnalysis?.warranty && fallbackAnalysis.warranty > 0)
    );

    const warrantyDays = isExplicitNoRefill
      ? null
      : ((typeof feat.warrantyDays === 'number' ? feat.warrantyDays : undefined) ?? fallbackAnalysis?.warranty ?? (isRefillActive ? 30 : null));

    const parts = s.name.split('•');
    const tierName = parts.length > 1 ? parts[parts.length - 1].trim().toLowerCase() : '';

    const rawCustomBadge = (feat.badge as string | undefined)?.trim();
    let badge = '';
    if (rawCustomBadge) {
      badge = rawCustomBadge.toUpperCase();
    } else if (isExplicitNoRefill) {
      badge = (lowerName.includes('быстр') || lowerName.includes('instant')) ? 'БЫСТРЫЕ' : '';
    } else if (isRefillActive) {
      badge = 'ГАРАНТИЯ';
    } else if (lowerName.includes('премиум') || lowerName.includes('premium')) {
      badge = 'ПРЕМИУМ';
    } else if (lowerName.includes('эконом') || lowerName.includes('economy')) {
      badge = 'ЭКОНОМ';
    } else if (lowerName.includes('живые') || lowerName.includes('real')) {
      badge = 'ЖИВЫЕ';
    } else if (lowerName.includes('стандарт') || lowerName.includes('standard')) {
      badge = 'СТАНДАРТ';
    } else if (lowerName.includes('быстр') || lowerName.includes('instant')) {
      badge = 'БЫСТРЫЕ';
    }

    const rawPricePer1k = typeof s.pricePer1000Cents === 'bigint' && s.pricePer1000Cents > 0n ? Number(s.pricePer1000Cents) / 100 : typeof s.pricePer1000Cents === 'number' && s.pricePer1000Cents > 0 ? s.pricePer1000Cents / 100
      : (s.costPer1kRub || (s.rate * (s.providerCurrency === 'RUB' ? 1.0 : usdToRub))) * (s.markup || SAFETY_FLOOR_MARKUP);
    const pricePer1kRub = applyBeautifulRounding(rawPricePer1k);
    const pricePerUnitRub = Math.round((pricePer1kRub / 1000) * 10000) / 10000;

    return {
      id: s.id,
      numericId: s.numericId,
      slug: s.slug,
      categoryId: s.categoryId,
      name: s.name,
      pricePer1kRub,
      pricePerUnitRub,
      minQty: s.minQty,
      maxQty: s.maxQty,
      description: s.description ? sanitizeServiceDescription(s.description) : null,
      isActive: s.isActive,
      isDripFeedEnabled: s.isDripFeedEnabled,
      isRefillEnabled: isRefillActive,
      isCancelEnabled: s.isCancelEnabled,
      warrantyDays,
      tierName,
      badge,
      targetType: s.targetType,
      qualityTier: s.qualityTier,
      customDataType: s.customDataType,
      customDataLabel: s.customDataLabel,
      smartConfig: s.smartConfig ? {
        isEnabled: s.smartConfig.isEnabled,
        isTestMode: s.smartConfig.isTestMode,
        minChunk: s.smartConfig.minChunk,
        maxChunk: s.smartConfig.maxChunk,
        markup: s.smartConfig.markup,
        useInviteBuffer: s.smartConfig.useInviteBuffer,
        autoCompensate: s.smartConfig.autoCompensate,
        checkIntervalMins: s.smartConfig.checkIntervalMins
      } : null,
      requireWarning: s.requireWarning,
      warningMessage: s.warningMessage,
      clientRequirement: s.clientRequirement,
      clientConfirmation: s.clientConfirmation,
      etaP50Seconds: s.etaP50Seconds,
      etaP90Seconds: s.etaP90Seconds,
      etaSpeedClass: s.etaSpeedClass
    };
  } catch (error) {
    console.error('[getFreshServiceAction] Failed to fetch live service:', error);
    return null;
  }
}

