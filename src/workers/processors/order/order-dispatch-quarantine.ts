// tenant-isolation-ignore: Background worker executed within order.processor runWithTenant wrapper
/**
 * Dispatch quarantine paths (order → PENDING_CHECK, UnrecoverableError, no further routing).
 * INV-GW-05 (SPEC-REDTEAM-GATEWAYS-2026): ambiguous provider outcomes — the provider MAY have
 * accepted the order (timeout, network failure, 5xx, unparsable 200), so it is NEVER cascaded.
 */
import { UnrecoverableError } from 'bullmq';
import { db } from '../../../lib/db';
import { getRedisConnection } from '@/lib/queue-manager';
import type { PrioritizedRoute } from '../../../services/providers/smart-routing.service';
import type { DispatchLoopContext } from './types';

type DispatchOrder = DispatchLoopContext['order'];

const AMBIGUOUS_MESSAGE_MARKERS = ['timeout', 'etimedout', 'econnreset', 'socket hang up', 'eai_again'];

export function isAmbiguousProviderOutcome(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && (error as { isAmbiguous?: unknown }).isAmbiguous === true) {
    return true;
  }
  const errMsg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  // undici network failure: the TCP request may already have been delivered to the provider
  if (error instanceof TypeError && errMsg.includes('fetch failed')) return true;
  return AMBIGUOUS_MESSAGE_MARKERS.some(marker => errMsg.includes(marker));
}

async function releaseDispatchKeys(orderId: string, redisKey: string): Promise<void> {
  await getRedisConnection().del(redisKey, `order:dispatch_lock:${orderId}`).catch(() => {});
}

export async function quarantineAmbiguousDispatch(
  order: DispatchOrder,
  providerName: string,
  redisKey: string,
  error: unknown
): Promise<never> {
  const message = error instanceof Error ? error.message : String(error);
  await db.order.update({
    where: { id: order.id },
    data: { status: 'PENDING_CHECK', error: `Сетевой таймаут при отправке: ${message}` }
  });
  try {
    const { sendAdminAlert } = await import('@/lib/notifications');
    sendAdminAlert(
      `⚠️ [ТАЙМАУТ СВЯЗИ С ПОСТАВЩИКОМ] Заказ #${order.numericId} (Услуга: ${order.service?.name || ''})\n` +
      `Поставщик ${providerName} не ответил вовремя. Заказ переведён в статус PENDING_CHECK.`,
      'WARNING'
    );
  } catch { /* ignore */ }
  await releaseDispatchKeys(order.id, redisKey);
  throw new UnrecoverableError(`Ambiguous Timeout: ${message}`);
}

/** Manual failover mode: a definitive provider rejection requires operator triage instead of cascading. */
export async function quarantineManualFailover(
  order: DispatchOrder,
  route: PrioritizedRoute,
  redisKey: string,
  originalError: string
): Promise<never> {
  const { OrderTriageAlertService } = await import('@/services/orders/order-triage-alert.service');
  const classification = OrderTriageAlertService.classifyError(originalError);
  const formattedError = OrderTriageAlertService.formatOrderErrorMessage(classification, originalError, route.provider.name);

  await db.order.update({
    where: { id: order.id },
    data: { status: 'PENDING_CHECK', providerId: route.providerId, providerServiceId: route.providerServiceId, error: formattedError }
  });

  try {
    await OrderTriageAlertService.sendOrderCheckAlert({
      orderId: order.id, numericId: order.numericId, serviceName: order.service?.name || '',
      categoryName: order.service?.category?.name, networkName: order.service?.category?.network?.name,
      link: order.link, quantity: order.quantity, chargeKopecks: order.charge,
      userEmail: order.user?.email, tenantId: order.tenantId, providerName: route.provider.name,
    }, originalError, route.provider.name);
  } catch { /* ignore */ }

  await releaseDispatchKeys(order.id, redisKey);
  throw new UnrecoverableError(`Manual failover mode: operator triage required`);
}
