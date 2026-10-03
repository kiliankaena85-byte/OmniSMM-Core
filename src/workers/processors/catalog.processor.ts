// tenant-isolation-ignore: Global cron job or background task
import { Job } from 'bullmq';
import { CatalogMutationPayload, catalogQueue } from '@/lib/queue-manager';
import { adminCatalogService } from '../../services/admin/catalog.service';
import { logger } from '../../lib/logger';
import { triggerCacheRevalidation } from '../../lib/revalidate-cache';

const log = logger.child({ component: 'CatalogProcessor' });

const MULTI_TENANT_CATALOG_TAGS = ['catalog', 'services', 'catalog-smmplan', 'catalog-flux', 'catalog-global'];

async function safeTriggerCacheRevalidation(tags: string[]): Promise<void> {
  try {
    await triggerCacheRevalidation(tags);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(`[CatalogProcessor] Non-critical cache revalidation failed: ${msg}`);
  }
}

/**
 * Catalog Processor
 * Executes massive, memory-heavy database operations asynchronously
 * to prevent Vercel serverless timeouts and partial failures.
 */
export default async function catalogProcessor(job: Job<CatalogMutationPayload>) {
  let payload: CatalogMutationPayload;
  try {
    const { CatalogJobSchema } = await import('../../schemas/jobs.schema');
    payload = CatalogJobSchema.parse(job.data) as CatalogMutationPayload;
  } catch (zodErr) {
    const { UnrecoverableError } = await import('bullmq');
    log.error(`[CatalogProcessor] Invalid job payload for job ${job.id}`, { cause: zodErr });
    throw new UnrecoverableError('Invalid job payload');
  }
  
  try {
    switch (payload.type) {
      case 'SYNC_PRICES': {
        const { SettingsProvider } = await import('@/lib/settings');
        const freshUsdRate = await SettingsProvider.getExchangeRateUSD();
        const effectiveRate = Number.isFinite(payload.usdToRub) && payload.usdToRub > 0 ? payload.usdToRub : freshUsdRate;
        log.info(`[CatalogProcessor] Starting background price sync with rate ${effectiveRate}...`);
        await adminCatalogService.syncDenormalizedPrices(effectiveRate);
        log.info(`[CatalogProcessor] Price sync completed successfully.`);
        await safeTriggerCacheRevalidation(MULTI_TENANT_CATALOG_TAGS);
        break;
      }

      case 'RECONCILE_PRICES': {
        const { batchSize = 500 } = payload;
        log.info(`[CatalogProcessor] Starting paginated price reconciliation (batchSize: ${batchSize})...`);
        const { SettingsProvider } = await import('@/lib/settings');
        const { db } = await import('@/lib/db');
        const { getCostRub } = await import('@/lib/pricing/currency-invariant');
        const { UPPER_SANITY_LIMIT_RUB, USD_RUB_SANITY_MIN, USD_RUB_SANITY_MAX } = await import('@/lib/financial-constants');
        
        const { CBRRateService } = await import('@/services/system/cbr-rate.service');
        const usdRate = await SettingsProvider.getExchangeRateUSD();
        // INV-CAT-01: fail-closed — a garbage FX rate must never mass-quarantine the storefront
        if (!Number.isFinite(usdRate) || usdRate < USD_RUB_SANITY_MIN || usdRate > USD_RUB_SANITY_MAX) {
          throw new Error(`[CatalogProcessor] RECONCILE_PRICES aborted: USD/RUB rate ${usdRate} outside sanity band [${USD_RUB_SANITY_MIN}, ${USD_RUB_SANITY_MAX}]`);
        }
        const liveCrossRates = await CBRRateService.getLiveCrossRates();

        let scanned = 0;
        let costCacheFixed = 0;
        let lossQuarantined = 0;
        let upperQuarantined = 0;
        let currencyQuarantined = 0;
        let lowMarkupReported = 0;
        let lastId: string | undefined = undefined;

        while (true) {
          const whereClause = lastId
            ? { isActive: true, id: { gt: lastId } }
            : { isActive: true };

          const activeServices: Array<{
            id: string;
            name: string;
            rate: number;
            providerCurrency: string;
            costPer1kRub: number | null;
            pricePer1000Cents: number;
            markup: number;
            tenantId: string;
          }> = await db.service.findMany({
            where: whereClause,
            take: batchSize,
            orderBy: { id: 'asc' },
            select: {
              id: true,
              name: true,
              rate: true,
              providerCurrency: true,
              costPer1kRub: true,
              pricePer1000Cents: true,
              markup: true,
              tenantId: true,
            }
          });

          if (activeServices.length === 0) break;
          lastId = activeServices[activeServices.length - 1].id;

          for (const s of activeServices) {
            scanned++;
            let freshCostRub = 0;
            try {
              freshCostRub = getCostRub(s.rate, s.providerCurrency || '', usdRate, liveCrossRates);
            } catch (currErr) {
              // Invalid/missing currency -> Quarantine
              await db.service.update({
                where: { id: s.id },
                data: {
                  isActive: false,
                  isQuarantined: true,
                  quarantinedAt: new Date(),
                  quarantineReason: `Invalid Currency (${s.providerCurrency || 'NULL'}): ${currErr instanceof Error ? currErr.message : String(currErr)}`
                }
              });
              currencyQuarantined++;
              continue;
            }

            // 1. Check cost cache drift > 2%
            const currentCost = s.costPer1kRub;
            const costDelta = currentCost == null 
              ? 1 
              : Math.abs(currentCost - freshCostRub) / Math.max(currentCost, 1);

            if (currentCost == null || costDelta > 0.02) {
              await db.service.update({
                where: { id: s.id },
                data: { costPer1kRub: freshCostRub }
              });
              costCacheFixed++;
            }

            // 2. Loss check (retail price per 1k < purchase cost)
            const retailRub = (s.pricePer1000Cents || 0) / 100;
            if (retailRub < freshCostRub) {
              await db.service.update({
                where: { id: s.id },
                data: {
                  isActive: false,
                  isQuarantined: true,
                  quarantinedAt: new Date(),
                  quarantineReason: `Loss Prevention: Retail price ${retailRub.toFixed(2)} ₽ < Cost ${freshCostRub.toFixed(2)} ₽/1k`
                }
              });
              lossQuarantined++;
              continue;
            }

            // 3. Upper sanity limit check
            if (retailRub > UPPER_SANITY_LIMIT_RUB) {
              await db.service.update({
                where: { id: s.id },
                data: {
                  isActive: false,
                  isQuarantined: true,
                  quarantinedAt: new Date(),
                  quarantineReason: `Upper Sanity Limit Exceeded: Retail price ${retailRub.toFixed(2)} ₽ > ${UPPER_SANITY_LIMIT_RUB} ₽/1k`
                }
              });
              upperQuarantined++;
              continue;
            }

            // 4. Low markup check (< 1.0)
            if (s.markup > 0 && s.markup < 1.0) {
              lowMarkupReported++;
            }
          }
        }

        log.info(`[CatalogProcessor] Price reconciliation completed:`, {
          scanned,
          costCacheFixed,
          lossQuarantined,
          upperQuarantined,
          currencyQuarantined,
          lowMarkupReported
        });
        await safeTriggerCacheRevalidation(MULTI_TENANT_CATALOG_TAGS);
        break;
      }
      
      case 'SYNC_ALL_CATALOGS': {
        const { admin } = payload;
        log.info(`[CatalogProcessor] Starting background sync for ALL catalogs...`);
        const { db } = await import('../../lib/db');
        const { catalogQueue } = await import('@/lib/queue-manager');
        const providers = await db.provider.findMany({ where: { isActive: true } });
        
        for (const provider of providers) {
            await catalogQueue.add('sync-provider-catalog', {
                type: 'SYNC_PROVIDER_CATALOG',
                providerId: provider.id,
                admin
            });
            log.info(`[CatalogProcessor] Queued SYNC_PROVIDER_CATALOG for ${provider.id} (${provider.name})`);
        }
        break;
      }

      case 'SYNC_PROVIDER_CATALOG': {
        const { providerId, admin } = payload;
        log.info(`[CatalogProcessor] Starting background catalog sync for provider ${providerId}...`);
        try {
          const stats = await adminCatalogService.syncProviderCatalog(providerId, admin as { id: string; email: string });
          log.info(`[CatalogProcessor] Catalog sync completed for ${providerId}. Disabled Zombies: ${stats.zombiesDisabled}, Resurrected: ${stats.resurrected}, Anomalies: ${stats.priceAnomalies}`);
          
          // Apply blacklists, reclassification, and maxQty caps — strictly per tenant (INV-CAT-02)
          try {
            const { applyPostSyncRules } = await import('@/services/providers/post-sync-rules');
            const { VALID_TENANTS } = await import('@/config/tenants');
            for (const tenantId of Array.from(VALID_TENANTS)) {
              await applyPostSyncRules(tenantId);
            }
          } catch (postSyncErr) {
            const errMsg = postSyncErr instanceof Error ? postSyncErr.message : String(postSyncErr);
            log.error(`[CatalogProcessor] applyPostSyncRules failed: ${errMsg}`);
          }
          await safeTriggerCacheRevalidation(MULTI_TENANT_CATALOG_TAGS);
        } catch (syncErr: unknown) {
          const errMsg = syncErr instanceof Error ? syncErr.message : String(syncErr);
          log.warn(`[CatalogProcessor] Skipping catalog sync for provider ${providerId} due to provider API error: ${errMsg}`);
          
          // Update provider error metrics in database
          try {
            const { db } = await import('../../lib/db');
            await db.provider.update({
              where: { id: providerId },
              data: {
                lastErrorAt: new Date(),
                errorCount5m: { increment: 1 }
              }
            });
          } catch {
            // Ignore if provider update fails
          }
        }
        break;
      }
      
      case 'BULK_MARKUP': {
        const { markupPercent, filter, admin } = payload as { markupPercent: number; filter: { categoryId?: string; platform?: string; search?: string }; admin: { id: string; email: string } };
        log.info(`[CatalogProcessor] Starting background bulk markup...`);
        // We reuse the existing logic, but from a worker context
        const result = await adminCatalogService.bulkUpdateMarkup(
          filter,
          markupPercent,
          admin
        );
        log.info(`[CatalogProcessor] Bulk markup completed. Updated ${result.updatedCount} services.`);
        await safeTriggerCacheRevalidation(MULTI_TENANT_CATALOG_TAGS);
        break;
      }

      case 'SYNC_CBR_RATE': {
        // [FIN-005] Automatic CBR exchange rate sync — runs every 6h via BullMQ repeatable job.
        // Prevents SYSTEM_HALT circuit breaker from blocking orders due to stale rate.
        log.info('[CatalogProcessor] Starting scheduled CBR exchange rate sync...');
        try {
          const { CBRRateService } = await import('@/services/system/cbr-rate.service');
          const result = await CBRRateService.syncCBRExchangeRate();
          if (result.updated) {
            log.info(`[CatalogProcessor] CBR rate updated: nominal=${result.nominalRate}, system=${result.systemRate}. Triggering price sync...`);
            // Re-denormalize prices with new rate
            await catalogQueue.add('sync-prices-bg', {
              type: 'SYNC_PRICES',
              usdToRub: result.systemRate
            });
          } else {
            log.info(`[CatalogProcessor] CBR rate unchanged (API issue or already current).`);
          }
        } catch (cbrErr) {
          const errMsg = cbrErr instanceof Error ? cbrErr.message : String(cbrErr);
          log.error(`[CatalogProcessor] CBR sync failed: ${errMsg}`);
          // Don't rethrow — a failed CBR sync shouldn't DLQ, just log
        }
        break;
      }
        
      default:
        throw new Error(`Unknown catalog mutation type`);
    }

  } catch (error: unknown) {
    log.error(`[CatalogProcessor] Failed processing job ${job.id}: ${(error instanceof Error ? error.message : String(error))}`);
    throw error; // Let BullMQ retry and eventually DLQ
  }
}

