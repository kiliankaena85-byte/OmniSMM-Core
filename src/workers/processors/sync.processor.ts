import { Prisma, Order } from '@prisma/client';
import { Job } from 'bullmq';
import { db } from '../../lib/db';
import { SyncJobPayload } from '@/lib/queue-manager';
import { providerService } from '../../services/providers/provider.service';
import { RefundPolicyService } from '../../services/financial/refund-policy.service';
import { sendOrderCompletedMail } from '../../lib/smtp';
import { logger } from '../../lib/logger';
import { runWithTenantBypass } from '../../lib/tenant-context';
import type { ProviderMultiStatusResponse } from '../../services/providers/base-provider';
import { createWarnThrottle, describeError } from './sync-warning-throttle';

// tenant-isolation-ignore: Global cron job operating on all tenants
const log = logger.child({ component: 'SyncProcessor' });

// INV-SYNC-02: заказ с невалидным ответом провайдера не должен засорять лог каждые 5 минут
const invalidStatusWarnThrottle = createWarnThrottle({ windowMs: 60 * 60 * 1000, maxKeys: 5000 });

async function safeUpdateOrderStatus(
  tx: Prisma.TransactionClient, 
  orderId: string, 
  data: Prisma.OrderUpdateInput
): Promise<Order | null> {
  const fresh = await tx.order.findUnique({ where: { id: orderId } });
  if (!fresh || !['PENDING', 'IN_PROGRESS', 'PENDING_CHECK', 'CANCELING'].includes(fresh.status)) {
    return null; // already terminal or not found
  }
  return await tx.order.update({
    where: { id: orderId },
    data
  });
}

