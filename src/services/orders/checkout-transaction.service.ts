/**
 * (c) 2024-2026 SMMplan. All rights reserved.
 * Order checkout transaction execution and idempotency engine.
 */
import { randomUUID } from 'crypto';
import { assertDripFeedFloor } from '@/services/orders/drip-feed-floor';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { runSerializableTransaction } from '@/lib/transactions';
import { marketingService } from '@/services/marketing.service';
import { RateLimitService } from '@/services/core/rate-limit.service';
import { SettingsManager, SettingsProvider } from '@/lib/settings';
import { WalletOps } from '@/services/financial/wallet-ops';
import { IdempotencyKeys } from '@/services/financial/idempotency-keys';
import { AccountExistsError } from '@/utils/error-handler';
import { SmartDripService } from '@/services/dripfeed/smart-drip.service';
import { MutexManager } from '@/lib/redis-lock';
import { ExactMath } from '@/lib/financial/exact-math';
import type { DbServiceWithCategory } from './checkout-preflight-guard.service';

export class IdempotencyConflictError extends Error {
  constructor(public existingOrder: unknown) {
    super('Idempotency conflict');
    this.name = 'IdempotencyConflictError';
  }
}

export interface CheckoutTransactionInput {
  service: DbServiceWithCategory;
  normalizedLink: string;
  normalizedMediaGroupLink?: string;
  hasMediaGroup: boolean;
  quantity: number;
  email: string;
  normalizedPromo?: string;
  effectiveRuns?: number;
  effectiveInterval?: number;
  customData?: string;
  gateway: string;
  idempotencyKey?: string;
  isLinkOverridden?: boolean;
  isSmartDrip?: boolean;
  smartDripDays?: number;
  abVariant?: 'A' | 'B' | 'C';
  tenantId: string;
  consentIp: string;
  consentUserAgent: string;
  currentSessionUserId?: string;
}

