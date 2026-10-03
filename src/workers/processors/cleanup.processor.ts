// tenant-isolation-ignore: Global cron job or background task
/**
 * Cleanup Processor (P2.3 — TTL Maintenance)
 *
 * Runs daily at 03:00 (scheduled via ensureCleanupCron).
 * Removes stale data to prevent unbounded table growth:
 *
 *   - AnalyticsEvent    → older than 90 days
 *   - RateLimit         → expired (expiresAt < now)
 *   - LoginLog          → older than 180 days
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { CompensationService } from '@/services/financial/compensation.service';
import { LoyaltyService } from '@/services/users/loyalty.service';
import { sendAdminAlert } from '@/lib/notifications';
import { sendOrderCanceledMail } from '@/lib/smtp';
import { providerService } from '@/services/providers/provider.service';
import { orderService } from '@/services/core/order.service';
import { ordersQueue } from '@/lib/queue-manager';
import { WalletOps } from '@/services/financial/wallet-ops';
import { calculatePartialRefund } from '@/utils/refund';
import { reconcileStalePayments } from '../payment-reconciliation';
import { checkWebhookHealth } from '@/lib/alerts/webhook-health';
import { detectLoginAnomalies } from '@/lib/security/login-anomaly-detector';

/**
 * MANDATORY INTEGRITY WARNING:
 * DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
 */

const log = logger.child({ component: 'CleanupProcessor' });

/** Retention policy constants */
const ANALYTICS_RETENTION_DAYS = 90;
const LOGIN_LOG_RETENTION_DAYS = 90;

