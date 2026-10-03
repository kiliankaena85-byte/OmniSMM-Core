import { db } from '@/lib/db';
import { runSerializableTransaction } from '@/lib/transactions';
import { WalletOps } from './wallet-ops';
import { revalidatePath } from 'next/cache';
import { sendOrderPaidMail } from '@/lib/smtp';
import { logPromoCodeUsageIfNeeded } from '@/services/marketing-utils';
import { PromoAutomationService } from '../users/promo-automation.service';
import { SecurityAlertService } from '@/services/security/security-alert.service';
import { runWithTenantBypass } from '@/lib/tenant-context';

function safeRevalidatePath(path: string, type?: 'layout' | 'page') {
  try {
    revalidatePath(path, type);
  } catch (err) {
    const msg = err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err);
    console.warn(`[Cache] revalidatePath failed for ${path}:`, msg);
  }
}

function parseYooKassaAmountToKopecks(val: unknown): bigint {
  if (typeof val !== 'string') {
    throw new Error('INVALID_GATEWAY_AMOUNT_FORMAT');
  }
  const normalized = val.trim();
  const decimalMatch = /^(\d+)\.(\d{2})$/.exec(normalized);
  if (decimalMatch) {
    return BigInt(decimalMatch[1]) * 100n + BigInt(decimalMatch[2]);
  }
  const integerMatch = /^(\d+)$/.exec(normalized);
  if (integerMatch) {
    return BigInt(integerMatch[1]) * 100n;
  }
  throw new Error(`INVALID_GATEWAY_AMOUNT_FORMAT: ${normalized}`);
}

