// tenant-isolation-ignore: Background worker executed within order.processor runWithTenant wrapper
import { db } from '../../../lib/db';
import { getRedisConnection } from '@/lib/queue-manager';
import { logger } from '../../../lib/logger';
import { providerService } from '../../../services/providers/provider.service';
import { SmartRoutingService, PrioritizedRoute } from '../../../services/providers/smart-routing.service';
import { OrderRouteEvaluator } from './order-route-evaluator';
import { OrderAllRoutesFailedHandler } from './order-all-routes-failed-handler';
import { DatabaseOrderError, DispatchLoopContext } from './types';
import { parseCustomData } from '../../../schemas/custom-data';
import { isAmbiguousProviderOutcome, quarantineAmbiguousDispatch, quarantineManualFailover } from './order-dispatch-quarantine';

const log = logger.child({ component: 'OrderDispatchExecutor' });

export class OrderDispatchExecutor {
  static async executeDispatchLoop(ctx: DispatchLoopContext): Promise<void> {
    const { order, candidateRoutes, primaryProviderId, redisKey } = ctx;
    const connection = getRedisConnection();

    let dispatched = false;
    let lastError = '';
    let marginRejectionCount = 0;
    let lastMarginError = '';

    for (let i = 0; i < candidateRoutes.length; i++) {
      const route = candidateRoutes[i];
      const nextRoute = candidateRoutes[i + 1];

      const check = await OrderRouteEvaluator.verifyRouteCapabilitiesAndMargin(order, route, primaryProviderId);
      if (!check.isCompatible) {
        lastError = check.reason || '';
        if (check.isMarginError) {
          marginRejectionCount++;
          lastMarginError = lastError;
        }
        continue;
      }

      try {
        const provider = await providerService.getWorkerProviderInstance(route.provider as unknown as import('@prisma/client').Provider);
        const runQty = (order.isDripFeed && order.runs && order.runs > 0)
          ? Math.max(1, Math.floor(order.quantity / order.runs))
          : order.quantity;

        const serviceName = order.service?.name?.toLowerCase() || '';
        const payload: Record<string, unknown> = {
          service: route.providerServiceId,
          link: order.link,
          quantity: runQty,
          ref: order.id,
          custom_id: order.id
        };

        if (order.isDripFeed && order.runs && order.interval) {
          payload.runs = order.runs;
          payload.interval = order.interval;
        }

        if (order.customData) {
          const parsedCustom = parseCustomData(order.customData);
          if (parsedCustom) {
            switch (parsedCustom.kind) {
              case 'REACTIONS': {
                const reactionStr = parsedCustom.emojis.join(',');
                payload.reaction = reactionStr;
                payload.reactions = reactionStr;
                break;
              }
              case 'POLL': {
                payload.answers_number = String(parsedCustom.optionIndex);
                if (parsedCustom.optionText) {
                  payload.answer_text = parsedCustom.optionText;
                }
                break;
              }
              case 'COMMENTS': {
                payload.comments = parsedCustom.lines.join('\n');
                break;
              }
              case 'MENTIONS': {
                payload.usernames = parsedCustom.usernames.join('\n');
                if (parsedCustom.hashtag) {
                  payload.hashtag = parsedCustom.hashtag;
                }
                break;
              }
              case 'SUBSCRIPTION': {
                payload.min = parsedCustom.minPerPost;
                payload.max = parsedCustom.maxPerPost;
                payload.posts = parsedCustom.futurePosts;
                payload.delay = parsedCustom.delayMinutes;
                break;
              }
              case 'MEDIA_GROUP': {
                payload.media_group = [parsedCustom.firstPostUrl, parsedCustom.lastPostUrl].join(',');
                break;
              }
            }
          } else {
            // Legacy / raw string fallback
            const cType = order.service?.customDataType;
            if (cType === 'NUMBER' || (serviceName.includes('опрос') && !serviceName.includes('просмотр')) || serviceName.includes('голосование') || serviceName.includes('poll')) {
              payload.answers_number = order.customData;
            } else if (serviceName.includes('реакц') || serviceName.includes('reaction')) {
              payload.reaction = order.customData;
              payload.reactions = order.customData;
            } else {
              payload.comments = order.customData;
            }
          }
        }

        await connection.set(redisKey, '1', 'EX', 3600);

        const { AdaptiveRateLimiterService } = await import('../../../services/providers/adaptive-rate-limiter.service');
        await AdaptiveRateLimiterService.acquireToken(route.providerId);

        const response = await provider.createOrder(payload as Parameters<typeof provider.createOrder>[0]);

        if (response.error && !response.order) {
          throw new Error(response.error);
        }

        const extId = response.order ? response.order.toString() : '';

        try {
          await db.order.update({
            where: { id: order.id },
            data: {
              externalId: extId,
              providerId: route.providerId,
              providerServiceId: route.providerServiceId,
              status: 'IN_PROGRESS'
            }
          });
        } catch (dbError) {
          throw new DatabaseOrderError(dbError instanceof Error ? dbError.message : String(dbError));
        }

        if (route.providerId !== primaryProviderId) {
          await SmartRoutingService.recordFailoverEvent({
            serviceId: order.serviceId,
            action: 'FAILOVER_SWAP',
            fromProviderId: primaryProviderId,
            toProviderId: route.providerId,
            reason: `Failover to ${route.provider.name} succeeded. Previous error: ${lastError}`
          });
        }

        log.info(`[OrderProcessor] Dispatched Order ${order.id} | Provider: ${route.provider.name} | External ID: ${extId}`);
        dispatched = true;
        await connection.del(`order:dispatch_lock:${order.id}`).catch(() => {});
        break;

      } catch (error: unknown) {
        if (error instanceof DatabaseOrderError || (typeof error === 'object' && error !== null && 'isDatabaseError' in error)) {
          throw error;
        }

        // INV-GW-05: the provider MAY have accepted the order → PENDING_CHECK, never cascade
        if (isAmbiguousProviderOutcome(error)) {
          await quarantineAmbiguousDispatch(order, route.provider.name, redisKey, error);
        }

        const originalError = error instanceof Error ? error.message : String(error);
        lastError = originalError;

        if (route.failoverMode !== 'automatic') {
          await quarantineManualFailover(order, route, redisKey, originalError);
        }

        if (nextRoute) {
          await SmartRoutingService.recordFailoverEvent({
            serviceId: order.serviceId, action: 'FAILOVER_SWAP', fromProviderId: route.providerId,
            toProviderId: nextRoute.providerId, reason: `Provider ${route.provider.name} failed: ${originalError}. Cascading.`
          });
        }
      }
    }

    if (!dispatched) {
      await OrderAllRoutesFailedHandler.handle(ctx, marginRejectionCount, lastMarginError, lastError);
    }
  }
}