export default async function syncProcessor(job: Job<SyncJobPayload>) {
  return await runWithTenantBypass('Global status sync cron across all tenants', async () => {
    if (job.name === 'dripfeed-tick') {
      log.info('Starting Smart Dripfeed Tick processing...');
      const { runSmartDripfeedTick } = await import('./dripfeed.processor');
      await runSmartDripfeedTick();
      log.info('Finished Smart Dripfeed Tick processing.');
      return;
    }

    log.info('Beginning massive status sync...');

  // 1. Get all active providers
  const activeProviders = await db.provider.findMany({
    where: { isActive: true }
  });

  if (activeProviders.length === 0) return;

  const BATCH_SIZE = 500;

  // 2. Process each provider concurrently
  await Promise.allSettled(activeProviders.map(async (providerDef) => {
    if (!providerDef.apiUrl || !providerDef.apiKey) return;

    try {
      const MAX_SYNC_PER_PROVIDER = 1000;
      const activeOrderIds = await db.order.findMany({
        where: { status: { in: ['IN_PROGRESS', 'CANCELING'] }, providerId: providerDef.id },
        select: { id: true },
        take: MAX_SYNC_PER_PROVIDER,
        orderBy: { updatedAt: 'asc' }
      });

      if (activeOrderIds.length >= MAX_SYNC_PER_PROVIDER) {
        log.warn(`[SyncProcessor] Provider ${providerDef.name}: sync truncated to ${MAX_SYNC_PER_PROVIDER} orders (oldest first) — remaining orders will sync next tick`);
      }

      if (activeOrderIds.length === 0) return;

      const provider = await providerService.getWorkerProviderInstance(providerDef);

      for (let i = 0; i < activeOrderIds.length; i += BATCH_SIZE) {
        const chunkIds = activeOrderIds.slice(i, i + BATCH_SIZE).map(o => o.id);
        
        const ordersBatch = await db.order.findMany({
          where: { id: { in: chunkIds } },
          include: { user: true, service: true }
        });

        const allExtIds: string[] = [];
        ordersBatch.forEach(o => {
          if (o.isDripFeed) {
            if (o.dripExternalIds && o.dripExternalIds.length > 0) {
              allExtIds.push(...o.dripExternalIds);
            } else if (o.externalId) {
              allExtIds.push(o.externalId);
            }
          } else if (o.externalId) {
            allExtIds.push(o.externalId);
          }
        });

        if (allExtIds.length === 0) continue;

        // multiStatus API with Timeout and 2-Tier Fallback
        let statuses: ProviderMultiStatusResponse = {};
        let batchTimer: NodeJS.Timeout | undefined;
        try {
          const syncStartTime = Date.now();
          statuses = await Promise.race([
            provider.getMultiOrderStatus(allExtIds),
            new Promise<never>((_, reject) => {
              batchTimer = setTimeout(() => reject(new Error('PROVIDER_TIMEOUT')), 15000);
            })
          ]);
          const elapsedMs = Date.now() - syncStartTime;

          // Update SLA Monitoring (Success)
          await db.provider.update({
            where: { id: providerDef.id },
            data: {
              lastSuccessAt: new Date(),
              errorCount5m: 0, // Reset errors on successful ping
              avgResponseMs: Math.round(((providerDef.avgResponseMs || 0) * 9 + elapsedMs) / 10),
            }
          });
        } catch (batchErr) {
          log.warn(`[SyncProcessor] Batch status polling failed for ${providerDef.name} (${describeError(batchErr)}), falling back to 1-by-1 query:`, { error: describeError(batchErr) });
          try {
            await db.provider.update({
              where: { id: providerDef.id },
              data: {
                lastErrorAt: new Date(),
                errorCount5m: { increment: 1 }
              }
            });
          } catch (slaErr) {
            log.error(`Failed to update SLA error metrics for ${providerDef.id}`, { cause: slaErr });
          }

          // [DEF-005] Controlled concurrency chunking: limit fallback polling to MAX_FALLBACK (25) to fit in lockDuration (60s)
          const MAX_FALLBACK = 25;
          const fallbackExtIds = allExtIds.slice(0, MAX_FALLBACK);
          if (allExtIds.length > MAX_FALLBACK) {
            log.warn(`[SyncProcessor] Fallback polling truncated from ${allExtIds.length} to ${MAX_FALLBACK} orders for ${providerDef.name} to respect worker lockDuration`);
          }
          const CHUNK_SIZE = 5;
          for (let i = 0; i < fallbackExtIds.length; i += CHUNK_SIZE) {
            const chunk = fallbackExtIds.slice(i, i + CHUNK_SIZE);
            await Promise.allSettled(chunk.map(async (extId) => {
              try {
                const single = await provider.getOrderStatus(extId);
                if (single && typeof single === 'object') {
                  statuses[extId] = single;
                }
              } catch { /* skip individual failure */ }
            }));
          }
        } finally {
          if (batchTimer) clearTimeout(batchTimer);
        }

        // 3. Update orders based on responses
        for (const order of ordersBatch) {
        if (order.isDripFeed && order.dripExternalIds && order.dripExternalIds.length > 0) {
          // Complex logic for multi-task Drip-Feed (aggregate remains and evaluate terminal statuses)
          let totalRemainsText = 0;
          let anyCanceled = false;
          let anyPartial = false;
          let allCompleted = true;
          let allTerminal = true;
          let hasAnyStatus = false;

          for (const extId of order.dripExternalIds) {
             const s = statuses[extId];
             if (!s || typeof s === 'string' || !s.status) {
               allCompleted = false;
               allTerminal = false;
               continue;
             }
             hasAnyStatus = true;
             const subStatus = String(s.status).toLowerCase();
             if (s.remains) totalRemainsText += parseInt(String(s.remains), 10) || 0;

             if (['canceled', 'cancelled', 'cancel'].includes(subStatus)) {
               anyCanceled = true;
               allCompleted = false;
             } else if (['partial', 'partially completed'].includes(subStatus)) {
               anyPartial = true;
               allCompleted = false;
             } else if (['completed', 'complete', 'success'].includes(subStatus)) {
               // completed sub-task
             } else {
               // still in-progress, pending, processing, etc.
               allCompleted = false;
               allTerminal = false;
             }
          }

          if (hasAnyStatus && allCompleted) {
             await db.$transaction(async (tx) => {
               await safeUpdateOrderStatus(tx, order.id, {
                 status: 'COMPLETED',
                 remains: 0
               });
             });
          } else if (allTerminal && (anyCanceled || anyPartial)) {
             const clampedDripRemains = Math.min(order.quantity, Math.max(0, totalRemainsText));
             await db.$transaction(async (tx) => {
               const updated = await safeUpdateOrderStatus(tx, order.id, {
                 status: 'PARTIAL',
                 remains: clampedDripRemains
               });
               if (updated && clampedDripRemains > 0) {
                 await RefundPolicyService.processRefund({
                   id: order.id,
                   userId: order.userId,
                   charge: Number(order.charge),
                   quantity: order.quantity,
                   remains: clampedDripRemains,
                   status: 'PARTIAL',
                   tenantId: order.tenantId
                 }, 'Авто-возврат за отмененную/недовыполненную часть Drip-Feed заказа', tx);
               }
             });
          }
          continue;
        }

        if (!order.externalId) continue;
        const statusObj = statuses[order.externalId];
        if (!statusObj) continue;

        // Check if provider returned an explicit error status payload
        if (typeof statusObj === 'string' || !statusObj.status) {
          // INV-SYNC-03: статус/возвраты НЕ трогаем — заказ остаётся IN_PROGRESS до ручного решения
          if (invalidStatusWarnThrottle.shouldWarn(order.id)) {
            log.warn(`Invalid multi-status response for Order ${order.id} (provider=${providerDef.name}, externalId=${order.externalId}) — manual review required; repeats suppressed for 1h`, { statusObj });
          }
          continue;
        }

        const normalizedStatus = statusObj.status.toLowerCase();
        let targetStatus: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED' | 'PARTIAL' | null = null;

        if (['completed', 'complete', 'success'].includes(normalizedStatus)) {
          targetStatus = 'COMPLETED';
        } else if (['canceled', 'cancelled', 'cancel'].includes(normalizedStatus)) {
          targetStatus = 'CANCELED';
        } else if (['partial', 'partially completed'].includes(normalizedStatus)) {
          targetStatus = 'PARTIAL';
        } else if (['processing', 'in progress', 'in_progress', 'pending'].includes(normalizedStatus)) {
          targetStatus = 'IN_PROGRESS';
        }

        const remainsNum = statusObj.remains !== undefined ? parseInt(String(statusObj.remains), 10) : undefined;
        const startCountNum = statusObj.start_count !== undefined ? parseInt(String(statusObj.start_count), 10) : undefined;

        if (targetStatus === 'COMPLETED') {
          let shouldSendCompletedMail = false;
          await db.$transaction(async (tx) => {
            const updated = await safeUpdateOrderStatus(tx, order.id, {
              status: 'COMPLETED',
              remains: 0,
              startCount: startCountNum !== undefined && !isNaN(startCountNum) ? startCountNum : undefined
            });

            if (updated && order.email) {
              shouldSendCompletedMail = true;
            }
          });

          if (shouldSendCompletedMail && order.email) {
            sendOrderCompletedMail(order.email, String(order.numericId || order.id), order.service.name, order.tenantId).catch(err => log.error('Failed to send order completed email', { error: err }));
          }
        } else if (targetStatus === 'CANCELED') {
          const rawRemains = (remainsNum !== undefined && !isNaN(remainsNum) && remainsNum > 0) ? remainsNum : order.quantity;
          const safeCancelRemains = Math.min(order.quantity, Math.max(0, rawRemains));

          await db.$transaction(async (tx) => {
            const updated = await safeUpdateOrderStatus(tx, order.id, {
              status: 'CANCELED',
              remains: safeCancelRemains,
              error: statusObj.error || 'Провайдер отменил заказ'
            });

            if (updated && safeCancelRemains > 0) {
              await RefundPolicyService.processRefund({ id: order.id, userId: order.userId, charge: Number(order.charge), quantity: order.quantity, remains: safeCancelRemains, status: 'CANCELED', tenantId: order.tenantId }, 'Авто-возврат: провайдер отменил заказ', tx);
            }
          });
        } else if (targetStatus === 'PARTIAL') {
          // Mathematical Boundary Clamp: remains must be between 0 and order.quantity
          const rawRemains = (remainsNum !== undefined && !isNaN(remainsNum) && remainsNum > 0) ? remainsNum : 0;
          const safeRemains = Math.min(order.quantity, Math.max(0, rawRemains));

          await db.$transaction(async (tx) => {
            const updated = await safeUpdateOrderStatus(tx, order.id, {
              status: 'PARTIAL',
              remains: safeRemains,
              startCount: startCountNum !== undefined && !isNaN(startCountNum) ? startCountNum : undefined
            });

            if (updated) {
              await RefundPolicyService.processRefund({ id: order.id, userId: order.userId, charge: Number(order.charge), quantity: order.quantity, remains: safeRemains, status: 'PARTIAL', tenantId: order.tenantId }, 'Авто-возврат за недовыполненную часть заказа', tx);
            }
          });
        } else if (targetStatus === 'IN_PROGRESS') {
          const safeProgressRemains = (remainsNum !== undefined && !isNaN(remainsNum)) ? Math.min(order.quantity, Math.max(0, remainsNum)) : undefined;
          await db.order.updateMany({
            where: {
              id: order.id,
              status: { in: ['IN_PROGRESS', 'PENDING', 'PENDING_CHECK'] }
            },
            data: {
              remains: safeProgressRemains,
              startCount: startCountNum !== undefined && !isNaN(startCountNum) ? startCountNum : undefined
            }
          });
        }
      }
      }
    } catch (e: unknown) {
      log.error(`Exception while pinging Provider ${providerDef.id}`, { cause: e });

      // Update SLA Monitoring (Error)
      try {
        await db.provider.update({
          where: { id: providerDef.id },
          data: {
            lastErrorAt: new Date(),
            errorCount5m: { increment: 1 }
          }
        });
      } catch (slaErr: unknown) {
        log.error(`Failed to update SLA error metrics for ${providerDef.id}`, { cause: slaErr });
      }
    }
  }));

  // Restore Quarantined Services & Evaluate Stuck Orders
  try {
    const { QuarantineService } = await import('@/services/providers/quarantine.service');
    await QuarantineService.restoreExpiredQuarantines();
    await QuarantineService.evaluateTriggerC();
  } catch (e: unknown) {
    log.error('Failed to execute Quarantine Service tasks', { cause: e });
  }

  // Note: Orphaned PENDING orders are swept canonically by cleanup.processor.ts (runOrphanSweep)
  // with strict concurrency checks, idempotency guards, and bounded batches (take: 100).


  // Smart Auto-Flush: PENDING_CHECK orders if provider balance restored
  try {
    const { BalanceAutoFlushService } = await import('@/services/providers/balance-autoflush.service');
    const flushed = await BalanceAutoFlushService.sweepAllProviders();
    if (flushed.length > 0) {
      log.info(`[SyncProcessor] Smart Balance Auto-Flush dispatched ${flushed.reduce((acc, f) => acc + f.flushedCount, 0)} orders across ${flushed.length} providers.`);
    }
  } catch (err) {
    log.error('Failed to run BalanceAutoFlushService sweep in sync processor', { error: err });
  }

  // Smart Drip 2.5: Auto-compensation tick
  try {
    const { SmartFeedbackLoopProcessor } = await import('./smart-feedback-loop.processor');
    await SmartFeedbackLoopProcessor.runSmartFeedbackLoopTick();
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error('[SyncProcessor] SmartFeedbackLoop tick failed', { error: errMsg });
  }

  // Delayed Order Monitoring (Non-destructive): Logs warnings for orders delayed > 48h without altering order status
  try {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const slowOrders = await db.order.findMany({
      where: {
        status: 'IN_PROGRESS',
        createdAt: { lt: twoDaysAgo },
        externalId: { not: null },
        isDripFeed: false,
      },
      select: { id: true, numericId: true, quantity: true, remains: true, createdAt: true },
      take: 20
    });

    for (const order of slowOrders) {
        const createdTime = order.createdAt ? new Date(order.createdAt).getTime() : Date.now();
        const hoursWaiting = Math.floor((Date.now() - createdTime) / (1000 * 60 * 60));
        log.info(`[SyncProcessor] Order #${order.numericId} in progress for ${hoursWaiting}h awaiting provider execution (remains: ${order.remains}/${order.quantity}). Kept active.`);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.error('[SyncProcessor] Delayed order monitor failed', { error: errMsg });
  }
  });
}