export class CheckoutTransactionService {
  static async execute(input: CheckoutTransactionInput) {
    const {
      service, normalizedLink, normalizedMediaGroupLink, hasMediaGroup,
      quantity, email, normalizedPromo, effectiveRuns, effectiveInterval,
      customData, gateway, idempotencyKey, isLinkOverridden, isSmartDrip,
      smartDripDays, abVariant, tenantId, consentIp, consentUserAgent,
      currentSessionUserId
    } = input;

    const effectiveIdempotencyKey = (idempotencyKey && idempotencyKey.trim().length >= 10)
      ? idempotencyKey.trim()
      : randomUUID();

    const isTestMode = await SettingsManager.isTestMode(tenantId);

    // 1. Resolve or create user
    let user = await db.user.findFirst({
      where: { email: email.toLowerCase(), tenantId }
    });

    let isNewUser = false;
    if (!user) {
      try {
        user = await db.user.create({
          data: {
            email: email.toLowerCase(),
            tenantId,
            tosAcceptedAt: new Date(),
            tosAcceptedIp: consentIp,
          }
        });
        isNewUser = true;
      } catch (err: unknown) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          user = await db.user.findFirst({
            where: { email: email.toLowerCase(), tenantId }
          });
          if (!user) throw err;
        } else {
          throw err;
        }
      }
    }

    if (user) {
      if (user.isDeleted === true || user.isActive === false) {
        throw new Error("Ваш аккаунт заблокирован или удален");
      }
      if (user.passwordHash && (!currentSessionUserId || currentSessionUserId !== user.id)) {
        throw new AccountExistsError(user.email);
      }
    }

    // 2. Calculate price
    const totalQuantity = quantity;
    if (effectiveRuns && effectiveRuns > 0) {
      assertDripFeedFloor(totalQuantity, effectiveRuns, service.minQty, 'runs');
    } else if (isSmartDrip && smartDripDays && smartDripDays > 0) {
      assertDripFeedFloor(totalQuantity, smartDripDays, service.minQty, 'smart');
    }

    const pricing = await marketingService.calculatePrice(user.id, service.id, totalQuantity, normalizedPromo, { service });

    let promoCodeId: string | null = null;
    if (normalizedPromo) {
      const promoRateAllowed = await RateLimitService.checkCustomKey(`checkout_promo:${consentIp}`, 10, 60);
      if (!promoRateAllowed) {
        throw new Error("Слишком много попыток ввода промокода. Подождите минуту.");
      }

      const promo = await db.promoCode.findUnique({
        where: { code: normalizedPromo },
        select: { id: true, isActive: true, expiresAt: true, maxUses: true, uses: true }
      });
      if (!promo || !promo.isActive) throw new Error("Промокод недействителен или не существует");
      if (promo.expiresAt && promo.expiresAt < new Date()) throw new Error("Срок действия промокода истёк");
      if (promo.maxUses > 0 && promo.uses >= promo.maxUses) throw new Error("Лимит использований промокода исчерпан");
      promoCodeId = promo.id;
    }

    const currentUsdRate = await SettingsProvider.getExchangeRateUSD();
    const envMode = typeof SettingsManager.getEnvironmentMode === 'function' ? await SettingsManager.getEnvironmentMode(tenantId) : 'PRODUCTION';

    const mediaGroupMultiplier = hasMediaGroup ? 2 : 1;
    let finalTotalCents = pricing.totalCents * mediaGroupMultiplier;

    let smartConfig = null;
    let smartMarkupCents = pricing.totalCents;
    if (isSmartDrip) {
      smartConfig = await db.serviceSmartConfig.findUnique({ where: { serviceId: service.id } });
      if (!smartConfig || !smartConfig.isEnabled) throw new Error("Эта услуга не поддерживает Умный Dripfeed");
      const markupBps = BigInt(Math.round(smartConfig.markup * 10000));
      const scaledTotal = BigInt(finalTotalCents) * (ExactMath.BPS_BASE + markupBps);
      finalTotalCents = Number(ExactMath.roundHalfEven(scaledTotal, ExactMath.BPS_BASE));
      const scaledBase = BigInt(pricing.totalCents) * (ExactMath.BPS_BASE + markupBps);
      smartMarkupCents = Number(ExactMath.roundHalfEven(scaledBase, ExactMath.BPS_BASE));
    }

    let paymentAmount = finalTotalCents;
    if (gateway !== 'balance' && finalTotalCents < 1000) {
      paymentAmount = 1000;
    }

    if ((gateway === 'yookassa' || gateway === 'sbp' || gateway === 'robokassa') && paymentAmount > 1_500_000 && !user.telegramId) {
      throw new Error("Для совершения единовременных платежей свыше 15 000 ₽, пожалуйста, привяжите ваш Telegram-аккаунт в личном кабинете либо используйте безналичный расчет по счету для юрлиц и ИП.");
    }

    if (gateway === 'cryptobot' && paymentAmount > 1_500_000) {
      throw new Error("Криптовалюта доступна для пополнений до 15 000 ₽. Для больших сумм используйте карту.");
    }

    const consentVersion = `terms:${tenantId}:${new Date().toISOString().split('T')[0]}`;

    const executeTx = async () => {
      return await runSerializableTransaction(async (tx) => {
        if (effectiveIdempotencyKey) {
          const existingOrder = await tx.order.findUnique({
            where: { idempotencyKey: effectiveIdempotencyKey },
            include: { payment: true }
          });
          if (existingOrder) {
            // INV-BOLA-01: the key is client-supplied — never disclose or mutate a foreign order
            if (existingOrder.userId !== user.id || existingOrder.tenantId !== tenantId) {
              throw new Error('Некорректный ключ запроса. Обновите страницу и повторите оформление.');
            }
            if (existingOrder.status !== 'ERROR') throw new IdempotencyConflictError(existingOrder);
            await tx.order.update({
              where: { id: existingOrder.id },
              data: { idempotencyKey: `${effectiveIdempotencyKey}_failed_${existingOrder.id}` }
            });
          }
        }

        if (promoCodeId) {
          const existingUsage = await tx.promoCodeUsage.findFirst({ where: { promoCodeId, userId: user.id } });
          if (existingUsage) throw new Error("Вы уже использовали данный промокод");
        }

        const orderStatus = gateway === 'balance' ? 'PENDING' : 'AWAITING_PAYMENT';
        const paymentStatus = gateway === 'balance' ? 'SUCCEEDED' : 'PENDING';
        const isDripFeedOrder = Boolean(effectiveRuns && effectiveRuns > 1);

        const newOrder = await tx.order.create({
          data: {
            userId: user.id,
            serviceId: service.id,
            providerId: service.providerId,
            providerServiceId: service.externalId,
            link: normalizedLink,
            isLinkOverridden: isLinkOverridden || false,
            quantity: totalQuantity,
            email: email.toLowerCase(),
            status: orderStatus,
            charge: isSmartDrip && smartConfig ? smartMarkupCents : pricing.totalCents,
            providerCost: pricing.providerCostCents,
            isDripFeed: isDripFeedOrder,
            runs: effectiveRuns || null,
            interval: effectiveInterval || null,
            isTest: isTestMode,
            customData,
            remains: totalQuantity,
            idempotencyKey: effectiveIdempotencyKey,
            promoCodeId: promoCodeId || null,
            discountCents: BigInt(Math.round(pricing.discountCents || 0)),
            abVariant,
            usdToRubRate: currentUsdRate,
            environmentMode: envMode,
            tenantId
          }
        });

        // INV-IDEM-01: the ledger key is bound to the concrete Order row, never to the
        // client-supplied key. A retried ERROR order gets a NEW orderId → NEW key → real debit.
        // Same Serializable tx: INSUFFICIENT_FUNDS rolls the order back atomically.
        let balanceChargeResult = null;
        if (gateway === 'balance') {
          balanceChargeResult = await WalletOps.charge(tx, user.id, finalTotalCents, `Оплата заказа #${newOrder.numericId} с баланса`, {
            idempotencyKey: IdempotencyKeys.forOrderCharge(newOrder.id),
            tenantId
          });
        }

        let secondOrderId: string | undefined;
        if (hasMediaGroup && normalizedMediaGroupLink) {
          const secondOrder = await tx.order.create({
            data: {
              userId: user.id,
              serviceId: service.id,
              providerId: service.providerId,
              providerServiceId: service.externalId,
              link: normalizedMediaGroupLink,
              isLinkOverridden: isLinkOverridden || false,
              quantity: totalQuantity,
              email: email.toLowerCase(),
              status: orderStatus,
              charge: isSmartDrip && smartConfig ? smartMarkupCents : pricing.totalCents,
              providerCost: pricing.providerCostCents,
              isDripFeed: isDripFeedOrder,
              runs: effectiveRuns || null,
              interval: effectiveInterval || null,
              isTest: isTestMode,
              customData: `Медиагруппа: последнее медиа. Основной заказ: ${newOrder.numericId}`,
              remains: totalQuantity,
              promoCodeId: promoCodeId || null,
              discountCents: BigInt(Math.round(pricing.discountCents || 0)),
              abVariant,
              usdToRubRate: currentUsdRate,
              environmentMode: envMode,
              tenantId
            }
          });
          secondOrderId = secondOrder.id;
        }

        if (normalizedPromo) {
          await marketingService.consumePromoCode(tx, normalizedPromo);
        }

        const payment = await tx.payment.create({
          data: {
            userId: user.id,
            amount: paymentAmount,
            currency: 'RUB',
            status: paymentStatus,
            gateway,
            consentIp,
            consentUserAgent,
            consentVersion,
            abVariant,
            tenantId
          }
        });

        await tx.order.update({ where: { id: newOrder.id }, data: { paymentId: payment.id } });
        if (secondOrderId) {
          await tx.order.update({ where: { id: secondOrderId }, data: { paymentId: payment.id } });
        }

        if (isSmartDrip && smartConfig) {
          await SmartDripService.createCampaign(tx, {
            userId: user.id,
            serviceId: service.id,
            link: normalizedLink,
            quantity: totalQuantity,
            days: smartDripDays!,
            paymentId: payment.id,
            orderId: newOrder.id,
            isTestMode
          });
        }

        return {
          orderId: newOrder.id,
          paymentId: payment.id,
          numericId: newOrder.numericId,
          secondOrderId,
          remainingBalanceCents: balanceChargeResult ? Number(balanceChargeResult.balance) : null
        };
      });
    };

    const result = gateway === 'balance'
      ? await MutexManager.withLock(`user_balance_${user.id}`, 15000, 10000, executeTx)
      : await executeTx();

    return {
      result,
      user,
      isNewUser,
      isTestMode,
      finalTotalCents,
      paymentAmount,
      effectiveIdempotencyKey
    };
  }
}
