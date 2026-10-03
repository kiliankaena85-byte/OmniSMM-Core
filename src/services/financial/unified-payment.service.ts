import { db } from '@/lib/db';
import { getBaseUrlAsync, getCanonicalTenantBaseUrl } from '@/utils/get-base-url';
import { SettingsManager } from '@/lib/settings';
import { ExactMath } from '@/lib/financial/exact-math';

type PaymentMetadata = {
  source?: string;
  serviceId?: string;
  promoId?: string;
  [key: string]: unknown;
};

export class UnifiedPaymentService {
  /**
   * Universal method to generate payment URLs for the Bot (Deposits & Top-ups).
   * Reused central PaymentGatewayFactory to support Robokassa, YooKassa, and CryptoBot without duplication.
   */
  static async createPayment(
    projectId: string | undefined, 
    userId: string, 
    amountRub: number, 
    description: string, 
    metadata: PaymentMetadata,
    gateway: 'yookassa' | 'cryptobot' | 'robokassa' = 'yookassa',
    tenantId?: string
  ): Promise<{ success: boolean; confirmationUrl?: string; paymentId?: string; error?: string }> {
    try {
      const amountCents = ExactMath.rublesToKopecks(amountRub);
      const resolvedTenantId = tenantId || (metadata?.tenantId as string) || 'smmplan';

      // 1. Create a PENDING payment record
      const payment = await db.payment.create({
        data: {
          userId,
          tenantId: resolvedTenantId,
          amount: amountCents,
          currency: 'RUB',
          status: 'PENDING',
          gateway
        }
      });

      // 1.1 Persist payment metadata to Redis with 24h TTL for webhook order auto-creation
      if (metadata && typeof metadata === 'object') {
        try {
          const { redis } = await import('@/lib/redis');
          await redis.set(`payment:metadata:${payment.id}`, JSON.stringify(metadata), 'EX', 86400);
        } catch (err) {
          console.warn('[UnifiedPayment] Failed to persist payment metadata to redis:', err);
        }
      }

      const { SettingsProvider } = await import('@/lib/settings');
      const supportDomain = await SettingsProvider.getSupportEmailDomain(resolvedTenantId);
      let successUrl = `${getCanonicalTenantBaseUrl(resolvedTenantId)}/dashboard`;

      // If initiated from Telegram Bot, return directly back into the bot!
      if (metadata?.source === 'BOT') {
        const botUsername = process.env.TELEGRAM_BOT_USERNAME || (resolvedTenantId === 'flux' ? 'smmflux_support_bot' : 'SMMplansapport_bot');
        successUrl = `https://t.me/${botUsername.replace('@', '')}?start=pay_ok_${payment.id}`;
      }

      // 2. Generate Payment Link synchronously
      const { PaymentGatewayFactory } = await import('@/services/financial/payment-gateway.service');
      const gatewaySvc = PaymentGatewayFactory.getGateway(gateway);
      
      const gatewayResult = await gatewaySvc.createPayment({
        paymentId: payment.id,
        userId,
        tenantId: resolvedTenantId,
        amountRub,
        email: null,
        successUrl,
        description,
        metadata: { ...metadata, tenantId: resolvedTenantId },
        isTestMode: await SettingsManager.isTestMode(resolvedTenantId)
      });

      if (gatewayResult.remoteGatewayId || gatewayResult.paymentUrl) {
        await db.payment.update({
          where: { id: payment.id },
          data: {
            gatewayId: gatewayResult.remoteGatewayId || undefined,
            checkoutUrl: gatewayResult.paymentUrl || undefined
          }
        });
      }

      return {
        success: true,
        paymentId: payment.id,
        confirmationUrl: gatewayResult.paymentUrl || `/payment-redirect?id=${payment.id}`
      };

    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[UnifiedPayment] System error:', msg);

      try {
        const { sendAdminAlert } = await import('@/lib/notifications');
        sendAdminAlert(
          `💳 <b>[FINANCE ALERT: Ошибка создания платежа]</b>\n\n` +
          `👤 <b>Пользователь:</b> <code>${userId}</code>\n` +
          `💰 <b>Сумма:</b> <b>${amountRub} ₽</b>\n` +
          `🏛️ <b>Шлюз:</b> <b>${gateway}</b>\n` +
          `⚠️ <b>Ошибка:</b> <code>${msg || 'Ошибка платежного шлюза'}</code>`,
          'WARNING'
        );
      } catch { /* alert must not throw */ }

      return { success: false, error: msg || 'Ошибка платежного шлюза' };
    }
  }
}
