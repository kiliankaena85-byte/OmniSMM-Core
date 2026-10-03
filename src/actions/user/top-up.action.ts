'use server';

import { db } from "@/lib/db";
import { verifySession } from "@/lib/session";
import { headers } from "next/headers";
import { getBaseUrlAsync } from "@/utils/get-base-url";
import { getClientIp } from "@/utils/ip";
import { RateLimitService } from "@/services/core/rate-limit.service";
import { ExactMath } from "@/lib/financial/exact-math";

import { resolveTenantFromRequest } from "@/lib/tenant-resolver-edge";
import { SettingsProvider } from "@/lib/settings";

export interface TopUpActionResult {
  success: boolean;
  paymentUrl?: string;
  error?: string;
}

export async function createTopUpPaymentAction(
  amountRub: number,
  gateway: 'yookassa' | 'cryptobot' | 'robokassa' | 'sbp' = 'yookassa',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  idempotencyKey?: string
): Promise<TopUpActionResult> {
  try {
    const reqHeaders = await headers();
    const requestTenantId = resolveTenantFromRequest(reqHeaders);

    const session = await verifySession(requestTenantId);
    if (!session) {
      return { success: false, error: "Требуется авторизация" };
    }
    
    const isAllowed = await RateLimitService.check(`topup:${session.userId}`, 5, 300);
    if (!isAllowed) {
      return { success: false, error: "Слишком много попыток пополнения. Попробуйте через 5 минут." };
    }

    if (typeof amountRub !== 'number' || isNaN(amountRub) || !isFinite(amountRub) || amountRub <= 0) {
      return { success: false, error: "Некорректная сумма пополнения" };
    }

    const amountCents = Number(ExactMath.rublesToKopecks(amountRub));
    if (amountCents < 1000) {
      return { success: false, error: "Минимальная сумма пополнения — 10 ₽" };
    }

    // Fetch user scoped strictly to request tenant
    const dbUser = await db.user.findFirst({ where: { id: session.userId, tenantId: requestTenantId } });
    if (!dbUser) {
      return { success: false, error: "Пользователь не найден." };
    }
    if (dbUser.isDeleted === true || dbUser.isActive === false) {
      return { success: false, error: "Ваш аккаунт заблокирован или удален" };
    }

    // SPEC-TESTER-INVITES-2026 (INV-TESTER-04): Guard test mode top-ups
    const isTestMode = await SettingsProvider.isTestMode(requestTenantId);
    if (isTestMode) {
      const isStaff = ['ADMIN', 'OWNER', 'MANAGER', 'SUPPORT'].includes(dbUser.role);
      if (!dbUser.isTester && !isStaff) {
        return {
          success: false,
          error: "Тестовое пополнение доступно только авторизованным тестировщикам по ссылке-приглашению.",
        };
      }
    }

    // Anti-fraud: gateways with chargeback risk require Telegram verification over 15,000 RUB
    if ((gateway === 'yookassa' || gateway === 'sbp' || gateway === 'robokassa') && amountCents > 1_500_000) {
      if (!dbUser.telegramId) {
        return {
          success: false,
          error: "Для пополнения баланса свыше 15 000 ₽ картой или СБП, пожалуйста, привяжите ваш Telegram-аккаунт в настройках профиля."
        };
      }
    }

    if (gateway === 'cryptobot' && amountCents > 1_500_000) {
      return {
        success: false,
        error: "Криптовалюта доступна для пополнений до 15 000 ₽. Для больших сумм используйте карту."
      };
    }

    // Check for existing pending payment with same key created within the last 60 seconds (anti-double-click)
    const twoMinutesAgo = new Date(Date.now() - 60 * 1000);
    const existingPayment = await db.payment.findFirst({
      where: {
        userId: session.userId,
        tenantId: requestTenantId,
        amount: amountCents,
        gateway,
        status: 'PENDING',
        createdAt: { gte: twoMinutesAgo },
        checkoutUrl: { not: null },
      },
      orderBy: { createdAt: 'desc' }
    });

    if (existingPayment && existingPayment.checkoutUrl) {
      console.info(`[TopUp] Idempotency hit: returning existing pending payment ${existingPayment.id}`);
      return { success: true, paymentUrl: existingPayment.checkoutUrl };
    }

    const consentIp = await getClientIp();
    const consentUserAgent = reqHeaders.get("user-agent") || "Unknown";

    const termsDoc = await db.contentItem.findUnique({
      where: { slug: 'terms' },
      select: { updatedAt: true }
    });
    const targetTenantId = requestTenantId;
    const legalSettings = await SettingsProvider.getContactAndLegalSettings(targetTenantId);
    const legalInn = legalSettings.COMPANY_INN || 'default_inn';
    const consentVersion = termsDoc 
      ? `terms:${targetTenantId}:${legalInn}:${termsDoc.updatedAt.toISOString()}` 
      : `fallback:${targetTenantId}:${legalInn}:${new Date().toISOString().split('T')[0]}`;

    const payment = await db.payment.create({
      data: {
        userId: session.userId,
        tenantId: targetTenantId,
        amount: amountCents,
        currency: "RUB",
        status: "PENDING",
        gateway,
        consentIp,
        consentUserAgent,
        consentVersion
      }
    });

    const { PaymentGatewayFactory } = await import('@/services/financial/payment-gateway.service');
    const gatewaySvc = PaymentGatewayFactory.getGateway(gateway);
    const successUrl = `${await getBaseUrlAsync()}/dashboard/add-funds?success=1`;
    const description = gateway === 'yookassa'
      ? `Оплата услуг IT-агентства (Digital Consulting, Счёт: ${payment.id})`
      : `Пополнение баланса (Счёт: ${payment.id})`;

    try {
      const gatewayResult = await gatewaySvc.createPayment({
        paymentId: payment.id,
        userId: session.userId,
        tenantId: targetTenantId,
        amountRub,
        email: dbUser.email,
        successUrl,
        description,
        isTestMode: isTestMode,
        metadata: { type: 'deposit', tenantId: targetTenantId }
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
        paymentUrl: gatewayResult.paymentUrl || `/payment-redirect?id=${payment.id}`
      };
    } catch (err: unknown) {
      await db.payment.update({
        where: { id: payment.id },
        data: { status: 'CANCELED' }
      }).catch(() => {});

      const errorMessage = err instanceof Error ? err.message : 'Ошибка создания платежа в платежной системе';
      console.error('[TopUpAction] Gateway error:', errorMessage);
      return {
        success: false,
        error: errorMessage
      };
    }
  } catch (outerErr: unknown) {
    console.error('[TopUpAction] Fatal error:', outerErr);
    return {
      success: false,
      error: outerErr instanceof Error ? outerErr.message : 'Непредвиденная системная ошибка при создании платежа'
    };
  }
}