export async function runCleanup(): Promise<void> {
  const startedAt = Date.now();
  log.info('Daily cleanup started');

  const now = new Date();

  // ── 1. AnalyticsEvent: older than 90 days ─────────────────────────────────
  const analyticsThreshold = new Date(now);
  analyticsThreshold.setDate(analyticsThreshold.getDate() - ANALYTICS_RETENTION_DAYS);

  const analyticsResult = await db.analyticsEvent.deleteMany({
    where: { createdAt: { lt: analyticsThreshold } },
  });

  log.info('AnalyticsEvent cleanup done', {
    deleted: analyticsResult.count,
    olderThan: analyticsThreshold.toISOString(),
  });

  // ── 2. RateLimit: expired records ─────────────────────────────────────────
  const rateLimitResult = await db.rateLimit.deleteMany({
    where: { expiresAt: { lte: now } },
  });

  log.info('RateLimit cleanup done', { deleted: rateLimitResult.count });

  // ── 3. LoginLog: older than 180 days ──────────────────────────────────────
  const loginLogThreshold = new Date(now);
  loginLogThreshold.setDate(loginLogThreshold.getDate() - LOGIN_LOG_RETENTION_DAYS);

  const loginLogResult = await db.loginLog.deleteMany({
    where: { createdAt: { lt: loginLogThreshold } },
  });

  log.info('LoginLog cleanup done', {
    deleted: loginLogResult.count,
    olderThan: loginLogThreshold.toISOString(),
  });

  // ── 3.5. AuthToken: expired tokens ────────────────────────────────────────
  const authTokenResult = await db.authToken.deleteMany({
    where: { expiresAt: { lt: now } },
  });

  log.info('AuthToken cleanup done', { deleted: authTokenResult.count });

  // ── 3.6. Orders: Auto-resolve stale PENDING_CHECK (older than 6 hours) ──────
  await runPendingCheckResolution();

  // ── 3.7. Payments: Reconcile stale PENDING payments & Webhook health ───────
  try {
    await reconcileStalePayments();
    await checkWebhookHealth();
    await detectLoginAnomalies();
  } catch (err) {
    log.error('Failed to run periodic payment reconciliation / health checks', { error: err });
  }

  // ── 3.8. ProviderProxyLog: older than 30 days (Storage Optimization) ────────
  try {
    const proxyLogThreshold = new Date(now);
    proxyLogThreshold.setDate(proxyLogThreshold.getDate() - 30);

    const proxyLogResult = await db.providerProxyLog.deleteMany({
      where: { createdAt: { lt: proxyLogThreshold } },
    });

    log.info('ProviderProxyLog cleanup done', {
      deleted: proxyLogResult.count,
      olderThan: proxyLogThreshold.toISOString(),
    });
  } catch (err) {
    log.error('Failed to prune old ProviderProxyLog records', { error: err });
  }

  // ── 3.9. Smart Auto-Flush: PENDING_CHECK orders if provider balance restored ──
  try {
    const { BalanceAutoFlushService } = await import('@/services/providers/balance-autoflush.service');
    const flushed = await BalanceAutoFlushService.sweepAllProviders();
    if (flushed.length > 0) {
      log.info(`[Cleanup] Smart Balance Auto-Flush dispatched ${flushed.reduce((acc, f) => acc + f.flushedCount, 0)} orders across ${flushed.length} providers.`);
    }
  } catch (err) {
    log.error('Failed to run BalanceAutoFlushService sweep', { error: err });
  }

  // ── 3.9. SecurityEvent: INFO / WARNING older than 90 days (Storage Optimization) ───
  // Note: CRITICAL security events are kept indefinitely for audit integrity.
  try {
    const securityEventThreshold = new Date(now);
    securityEventThreshold.setDate(securityEventThreshold.getDate() - 90);

    const securityEventResult = await db.securityEvent.deleteMany({
      where: {
        createdAt: { lt: securityEventThreshold },
        severity: { in: ['INFO', 'WARNING'] },
      },
    });

    log.info('SecurityEvent (low severity) cleanup done', {
      deleted: securityEventResult.count,
      olderThan: securityEventThreshold.toISOString(),
    });
  } catch (err) {
    log.error('Failed to prune old low-severity SecurityEvent records', { error: err });
  }

  // ── 3.10. Empty Categories Sweep: PROTECTED AGAINST AUTOMATED BACKGROUND DELETION ───
  // Inviolable Database Invariant: Automated background workers MUST NEVER delete categories.
  // Categories can be temporarily empty while administrators (ADMIN / OWNER) configure taxonomy
  // or before services are imported. Empty category cleanup is strictly an explicit administrative
  // action via cleanupEmptyCategoriesAction() executed through the Admin Panel.
  log.debug('Skipping automated category deletion in maintenance worker (Catalog Inviolability Invariant)');


  // ── 3.11. TelegramErrorLog: resolved errors older than 90 days ─────────────
  try {
    const telegramLogThreshold = new Date(now);
    telegramLogThreshold.setDate(telegramLogThreshold.getDate() - 90);

    const telegramLogResult = await db.telegramErrorLog.deleteMany({
      where: {
        isResolved: true,
        createdAt: { lt: telegramLogThreshold },
      },
    });

    log.info('TelegramErrorLog (resolved) cleanup done', {
      deleted: telegramLogResult.count,
      olderThan: telegramLogThreshold.toISOString(),
    });
  } catch (err) {
    log.error('Failed to prune old resolved TelegramErrorLog records', { error: err });
  }

  // ── 4. Orders: Zombie AWAITING_PAYMENT ────────────────────────────────────
  // W2-1 FIX: Don't blindly cancel — check if a payment was recently confirmed.
  // YooKassa webhooks can arrive up to 5 minutes late. Cancelling a paid order
  // before the webhook arrives causes financial loss for the client.
  const zombieThreshold = new Date(now);
  zombieThreshold.setHours(zombieThreshold.getHours() - 24);

  // Only cancel if no associated payment is in SUCCEEDED or PENDING (recent) state
  const safeZombieThreshold = new Date(now);
  safeZombieThreshold.setHours(safeZombieThreshold.getHours() - 25); // Extra 1-hour buffer

  let canceledCount = 0;
  let hasMore = true;
  const MAX_ITERATIONS = 20; // 20 × 50 = 1000 zombies max
  let iterations = 0;

  while (hasMore && iterations < MAX_ITERATIONS) {
    iterations++;

    const zombies = await db.order.findMany({
      where: { 
        status: 'AWAITING_PAYMENT',
        createdAt: { lt: safeZombieThreshold },
        payment: { status: { notIn: ['SUCCEEDED', 'PENDING'] } }
      },
      select: { 
        id: true,
        numericId: true,
        paymentId: true,
        promoCodeId: true,
        tenantId: true,
        user: { select: { email: true } },
        service: { select: { name: true } }
      },
      take: 50 // [FIN-010] Batching for performance protection
    });

    if (zombies.length === 0) {
      break;
    }

    for (const zombie of zombies) {
      let shouldSendEmail = false;
      await db.$transaction(async (tx) => {
        // [FIN-010] Optimistic lock to prevent Race Condition with incoming Webhooks
        const updated = await tx.order.updateMany({
          where: { id: zombie.id, status: 'AWAITING_PAYMENT' },
          data: { 
            status: 'CANCELED', 
            error: 'Ожидание оплаты истекло (авто-отмена системы)' 
          }
        });
        
        if (updated.count > 0) {
          await LoyaltyService.reverseCommission(tx, zombie.id);

          // R1-003 Fix: Roll back promo code uses if it was never paid
          if (zombie.promoCodeId) {
            // Prevent double-decrement for Media Group checkouts
            let isFirstOrderOfPayment = true;
            if (zombie.paymentId) {
              const firstOrder = await tx.order.findFirst({
                where: { paymentId: zombie.paymentId, promoCodeId: zombie.promoCodeId },
                orderBy: { id: 'asc' },
                select: { id: true }
              });
              isFirstOrderOfPayment = firstOrder?.id === zombie.id;
            }
            if (isFirstOrderOfPayment) {
              await tx.promoCode.updateMany({
                where: { id: zombie.promoCodeId, uses: { gt: 0 } },
                data: { uses: { decrement: 1 } }
              });
            }
          }

          // Cascade cancel associated SmartCampaign and pending SmartTasks
          const campaigns = await tx.smartCampaign.findMany({
            where: {
              OR: [
                { orderId: zombie.id },
                ...(zombie.paymentId ? [{ paymentId: zombie.paymentId }] : [])
              ],
              status: { in: ['PLANNED', 'RUNNING', 'PAUSED'] }
            },
            select: { id: true }
          });
          for (const camp of campaigns) {
            await tx.smartCampaign.update({
              where: { id: camp.id },
              data: { status: 'ERROR' }
            });
            await tx.smartTask.updateMany({
              where: { campaignId: camp.id, status: 'PLANNED' },
              data: { status: 'ERROR', error: 'Заказ отменен по таймауту оплаты' }
            });
          }

          canceledCount++;
          if (zombie.paymentId) {
            shouldSendEmail = true;
          }
        }
      });

      if (shouldSendEmail && zombie.user?.email && zombie.service?.name) {
        sendOrderCanceledMail(
          zombie.user.email,
          zombie.numericId.toString(),
          zombie.service.name,
          zombie.tenantId
        ).catch(err => log.error('Failed to send zombie cancellation email', { orderId: zombie.id, error: (err instanceof Error ? err.message : String(err)) }));
      }
    }

    if (zombies.length < 50) {
      hasMore = false; // Last page
    }
  }

  if (iterations >= MAX_ITERATIONS) {
    log.warn('runCleanup: reached MAX_ITERATIONS limit', {
      canceledCount,
      iterations
    });
    await sendAdminAlert(
      '⚠️ cleanup MAX_ITERATIONS reached. Возможно накопилось >1000 зомби.',
      'WARNING'
    );
  }

  log.info('Zombie AWAITING_PAYMENT cleanup done', { 
    canceled: canceledCount,
    olderThan: zombieThreshold.toISOString()
  });

  // ── 5. Orders: Stuck IN_PROGRESS TTL Sweep ────────────────────────────────
  try {
    await runInProgressTTLSweep();
  } catch (ttlErr) {
    const errMsg = ttlErr instanceof Error ? ttlErr.message : String(ttlErr);
    log.error('runCleanup: runInProgressTTLSweep failed', { error: errMsg });
  }

  // ── 6. Orders: Stuck PENDING_CHECK TTL Sweep ────────────────────────────
  try {
    await runPendingCheckTTLSweep();
  } catch (pcErr) {
    const errMsg = pcErr instanceof Error ? pcErr.message : String(pcErr);
    log.error('runCleanup: runPendingCheckTTLSweep failed', { error: errMsg });
  }

  const durationMs = Date.now() - startedAt;
  log.info('Daily cleanup completed', {
    durationMs,
    analytics: analyticsResult.count,
    rateLimit: rateLimitResult.count,
    loginLog: loginLogResult.count,
  });
}