export class PaymentService {
  /**
   * Confirms a payment and activates the linked order.
   * Called by webhook handlers (YooKassa, CryptoBot).
   * 
   * Flow: Payment PENDING → SUCCEEDED → Order AWAITING_PAYMENT → PENDING
   */
  async confirmPayment(
    gatewayId: string, 
    amount: number | bigint, 
    userId: string, 
    _isDevSandbox = false,
    gatewayType: 'yookassa' | 'cryptobot' | 'robokassa' = 'yookassa',
    internalPaymentId?: string,
    metadataType?: string,
    receiptId?: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean> {
    const activatedOrders: { id: string; isDripFeed: boolean; userId: string; amount: number; userEmail?: string | null; serviceName?: string | null; numericId?: number; tenantId?: string }[] = [];
    let paidAmountBigInt = BigInt(amount);
    let isOrderFlow = false;
    // Beneficiary resolved from the DB payment record (NOT the caller-supplied userId).
    // Stays null on idempotent replays / no-op transitions -> post-commit side-effects are skipped.
    let creditedUserId: string | null = null;
    // Payment id resolved inside the transaction; used by post-commit AUTO_ORDER_TOPUP (was an out-of-scope reference).
    let creditedPaymentId: string | null = null;
    const pendingSecurityAlerts: Array<() => Promise<unknown>> = [];

    try {
      // 1. Double-check against real gateway API in production (INV-GW-02, SPEC-REDTEAM-GATEWAYS-2026).
      // The caller-supplied sandbox flag and the id prefix alone are NEVER trusted: verification is skipped
      // only for a server-issued mock id on a test-mode tenant whose DB gatewayId equals the webhook id.
      const isMockPayment = gatewayId.startsWith('test_') || gatewayId.startsWith('mock_') || gatewayId.startsWith('yoo_test_mock_');
      if (process.env.NODE_ENV === 'production' && gatewayType === 'yookassa') {
        const preCheck = await runWithTenantBypass('Webhook pre-check payment tenant resolution', async () => {
          if (internalPaymentId) {
            return db.payment.findUnique({ where: { id: internalPaymentId }, select: { tenantId: true, gatewayId: true } });
          }
          if (gatewayId) {
            return db.payment.findUnique({ where: { gatewayId }, select: { tenantId: true, gatewayId: true } });
          }
          return null;
        });
        const paymentTenantId = preCheck?.tenantId || 'smmplan';
        const dbGatewayId: string | null = preCheck?.gatewayId ?? null;

        const { SettingsManager } = await import('@/lib/settings');
        const isTestMode = await SettingsManager.isTestMode(paymentTenantId);
        const isServerIssuedMock = isTestMode && isMockPayment && dbGatewayId === gatewayId;
        if (!isServerIssuedMock) {
          const secrets = await SettingsManager.getPaymentSecrets(paymentTenantId);
          
          // We attempt to verify with YooKassa if secrets are configured
          if (secrets.yookassaShopId && secrets.yookassaSecretKey) {
            const authHeader = 'Basic ' + Buffer.from(`${secrets.yookassaShopId}:${secrets.yookassaSecretKey}`).toString('base64');
            try {
                const response = await fetch(`https://api.yookassa.ru/v3/payments/${gatewayId}`, {
                    headers: { 'Authorization': authHeader },
                    signal: AbortSignal.timeout(15000)
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.status !== 'succeeded') {
                        throw new Error(`PAYMENT_NOT_SUCCEEDED: Real gateway status is ${data.status}`);
                    }
                    // INV-GW-03: the remote payment must be exactly the one this webhook claims to settle
                    if (data.id !== gatewayId) {
                        throw new Error(`PAYMENT_ID_MISMATCH: Remote id ${String(data.id)} != webhook id ${gatewayId}`);
                    }
                    const remotePaymentId = data.metadata?.paymentId;
                    if (internalPaymentId && remotePaymentId && remotePaymentId !== internalPaymentId) {
                        throw new Error(`PAYMENT_METADATA_MISMATCH: Remote paymentId ${String(remotePaymentId)} != ${internalPaymentId}`);
                    }
                    const realAmountKopecks = parseYooKassaAmountToKopecks(data.amount?.value);
                    if (realAmountKopecks < BigInt(amount)) {
                        throw new Error(`PAYMENT_AMOUNT_MISMATCH: Webhook amount ${amount} exceeds Real amount ${realAmountKopecks.toString()}`);
                    }
                    console.info(`[Payment] Safely verified YooKassa payment ${gatewayId}`);
                } else {
                    throw new Error(`GATEWAY_ERROR: Failed to contact YooKassa API or Payment Not Found (${response.status})`);
                }
            } catch (e: unknown) {
                console.error(`[Payment] Verification Exploit Blocked: ${(e instanceof Error ? e.message : String(e))}`);
                return false; // Reject payment
            }
          } else {
             console.error(`[Payment] YooKassa verification failed for ${gatewayId} due to missing secrets in admin panel! Rejecting for safety.`);
             return false;
          }
        }
      }

      // 2. Atomic transaction: confirm payment + activate order
      await runSerializableTransaction(async (tx) => {
        type PaymentRecord = { id: string; amount: bigint; currency: string | null; status: string; gatewayId: string | null; tenantId: string; userId: string; orderId: string | null };
        const payment: PaymentRecord | null = await runWithTenantBypass('Webhook confirmPayment lookup', async () => {
          if (internalPaymentId) {
            const found = await tx.payment.findUnique({ where: { id: internalPaymentId } });
            if (found) return found as unknown as PaymentRecord;
          }
          const found = await tx.payment.findUnique({ where: { gatewayId } });
          return (found as unknown as PaymentRecord) || null;
        });

        const receivedAmountBigInt = BigInt(amount);

        // 1. Process or Create Payment atomically via Upsert to prevent orphaned double-creation
        const currentPayment = payment;

        if (currentPayment && currentPayment.status === 'SUCCEEDED') {
          console.info(`[Payment] ${gatewayId} already processed (atomic idempotency hit)`);
          return;
        }

        // [SECURITY CR-4 FIX] Gateway ID Consistency Guard
        if (currentPayment && currentPayment.gatewayId && currentPayment.gatewayId !== gatewayId) {
          console.error(`[Payment] Gateway ID mismatch for payment ${currentPayment.id}: expected ${currentPayment.gatewayId}, got ${gatewayId}`);
          throw new Error('PAYMENT_GATEWAY_ID_MISMATCH: Gateway ID mismatch detected.');
        }

        // [SECURITY CR-4 FIX] Currency Consistency Guard
        if (currentPayment && currentPayment.currency && currentPayment.currency !== 'RUB') {
          console.error(`[Payment] Currency mismatch for payment ${currentPayment.id}: expected RUB, got ${currentPayment.currency}`);
          throw new Error('PAYMENT_CURRENCY_MISMATCH: Unsupported payment currency.');
        }

        // [SECURITY CR-4 FIX] Exact Amount Verification: Reject both underpayment and overpayment exploits
        if (currentPayment && currentPayment.amount !== receivedAmountBigInt) {
          console.error(`[Payment] Amount mismatch exploit attempt for ${gatewayId}: expected ${currentPayment.amount}, got ${receivedAmountBigInt}`);
          pendingSecurityAlerts.push(() => SecurityAlertService.record({
            event: 'PAYMENT_AMOUNT_MISMATCH_EXPLOIT',
            severity: 'CRITICAL',
            details: {
              paymentId: currentPayment.id,
              expectedAmount: currentPayment.amount.toString(),
              receivedAmount: receivedAmountBigInt.toString(),
              gatewayId,
              gatewayType
            }
          }));
          throw new Error('PAYMENT_AMOUNT_MISMATCH: Amount received from gateway does not match expected payment amount.');
        }

        let processedPaymentId: string;
        let isOrderPayment: boolean;
        let linkedOrderId: string;
        let targetUserId: string;

        if (currentPayment) {
          // [SECURITY CR-4 FIX] Do NOT overwrite currentPayment.amount with webhook amount. Use expected payment.userId
          targetUserId = currentPayment.userId;
          if (userId && currentPayment.userId !== userId) {
            console.warn(`[Payment] User mismatch: caller passed ${userId}, payment bound to ${currentPayment.userId}. Using payment.userId.`);
          }

          const updated = await tx.payment.updateMany({
            where: { id: currentPayment.id, tenantId: currentPayment.tenantId, status: 'PENDING' },
            data: { status: 'SUCCEEDED', gatewayId, receiptId: receiptId || undefined }
          });
          if (updated.count === 0) {
            const fresh = await tx.payment.findUnique({
              where: { id: currentPayment.id },
              select: { status: true }
            });
            console.warn(
              `[Payment] No transition for ${currentPayment.id}. Current status: ${fresh?.status}`
            );
            return true;
          }
          processedPaymentId = currentPayment.id;
          isOrderPayment = !!currentPayment.orderId;
          linkedOrderId = currentPayment.orderId || '';
        } else {
          // [SECURITY] Orphan webhook rejected
          console.error(`[SECURITY] Orphan webhook rejected for gatewayId: ${gatewayId}. No PENDING payment found.`);
          throw new Error('ORPHAN_WEBHOOK: Stray webhooks are no longer allowed to credit accounts. All payments must be initiated by the system.');
        }

        const creditAmount = currentPayment ? currentPayment.amount : receivedAmountBigInt;

        // [FIN-009] Removed awardCommission from payment.service.ts. 
        // Referral commissions are now awarded in order.service.ts based on order margin.

        // Assign funds locally
        // NOTE (CHK-06 audit clarification): this single-order branch is REACHABLE via
        // retryCheckoutAction (it creates Payment with orderId set). It is mutually
        // exclusive with the basket branch below: this branch flips the order to PENDING,
        // so the basket findMany (AWAITING_PAYMENT only) never sees it again. Do NOT
        // remove. Idempotency keys: credit matches the basket branch
        // (gateway-credit-${paymentId}); charge is per-order (gateway-charge-${orderId}).
        if (isOrderPayment && linkedOrderId) {
          // Activate linked order
          const order = await tx.order.findUnique({ 
            where: { id: linkedOrderId },
            include: { user: { select: { email: true } }, service: { select: { name: true } } }
          });
          if (order && order.status === 'AWAITING_PAYMENT') {
            // [FIN-P0 Guard] Ensure credited amount is strictly >= order.charge to prevent underpaid activation
            if (creditAmount < order.charge) {
              console.error(`[SECURITY] Underpaid order activation blocked: order #${order.numericId} requires ${order.charge} kopecks, but payment credited only ${creditAmount} kopecks.`);
              pendingSecurityAlerts.push(() => SecurityAlertService.record({
                event: 'UNDERPAID_ORDER_EXPLOIT_ATTEMPT',
                severity: 'CRITICAL',
                details: {
                  orderId: linkedOrderId,
                  orderNumericId: order.numericId,
                  requiredCharge: order.charge.toString(),
                  creditedAmount: creditAmount.toString(),
                  paymentId: processedPaymentId
                }
              }));
              throw new Error(`UNDERPAID_ORDER: Credited amount (${creditAmount}) is less than required order charge (${order.charge})`);
            }

            await tx.order.update({
              where: { id: linkedOrderId },
              data: { status: 'PENDING' }
            });
            await logPromoCodeUsageIfNeeded(tx, linkedOrderId, targetUserId);
            activatedOrders.push({ 
              id: order.id, 
              isDripFeed: order.isDripFeed, 
              userId: targetUserId, 
              amount: Number(creditAmount),
              userEmail: order.user?.email ?? null,
              serviceName: order.service?.name ?? null,
              numericId: order.numericId,
              tenantId: order.tenantId
            });
            await WalletOps.credit(tx, targetUserId, creditAmount,
              `Оплата заказа #${order.numericId} через шлюз`,
              { idempotencyKey: `gateway-credit-${processedPaymentId}`, tenantId: currentPayment?.tenantId }
            );
            await WalletOps.charge(tx, targetUserId, order.charge,
              `Списание за заказ #${order.numericId}`,
              { idempotencyKey: `gateway-charge-${order.id}`, tenantId: currentPayment?.tenantId }
            );
          }
        }

        // --- NEW BASKET LOGIC (Deposit-Driven 1:N Orders) ---
        const basketTenantId = currentPayment?.tenantId;
        const basketOrders = await tx.order.findMany({ 
          where: { 
            paymentId: processedPaymentId, 
            status: 'AWAITING_PAYMENT',
            ...(basketTenantId ? { tenantId: basketTenantId } : {})
          },
          include: { user: { select: { email: true } }, service: { select: { name: true } } }
        });
        if (basketOrders.length > 0) {
           await tx.order.updateMany({
              where: { 
                paymentId: processedPaymentId, 
                status: 'AWAITING_PAYMENT',
                ...(basketTenantId ? { tenantId: basketTenantId } : {})
              },
              data: { status: 'PENDING' }
           });
           
           for (const order of basketOrders) {
              activatedOrders.push({ 
                id: order.id, 
                isDripFeed: order.isDripFeed, 
                userId: targetUserId, 
                amount: Number(order.charge),
                userEmail: order.user?.email ?? null,
                serviceName: order.service?.name ?? null,
                numericId: order.numericId,
                tenantId: order.tenantId
              });
              await logPromoCodeUsageIfNeeded(tx, order.id, targetUserId);
           }

            // Credit full expected paid amount first to currentPayment.userId
            await WalletOps.credit(tx, targetUserId, creditAmount,
              `Оплата корзины заказов через шлюз`,
              { idempotencyKey: `gateway-credit-${processedPaymentId}`, tenantId: currentPayment?.tenantId }
            );

            // Batch deduct total charge and log ledger entries
            const totalChargeCents = basketOrders.reduce((sum, order) => sum + order.charge, BigInt(0));
            
            // [FIN-P0 Guard] Ensure credited amount is strictly >= totalChargeCents to prevent underpaid basket activation
            if (creditAmount < totalChargeCents) {
              console.error(`[SECURITY] Underpaid basket activation blocked: basket requires ${totalChargeCents} kopecks, but payment credited only ${creditAmount} kopecks.`);
              throw new Error(`UNDERPAID_BASKET: Credited amount (${creditAmount}) is less than required basket charge (${totalChargeCents})`);
            }

            await WalletOps.charge(
              tx,
              targetUserId,
              totalChargeCents,
              `Списание за оплату корзины заказов (${basketOrders.length} шт.)`,
              { idempotencyKey: `gateway-basket-charge-${processedPaymentId}`, tenantId: currentPayment?.tenantId }
            );

        }

        if (!isOrderPayment && basketOrders.length === 0) {
          // Direct top-up (Deposit) - Increment User Balance securely via targetUserId and expected creditAmount!
          await WalletOps.credit(tx, targetUserId, creditAmount,
            `Пополнение баланса через ${gatewayType}`,
            { idempotencyKey: `deposit-${processedPaymentId}`, tenantId: currentPayment?.tenantId }
          );
        }

        paidAmountBigInt = creditAmount;
        isOrderFlow = isOrderPayment || basketOrders.length > 0;
        creditedUserId = targetUserId;
        creditedPaymentId = processedPaymentId;
      });

      // Invalidate user dashboard cache so they see the new order & spending immediately
      safeRevalidatePath('/dashboard', 'layout');
      
      // Dispatch paid orders to processing queue
      if (activatedOrders.length > 0) {
        const { ordersQueue } = await import('@/lib/queue-manager');
        for (const activated of activatedOrders) {
          await ordersQueue.add('order-dispatch', { orderId: activated.id, tenantId: activated.tenantId }, { jobId: `dispatch-${activated.id}-${Date.now()}`, delay: 3 * 60 * 1000 }); // 3 min cooling-off
          
          if (activated.userEmail && activated.serviceName) {
            void sendOrderPaidMail(
              activated.userEmail,
              activated.numericId?.toString() ?? activated.id,
              activated.serviceName,
              activated.tenantId
            ).catch(err => console.error('[H1] sendOrderPaidMail failed', err));
          }
        }
      }

      // Idempotent replay (already SUCCEEDED / concurrent transition): no credit happened,
      // so do not re-send notifications or re-run loyalty checks.
      if (!creditedUserId) {
        return true;
      }
      const beneficiaryUserId: string = creditedUserId;
      const processedPaymentId: string | null = creditedPaymentId;

      // [BUG-TG-04 Remediation] Handle AUTO_ORDER_TOPUP post-payment auto execution
      let resolvedMetadata = metadata;
      if (!resolvedMetadata) {
        try {
          const { redis } = await import('@/lib/redis');
          const cached = await redis.get(`payment:metadata:${processedPaymentId}`);
          if (cached) {
            resolvedMetadata = JSON.parse(cached);
          }
        } catch {
          // ignore redis read error
        }
      }

      let isAutoOrderCreated = false;
      if (resolvedMetadata && (resolvedMetadata.type === 'AUTO_ORDER_TOPUP' || metadataType === 'AUTO_ORDER_TOPUP')) {
        const serviceId = resolvedMetadata.serviceId as string;
        const link = resolvedMetadata.link as string;
        const quantity = Number(resolvedMetadata.quantity);
        const charge = Number(resolvedMetadata.totalCents);
        const providerCost = Number(resolvedMetadata.providerCostCents || 0);
        const runs = resolvedMetadata.runs ? Number(resolvedMetadata.runs) : undefined;
        const interval = resolvedMetadata.interval ? Number(resolvedMetadata.interval) : undefined;
        const isLinkOverridden = Boolean(resolvedMetadata.isLinkOverridden);

        if (serviceId && link && quantity && charge) {
          try {
            const { orderService } = await import('@/services/core/order.service');
            const autoOrderRes = await orderService.createOrder(
              beneficiaryUserId,
              {
                serviceId,
                link,
                quantity,
                charge,
                providerCost,
                runs,
                interval,
                isLinkOverridden
              },
              `auto-topup-order-${processedPaymentId}`
            );
            if (autoOrderRes.success && autoOrderRes.orderId) {
              isAutoOrderCreated = true;
              console.info(`[PaymentService] AUTO_ORDER_TOPUP successfully executed for payment ${processedPaymentId}: order #${autoOrderRes.orderId}`);
            } else {
              console.error(`[PaymentService] AUTO_ORDER_TOPUP order creation failed for payment ${processedPaymentId}:`, autoOrderRes.error);
            }
          } catch (autoErr) {
            console.error(`[PaymentService] AUTO_ORDER_TOPUP exception for payment ${processedPaymentId}:`, autoErr);
          }
        }
      }

      // Notify user directly in Telegram if user has linked Telegram ID
      try {
        const userWithTg = await db.user.findUnique({
          where: { id: beneficiaryUserId },
          select: { telegramId: true, balance: true, tenantId: true }
        });
        if (userWithTg?.telegramId) {
          const tenantId = userWithTg.tenantId || 'smmplan';
          const { multiBotManager } = await import('@/bot/manager/multi-bot-manager');
          const amountRub = (Number(paidAmountBigInt) / 100).toLocaleString('ru-RU');
          const newBal = (Number(userWithTg.balance) / 100).toFixed(2);
          if (isOrderFlow || activatedOrders.length > 0 || isAutoOrderCreated) {
            await multiBotManager.sendTenantMessage(
              tenantId,
              userWithTg.telegramId,
              `🎉 <b>ОПЛАТА ЗАКАЗА ПОДТВЕРЖДЕНА!</b>\n────────────────────\n` +
              `Сумма: <b>${amountRub} ₽</b>\n` +
              `Заказ передан в обработку и скоро будет запущен!\n\n` +
              `<i>Отслеживать статус можно в разделе «📦 Мои заказы».</i>`
            );
          } else {
            await multiBotManager.sendTenantMessage(
              tenantId,
              userWithTg.telegramId,
              `🎉 <b>БАЛАНС УСПЕШНО ПОПОЛНЕН!</b>\n────────────────────\n` +
              `Сумма: <b>+${amountRub} ₽</b>\n` +
              `Текущий баланс: <b>${newBal} ₽</b> ✅\n\n` +
              `<i>Вы можете приступить к оформлению заказов прямо сейчас.</i>`
            );
          }
        }
      } catch (tgNotifyErr) {
        console.warn('[PaymentService] Telegram user notification skipped:', tgNotifyErr);
      }

      // Check and issue promotional loyalty rewards based on new total spent
      PromoAutomationService.checkAndIssueLoyalty(beneficiaryUserId).catch(console.error);

      return true;
    } catch (e: unknown) {
      console.error('[PaymentService] Error confirming payment:', (e instanceof Error ? e.message : String(e)));
      for (const alertFn of pendingSecurityAlerts) {
        try {
          await alertFn();
        } catch (alertErr) {
          console.error('[PaymentService] Deferred security alert failed:', alertErr);
        }
      }
      return false;
    }
  }

  /**
   * Explicitly cancels a payment and rolls back reserved resources (e.g. promo codes).
   */
  async cancelPayment(gatewayId: string): Promise<boolean> {
    try {
      return await runSerializableTransaction(async (tx) => {
        const payment = await tx.payment.findUnique({ where: { gatewayId } });
        if (!payment || payment.status !== 'PENDING') return false;

        const updated = await tx.payment.updateMany({
          where: { 
            id: payment.id, 
            status: 'PENDING',
            ...(payment.tenantId ? { tenantId: payment.tenantId } : {})
          },
          data: { status: 'CANCELED' }
        });

        if (updated.count === 0) return false;

        const orders = await tx.order.findMany({
          where: { 
            paymentId: payment.id, 
            status: 'AWAITING_PAYMENT',
            ...(payment.tenantId ? { tenantId: payment.tenantId } : {})
          }
        });

        if (orders.length > 0) {
          await tx.order.updateMany({
            where: { 
              paymentId: payment.id, 
              status: 'AWAITING_PAYMENT',
              ...(payment.tenantId ? { tenantId: payment.tenantId } : {})
            },
            data: { status: 'CANCELED' }
          });

          const uniquePromoCodes = new Set(orders.map(o => o.promoCodeId).filter(Boolean) as string[]);
          for (const promoId of uniquePromoCodes) {
            await tx.promoCode.updateMany({
              where: { id: promoId, uses: { gt: 0 } },
              data: { uses: { decrement: 1 } }
            });
          }
        }
        return true;
      });
    } catch (e: unknown) {
      console.error('[PaymentService] Error canceling payment:', (e instanceof Error ? e.message : String(e)));
      return false;
    }
  }

  /**
   * Confirms a payment directly by paymentId (for mock/test flows).
   */
  async confirmPaymentById(paymentId: string): Promise<boolean> {
    try {
      let capturedUserId: string | null = null;
      const activatedOrders: { id: string; isDripFeed: boolean; userEmail?: string | null; serviceName?: string | null; numericId?: number; tenantId?: string }[] = [];

      await db.$transaction(async (tx) => {
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: paymentId }
        });

        const updatedPayment = await tx.payment.updateMany({
          where: { 
            id: paymentId,
            tenantId: payment.tenantId,
            status: 'PENDING'
          },
          data: { 
            status: 'SUCCEEDED',
            gatewayId: `test_${Date.now()}`
          }
        });

        // If count is 0, another concurrent call already activated it
        if (updatedPayment.count === 0) return;

        capturedUserId = payment.userId;

        // [FIN-009] Removed awardCommission from payment.service.ts.
        // Referral commissions are now awarded in order.service.ts based on order margin.

        // Activate linked order
        if (payment.orderId) {
          const order = await tx.order.findUnique({
            where: { id: payment.orderId },
            include: { user: { select: { email: true } }, service: { select: { name: true } } }
          });

          if (order && order.status === 'AWAITING_PAYMENT') {
            await tx.order.update({
              where: { id: payment.orderId },
              data: { status: 'PENDING' }
            });
            await logPromoCodeUsageIfNeeded(tx, payment.orderId, payment.userId);
            activatedOrders.push({ 
              id: order.id, 
              isDripFeed: order.isDripFeed,
              userEmail: order.user?.email ?? null,
              serviceName: order.service?.name ?? null,
              numericId: order.numericId,
              tenantId: order.tenantId
            });
            
            await WalletOps.credit(tx, payment.userId, payment.amount,
              `Оплата заказа #${order.numericId} через шлюз`,
              { idempotencyKey: `gateway-credit-${paymentId}`, tenantId: payment.tenantId }
            );
            await WalletOps.charge(tx, payment.userId, order.charge,
              `Списание за заказ #${order.numericId}`,
              { idempotencyKey: `gateway-charge-${order.id}`, tenantId: payment.tenantId }
            );
          }
        }

        // --- NEW BASKET LOGIC (TEST MODE) ---
        const basketOrders = await tx.order.findMany({ 
          where: { paymentId: paymentId, tenantId: payment.tenantId, status: 'AWAITING_PAYMENT' },
          include: { user: { select: { email: true } }, service: { select: { name: true } } }
        });
        if (basketOrders.length > 0) {
           await tx.order.updateMany({
              where: { paymentId: paymentId, tenantId: payment.tenantId, status: 'AWAITING_PAYMENT' },
              data: { status: 'PENDING' }
           });
           
           for (const order of basketOrders) {
              activatedOrders.push({ 
                id: order.id, 
                isDripFeed: order.isDripFeed,
                userEmail: order.user?.email ?? null,
                serviceName: order.service?.name ?? null,
                numericId: order.numericId,
                tenantId: order.tenantId
              });
              await logPromoCodeUsageIfNeeded(tx, order.id, payment.userId);
           }

            // Credit full paid amount first
            await WalletOps.credit(tx, payment.userId, payment.amount,
              `Оплата корзины заказов через шлюз`,
              { idempotencyKey: `gateway-credit-${paymentId}`, tenantId: payment.tenantId }
            );

            // Batch deduct total charge and log ledger entries
            const totalChargeCents = basketOrders.reduce((sum, order) => sum + order.charge, BigInt(0));
            
            await WalletOps.charge(
              tx,
              payment.userId,
              totalChargeCents,
              `Списание за оплату корзины заказов (${basketOrders.length} шт.)`,
              { idempotencyKey: `gateway-basket-charge-${paymentId}`, tenantId: payment.tenantId }
            );

        }

        if (!payment.orderId && basketOrders.length === 0) {
          // Direct top-up (Deposit) - Increment User Balance securely!
          await WalletOps.credit(tx, payment.userId, payment.amount,
            `Пополнение баланса через yookassa`,
            { idempotencyKey: `deposit-${paymentId}`, tenantId: payment.tenantId }
          );
        }
      }, { isolationLevel: 'Serializable', timeout: 15000 });

      safeRevalidatePath('/dashboard', 'layout');

      // Dispatch paid orders to processing queue
      if (activatedOrders.length > 0) {
        const { ordersQueue } = await import('@/lib/queue-manager');
        for (const activated of activatedOrders) {
          await ordersQueue.add('order-dispatch', { orderId: activated.id, tenantId: activated.tenantId }, { jobId: `dispatch-${activated.id}-${Date.now()}`, delay: 3 * 60 * 1000 }); // 3 min cooling-off
          
          if (activated.userEmail && activated.serviceName) {
            void sendOrderPaidMail(
              activated.userEmail,
              activated.numericId?.toString() ?? activated.id,
              activated.serviceName,
              activated.tenantId
            ).catch(err => console.error('[H1] sendOrderPaidMail failed', err));
          }
        }
      }

      if (capturedUserId) {
        PromoAutomationService.checkAndIssueLoyalty(capturedUserId).catch(console.error);
      }

      return true;
    } catch (e: unknown) {
      console.error('[PaymentService] Error:', (e instanceof Error ? e.message : String(e)));
      return false;
    }
  }
}

export const paymentService = new PaymentService();