/**
 * WRK-03: Auto-resolve stale PENDING_CHECK (older than 6 hours).
 * Exported so it can run on an hourly schedule instead of waiting for daily cleanup.
 */
export async function runPendingCheckResolution(): Promise<void> {
  const pendingCheckThreshold = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const stalePendingCheck = await db.order.findMany({
    where: {
      status: 'PENDING_CHECK',
      updatedAt: { lt: pendingCheckThreshold },
    },
    include: { service: { include: { provider: true } } },
    take: 50,
  });

  if (stalePendingCheck.length > 0) {
    for (const pOrder of stalePendingCheck) {
      try {
        if (pOrder.service?.provider && pOrder.externalId) {
          const providerInstance = await providerService.getWorkerProviderInstance(pOrder.service.provider);
          const providerStatus = await providerInstance.getOrderStatus(pOrder.externalId);
          if (providerStatus?.status) {
            await orderService.processStatusUpdate(pOrder.externalId, providerStatus.status, Number(providerStatus.remains) || 0);
            log.info(`[Cleanup] Auto-resolved PENDING_CHECK Order #${pOrder.numericId} via provider status ${providerStatus.status}`);
            continue;
          }
        }
        // If order was never sent to any provider (no externalId), log for manual operator review instead of blind destructive cancel
        if (!pOrder.externalId) {
          log.warn(`[Cleanup] PENDING_CHECK Order #${pOrder.numericId} has no externalId after 6h. Kept in queue for operator review.`);
        }
      } catch (err) {
        log.error(`[Cleanup] Failed to poll status for PENDING_CHECK Order #${pOrder.numericId}`, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

/**
 * Sweep orphans: Finds PENDING orders that are older than 15 minutes and pushes them back to dispatch.
 */
export async function runOrphanSweep(): Promise<void> {
  const startedAt = Date.now();
  const threshold = new Date(Date.now() - 15 * 60 * 1000); // 15 mins
  
  const orphans = await db.order.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: threshold }
    },
    select: { id: true, numericId: true, userId: true, charge: true, createdAt: true, status: true, externalId: true, tenantId: true },
    take: 100
  });

  if (orphans.length > 0) {
    let sweptCount = 0;
    const sweptDetails: string[] = [];
    const criticalAlerts: string[] = [];

    for (const orphan of orphans) {
      const initialJobId = `dispatch-${orphan.id}`;
      let jobState: string | null = null;
      let jobExists = false;

      try {
        const job = await ordersQueue.getJob(initialJobId);
        if (job) {
          jobExists = true;
          jobState = await job.getState();
        }
      } catch (redisErr: unknown) {
        const msg = `[CRITICAL][ACTION REQUIRED] Redis unavailable during sweep-orphans getJob. Order ${orphan.id} remains PENDING. Error: ${(redisErr instanceof Error ? redisErr.message : String(redisErr))}`;
        log.error(msg);
        criticalAlerts.push(`🚨 Ошибка Redis при проверке заказа #${orphan.numericId}: ${(redisErr instanceof Error ? redisErr.message : String(redisErr))}`);
        continue;
      }

      if (jobExists && jobState) {
        if (['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'].includes(jobState)) {
          // Live job, false positive. Skip.
          continue;
        }

        if (jobState === 'completed') {
          // Self-Healing: Job completed. If externalId exists, order was dispatched to provider.
          if (orphan.externalId) {
            await db.order.update({
              where: { id: orphan.id },
              data: { status: 'IN_PROGRESS', updatedAt: new Date() }
            });
            log.info(`[Auto-Heal] Order ${orphan.id} with externalId ${orphan.externalId} resolved PENDING -> IN_PROGRESS`);
          } else {
            await orderService.failOrderTerminal(
              orphan.id,
              'Автовосстановление: Job completed without provider externalId',
              false
            );
            log.warn(`[Auto-Heal] Order ${orphan.id} without externalId failed & refunded`);
          }
          continue;
        }

        if (jobState === 'failed') {
          // Attempt auto-recovery via failOrderTerminal
          try {
            await orderService.failOrderTerminal(
              orphan.id,
              'Автовосстановление: Dead-letter job failed, recovered by orphan sweep',
              false
            );

            // Verify recovery succeeded
            const recovered = await db.order.findUnique({
              where: { id: orphan.id },
              select: { status: true }
            });

            if (recovered?.status === 'ERROR') {
              log.warn(`[ARCH-2] Auto-recovered failed job order ${orphan.id} → ERROR + refund`);
              criticalAlerts.push(
                `⚠️ Авто-восстановление: Заказ #${orphan.numericId} (ID: ${orphan.id}) переведён в ERROR и деньги возвращены. Dead-letter ранее не отработал.`
              );
            } else {
              // failOrderTerminal returned null = order was already terminal
              log.info(`[ARCH-2] Order ${orphan.id} already terminal, no action needed`);
            }
          } catch (recoveryErr: unknown) {
            // Auto-recovery failed — escalate to manual
            const refundRub = (Number(orphan.charge) / 100).toFixed(2);
            const msg = `[CRITICAL][ACTION REQUIRED] ARCH-2 auto-recovery failed. Order ${orphan.id}, User ${orphan.userId}, Amount ${refundRub} RUB. Error: ${(recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr))}`;
            log.error(msg);
            criticalAlerts.push(
              `🚨 КРИТИЧНО: Авто-восстановление НЕ УДАЛОСЬ. Заказ #${orphan.numericId} (ID: \`${orphan.id}\`), Пользователь: \`${orphan.userId}\`. Сумма: ${refundRub} ₽. Требуется ручной возврат.`
            );
          }
          continue;
        }
        
        // Any other state (should not happen in BullMQ, but just in case)
        continue;
      }

      // If job does not exist -> Re-enqueue with unique attempt jobId
      try {
        const dispatchJobId = `dispatch-${orphan.id}-${Date.now()}`;
        await ordersQueue.add('order-dispatch', { orderId: orphan.id, tenantId: orphan.tenantId }, { jobId: dispatchJobId });
        sweptCount++;
        const minutesPending = Math.round((Date.now() - orphan.createdAt.getTime()) / 60000);
        log.warn(`[WARNING] recovered orphan orderId=${orphan.id} jobId=${dispatchJobId}`);
        sweptDetails.push(`• Восстановлен: ID \`${orphan.id}\` (#${orphan.numericId}), висел ${minutesPending} мин`);
      } catch (addErr: unknown) {
        const msg = `[CRITICAL][ACTION REQUIRED] Redis unavailable during sweep-orphans add. Order ${orphan.id} remains PENDING. Error: ${(addErr instanceof Error ? addErr.message : String(addErr))}`;
        log.error(msg);
        criticalAlerts.push(`🚨 Ошибка Redis при переотправке заказа #${orphan.numericId}: ${(addErr instanceof Error ? addErr.message : String(addErr))}`);
      }
    }
    
    if (sweptCount > 0) {
      log.info(`Swept ${sweptCount} orphan PENDING orders`, { durationMs: Date.now() - startedAt });
      await sendAdminAlert(
        `♻️ *sweep-orphans recovery*\nПоднято потерянных заказов: ${sweptCount}\n\n${sweptDetails.join('\n')}`,
        'WARNING'
      );
    }

    if (criticalAlerts.length > 0) {
      await sendAdminAlert(
        `🔴 *sweep-orphans CRITICAL ERRORS*\nОбнаружены критические проблемы, требующие вмешательства:\n\n${criticalAlerts.join('\n\n')}`,
        'CRITICAL'
      );
    }
  }
}

interface StuckOrderSweepItem {
  id: string;
  numericId: number;
  userId: string | null;
  charge: bigint | number;
  quantity: number;
  remains: number | null;
  serviceId: string;
  externalId: string | null;
  runs: number | null;
  interval: number | null;
  createdAt: Date;
  tenantId: string;
  service: {
    provider: any;
  };
  smartCampaign: {
    id: string;
    status: string;
    totalDays: number;
  } | null;
}

/**
 * In-progress TTL Sweep: Finds orders in IN_PROGRESS state for more than 72 hours,
 * and terminates them with PARTIAL, ERROR, or COMPLETED state and appropriate refunds.
 */
export async function runInProgressTTLSweep(): Promise<void> {
  const startedAt = Date.now();
  const IN_PROGRESS_TTL_HOURS = 72;
  const threshold = new Date(Date.now() - IN_PROGRESS_TTL_HOURS * 60 * 60 * 1000);

  const IN_PROGRESS_TTL_BATCH_SIZE = 50;
  const MAX_ITERATIONS = 20; // 1000 orders max
  let hasMore = true;
  let iterations = 0;
  let processedCount = 0;
  let lastOrderId: string | undefined = undefined;
  const processedDetails: string[] = [];

  log.info('InProgress TTL sweep started', { threshold: threshold.toISOString() });

  while (hasMore && iterations < MAX_ITERATIONS) {
    iterations++;

    const stuckOrders: StuckOrderSweepItem[] = (await db.order.findMany({
      where: {
        status: 'IN_PROGRESS',
        createdAt: { lt: threshold },
        ...(lastOrderId ? { id: { gt: lastOrderId } } : {})
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        numericId: true,
        userId: true,
        charge: true,
        quantity: true,
        remains: true,
        serviceId: true,
        externalId: true,
        runs: true,
        interval: true,
        createdAt: true,
        tenantId: true,
        service: {
          select: {
            provider: true
          }
        },
        smartCampaign: {
          select: {
            id: true,
            status: true,
            totalDays: true
          }
        }
      },
      take: IN_PROGRESS_TTL_BATCH_SIZE
    })) as unknown as StuckOrderSweepItem[];

    if (stuckOrders.length === 0) {
      break;
    }
    lastOrderId = stuckOrders[stuckOrders.length - 1].id;
    if (stuckOrders.length < IN_PROGRESS_TTL_BATCH_SIZE) {
      hasMore = false;
    }

    for (const order of stuckOrders) {
      // 1. Dynamic TTL check for Drip-Feed orders (do not cancel orders still within scheduled run window)
      const isDripFeed = Boolean(order.runs && order.runs > 1 && order.interval);
      if (isDripFeed) {
        const dynamicTtlHours = Math.max(72, Math.ceil(((order.runs || 1) * (order.interval || 60)) / 60) + 48);
        const orderDynamicThreshold = new Date(Date.now() - dynamicTtlHours * 60 * 60 * 1000);
        if (order.createdAt > orderDynamicThreshold) {
          log.info(`Skipping Drip-Feed order ${order.id} TTL sweep (within scheduled run window: ${dynamicTtlHours}h)`);
          continue;
        }
      }

      // 1.1 Dynamic TTL check for SmartCampaign orders (do not cancel orders while campaign is actively running or paused)
      if (order.smartCampaign && ['RUNNING', 'PAUSED'].includes(order.smartCampaign.status)) {
        const smartTtlHours = Math.max(72, (order.smartCampaign.totalDays || 1) * 24 + 48);
        const smartDynamicThreshold = new Date(Date.now() - smartTtlHours * 60 * 60 * 1000);
        if (order.createdAt > smartDynamicThreshold) {
          log.info(`Skipping Smart Drip order ${order.id} TTL sweep (active campaign ${order.smartCampaign.id}, within scheduled run window: ${smartTtlHours}h)`);
          continue;
        }
      }

      let remains = order.remains ?? order.quantity;
      let statusFromProvider: string | null = null;

      if (order.externalId && order.service.provider) {
        try {
          const provider = await providerService.getWorkerProviderInstance(order.service.provider);
          const providerStatus = await provider.getOrderStatus(order.externalId);
          statusFromProvider = providerStatus.status?.toLowerCase() || null;
          
          if (providerStatus.remains !== undefined && providerStatus.remains !== null) {
            const parsedRemains = parseInt(providerStatus.remains, 10);
            if (!isNaN(parsedRemains)) {
              remains = parsedRemains;
            }
          }
        } catch (apiErr: unknown) {
          log.error('Failed to get status from provider during TTL sweep, falling back to local database values', { orderId: order.id, error: (apiErr instanceof Error ? apiErr.message : String(apiErr)) });
          if ((apiErr instanceof Error ? apiErr.message : String(apiErr))?.includes('Incorrect order ID') || (apiErr instanceof Error ? apiErr.message : String(apiErr))?.includes('not found') || (apiErr instanceof Error ? apiErr.message : String(apiErr))?.includes('not exist')) {
            remains = order.quantity;
            statusFromProvider = 'error';
          } else {
            log.warn(`Skipping order ${order.id} TTL sweep due to transient provider API error: ${(apiErr instanceof Error ? apiErr.message : String(apiErr))}`);
            continue;
          }
        }
      }

      // 2. Safe Anti-Drain Rule: If provider is still actively in progress, DO NOT cancel or refund!
      const normalizedStatus = (statusFromProvider || '').toLowerCase().replace(/[\s-]+/g, '_');
      if (normalizedStatus === 'in_progress' || normalizedStatus === 'processing' || normalizedStatus === 'pending') {
        await db.order.updateMany({
          where: { id: order.id, status: 'IN_PROGRESS' },
          data: {
            remains: Math.max(0, remains),
            updatedAt: new Date(),
          }
        });

        const orderAgeHours = Math.floor((Date.now() - order.createdAt.getTime()) / (1000 * 60 * 60));
        if (orderAgeHours > 168) { // > 7 days
          log.warn(`Order ${order.id} still in_progress at provider after ${orderAgeHours}h (remains: ${remains}/${order.quantity})`, {
            orderId: order.id,
            externalId: order.externalId
          });
        }
        continue;
      }

      const quantity = order.quantity;
      const charge = order.charge;

      let targetStatus: 'COMPLETED' | 'ERROR' | 'PARTIAL';
      let refundCents = 0;
      let delivered = 0;
      let reasonText = '';

      if (normalizedStatus === 'completed') {
        targetStatus = 'COMPLETED';
        refundCents = 0;
        delivered = quantity;
        reasonText = `Заказ завершён (подтверждено провайдером). Выполнено ${delivered} из ${quantity}.`;
      } else if (normalizedStatus === 'canceled' || normalizedStatus === 'error' || normalizedStatus === 'fail') {
        targetStatus = 'ERROR';
        refundCents = Number(charge);
        delivered = 0;
        reasonText = `Заказ отменён провайдером. Стоимость полностью возвращена на баланс.`;
      } else if (normalizedStatus === 'partial') {
        targetStatus = 'PARTIAL';
        refundCents = calculatePartialRefund({ remains, quantity, charge });
        delivered = Math.max(0, quantity - remains);
        reasonText = `Заказ частично выполнен провайдером. Выполнено ${delivered} из ${quantity}. Невыполненный остаток возвращён на баланс.`;
      } else if (!order.externalId || !order.service?.provider) {
        // Fallback for orders without an active external provider (local sandbox/seed or orphaned orders)
        if (remains <= 0) {
          targetStatus = 'COMPLETED';
          refundCents = 0;
          delivered = quantity;
          reasonText = `Заказ завершён по таймауту (72ч IN_PROGRESS). Выполнено ${delivered} из ${quantity}.`;
        } else if (remains >= quantity) {
          targetStatus = 'ERROR';
          refundCents = Number(charge);
          delivered = 0;
          reasonText = `Заказ завершён по таймауту (72ч IN_PROGRESS). Выполнено 0 из ${quantity}. Стоимость возвращена на баланс.`;
        } else {
          targetStatus = 'PARTIAL';
          refundCents = calculatePartialRefund({ remains, quantity, charge });
          delivered = Math.max(0, quantity - remains);
          reasonText = `Заказ завершён по таймауту (72ч IN_PROGRESS). Выполнено ${delivered} из ${quantity}. Невыполненный остаток возвращён на баланс.`;
        }
      } else {
        // Safe Invariant: Never auto-cancel long-running orders unless the provider explicitly answered terminal status
        log.info(`Order ${order.id} has no terminal status from provider (status: ${statusFromProvider || 'unknown'}). Keeping in IN_PROGRESS.`);
        continue;
      }

      try {
        await db.$transaction(async (tx) => {
          // Optimistic Lock: ensure status is still IN_PROGRESS
          const updated = await tx.order.updateMany({
            where: { id: order.id, status: 'IN_PROGRESS' },
            data: { 
              status: targetStatus, 
              remains: Math.max(0, remains),
              error: reasonText,
              updatedAt: new Date()
            }
          });

          if (updated.count === 0) {
            // Webhook or another worker updated the status first, skip
            return;
          }

          // Cascade cancel associated SmartCampaign and pending SmartTasks if terminated with ERROR or PARTIAL
          if (order.smartCampaign && targetStatus !== 'COMPLETED') {
            await tx.smartCampaign.update({
              where: { id: order.smartCampaign.id },
              data: { status: 'ERROR' }
            });
            await tx.smartTask.updateMany({
              where: { campaignId: order.smartCampaign.id, status: 'PLANNED' },
              data: { status: 'ERROR', error: 'Заказ завершен по таймауту TTL' }
            });
          }

          // Handle Referral Commissions
          if (targetStatus === 'COMPLETED') {
            await LoyaltyService.confirmCommission(tx, order.id);
          } else {
            // ERROR or PARTIAL -> reverse commission
            await LoyaltyService.reverseCommission(tx, order.id);
          }

          // Handle refund
          if (refundCents > 0 && order.userId) {
            const previousRefunds = await tx.ledgerEntry.aggregate({
              where: {
                userId: order.userId,
                status: 'APPROVED',
                ...(order.tenantId ? { tenantId: order.tenantId } : {}),
                OR: [
                  { idempotencyKey: { startsWith: `refund_${order.id}_` } },
                  { idempotencyKey: `refund-order-${order.id}` },
                  { idempotencyKey: `refund-ttl-${order.id}` },
                  { idempotencyKey: `refund-dlq-${order.id}` },
                ]
              },
              _sum: { amount: true },
            });
            const alreadyRefunded = Number(previousRefunds._sum.amount || 0);

            let effectiveRefundCents = refundCents;
            if (targetStatus === 'ERROR') {
              effectiveRefundCents = Math.max(0, Number(order.charge) - alreadyRefunded);
            } else {
              effectiveRefundCents = Math.max(0, Math.min(refundCents, Number(order.charge) - alreadyRefunded));
            }

            refundCents = effectiveRefundCents;

            if (effectiveRefundCents > 0) {
              const refundKey = `refund-ttl-${order.id}`;
              const existingLedger = await tx.ledgerEntry.findFirst({
                where: {
                  idempotencyKey: refundKey,
                  ...(order.tenantId ? { tenantId: order.tenantId } : {})
                }
              });

              if (!existingLedger) {
                await WalletOps.refund(
                  tx,
                  order.userId,
                  effectiveRefundCents,
                  reasonText,
                  { idempotencyKey: refundKey, tenantId: order.tenantId }
                );
              }
            }
          }

          processedCount++;
          const refundRub = (refundCents / 100).toFixed(2);
          processedDetails.push(
            `• ID: \`${order.id}\` (#${order.numericId}), Юзер: \`${order.userId}\`, Выполнено: ${delivered}/${quantity}, Статус: \`${targetStatus}\`, Возврат: ${refundRub} ₽`
          );
        }, { isolationLevel: 'Serializable' });

        CompensationService.trackCompensation(order.id).catch(err => log.error('Failed to track compensation on TTL sweep', { orderId: order.id, error: (err instanceof Error ? err.message : String(err)) }));
      } catch (orderErr: unknown) {
        log.error(`runInProgressTTLSweep: failed to sweep order ${order.id}`, { error: (orderErr instanceof Error ? orderErr.message : String(orderErr)) });
      }
    }

    if (stuckOrders.length < IN_PROGRESS_TTL_BATCH_SIZE) {
      hasMore = false;
    }
  }

  if (processedCount > 0) {
    log.info(`InProgress TTL sweep completed`, { processedCount, durationMs: Date.now() - startedAt });
    await sendAdminAlert(
      `⏱️ *in-progress-ttl автоотмена*\nОбработано зависших заказов: ${processedCount}\n\n${processedDetails.join('\n')}`,
      'WARNING'
    );
  } else {
    log.info('InProgress TTL sweep completed: no stuck orders found');
  }
}

/**
 * PENDING_CHECK TTL Sweep: Finds orders stuck in PENDING_CHECK for >24 hours.
 * These orders have charged the user's balance but never reached a provider.
 * Refunds the full amount and marks as ERROR.
 */
export async function runPendingCheckTTLSweep(): Promise<void> {
  const PENDING_CHECK_TTL_HOURS = 24;
  const threshold = new Date(Date.now() - PENDING_CHECK_TTL_HOURS * 60 * 60 * 1000);

  const stuckOrders = await db.order.findMany({
    where: {
      status: 'PENDING_CHECK',
      createdAt: { lt: threshold }
    },
    select: {
      id: true,
      numericId: true,
      userId: true,
      charge: true,
      externalId: true,
      tenantId: true,
      service: {
        select: {
          provider: true
        }
      }
    },
    take: 100
  });

  if (stuckOrders.length === 0) return;

  let processedCount = 0;

  for (const order of stuckOrders) {
    let statusFromProvider: string | null = null;

    if (order.externalId && order.service?.provider) {
      try {
        const provider = await providerService.getWorkerProviderInstance(order.service.provider);
        const providerStatus = await provider.getOrderStatus(order.externalId);
        statusFromProvider = providerStatus.status?.toLowerCase() || null;
      } catch (apiErr: unknown) {
        log.error('Failed to get status from provider during PENDING_CHECK TTL sweep', { orderId: order.id, error: (apiErr instanceof Error ? apiErr.message : String(apiErr)) });
        if ((apiErr instanceof Error ? apiErr.message : String(apiErr))?.includes('Incorrect order ID') || (apiErr instanceof Error ? apiErr.message : String(apiErr))?.includes('not found') || (apiErr instanceof Error ? apiErr.message : String(apiErr))?.includes('not exist')) {
          statusFromProvider = 'error';
        } else {
          log.warn(`Skipping order ${order.id} PENDING_CHECK TTL sweep due to transient provider API error: ${(apiErr instanceof Error ? apiErr.message : String(apiErr))}`);
          continue;
        }
      }

      const normalizedStatus = (statusFromProvider || '').toLowerCase().replace(/[\s-]+/g, '_');
      if (normalizedStatus === 'completed' || normalizedStatus === 'processing' || normalizedStatus === 'in_progress' || normalizedStatus === 'pending') {
        log.warn(`Order ${order.id} is active at provider (status: ${statusFromProvider}). Skipping auto-refund to prevent loss.`);
        continue;
      }

      // Only cancel if provider explicitly confirmed terminal cancellation or failure
      if (!['canceled', 'cancelled', 'error', 'fail', 'failed'].includes(normalizedStatus)) {
        log.info(`Skipping order ${order.id} PENDING_CHECK sweep (status: ${statusFromProvider || 'unknown'}). Order kept active.`);
        continue;
      }
    } else {
      // If order was never sent or has no externalId, do NOT auto-cancel. Keep for staff triage.
      log.warn(`Order #${order.numericId} (${order.id}) in PENDING_CHECK has no externalId. Kept for operator review / auto-flush.`);
      continue;
    }

    try {
      await db.$transaction(async (tx) => {
        const updated = await tx.order.updateMany({
          where: { id: order.id, status: 'PENDING_CHECK' },
          data: {
            status: 'ERROR',
            error: `Заказ отменён провайдером (статус: ${statusFromProvider || 'error'})`,
            updatedAt: new Date()
          }
        });

        if (updated.count === 0) return;

        await LoyaltyService.reverseCommission(tx, order.id);

        if (order.charge > 0) {
          const refundKey = `refund-pending-check-ttl-${order.id}`;
          const existing = await tx.ledgerEntry.findFirst({
            where: {
              idempotencyKey: refundKey,
              ...(order.tenantId ? { tenantId: order.tenantId } : {})
            }
          });
          if (!existing) {
            await WalletOps.refund(
              tx,
              order.userId,
              Number(order.charge),
              `Авто-возврат: заказ #${order.numericId} отменён провайдером`,
              { idempotencyKey: refundKey, tenantId: order.tenantId }
            );
          }
        }

        processedCount++;
      }, { isolationLevel: 'Serializable' });

      CompensationService.trackCompensation(order.id).catch(err => log.error('Failed to track compensation on pending check TTL sweep', { orderId: order.id, error: (err instanceof Error ? err.message : String(err)) }));
    } catch (err) {
      const errMsg = err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err);
      log.error(`runPendingCheckTTLSweep: failed for order ${order.id}`, { error: errMsg });
    }
  }

  if (processedCount > 0) {
    log.info(`PENDING_CHECK TTL sweep completed`, { processedCount });
    await sendAdminAlert(
      `⏱️ *pending-check-ttl*\nОчищено зависших PENDING_CHECK заказов: ${processedCount}`,
      'WARNING'
    );
  }
}

/**
 * FR-5: Фоновый процесс очистки слотов бустов и кулдаунов сессий Telegram MTProto
 */
export async function runTelegramBoostSweep(nowMs?: number): Promise<{
  expiredSlotsFreed: number;
  cooledDownSlotsReset: number;
  sessionsRestored: number;
}> {
  const { TelegramSessionPoolManager } = await import('@/services/production/telegram-session-pool');
  const pool = TelegramSessionPoolManager.getInstance();
  const result = await pool.sweepExpiredBoostsAndCooldowns(nowMs);
  log.info('Telegram boost and cooldown sweep completed', result);
  return result;
}

