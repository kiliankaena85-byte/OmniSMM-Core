'use server';

import { verifySession } from "@/lib/session";
import { runSerializableTransaction } from "@/lib/transactions";
import { WalletOps } from "@/services/financial/wallet-ops";
import crypto from "crypto";

export async function transferReferralBalanceAction(): Promise<{ success: boolean; amount?: number; error?: string }> {
  try {
    const session = await verifySession();
    if (!session) {
      return { success: false, error: "Unauthorized" };
    }

    let transferAmount: bigint = BigInt(0);
    const transferId = crypto.randomUUID();
    
    await runSerializableTransaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: session.userId },
        select: { referralBalance: true, balance: true, isActive: true, isDeleted: true, tenantId: true }
      });

      if (!user) throw new Error("Учетная запись не найдена");
      if (user.isDeleted === true || user.isActive === false) throw new Error("Ваш аккаунт заблокирован или удален");
      if (!user.referralBalance || user.referralBalance <= 0) {
        throw new Error("Нет средств для перевода");
      }

      transferAmount = user.referralBalance;

      // 1. Safe referral balance debit via WalletOps primitive
      await WalletOps.referralDebit(
        tx,
        session.userId,
        transferAmount,
        `Вывод реферального баланса на основной`,
        { 
          idempotencyKey: `referral-debit-${session.userId}-${transferId}`,
          tenantId: user.tenantId || 'smmplan',
          transactionType: 'REFERRAL_REVERSAL'
        }
      );

      // 2. Safe main balance credit via WalletOps primitive with unique transfer ID
      await WalletOps.credit(
        tx,
        session.userId,
        transferAmount,
        `Перевод реферального баланса на основной`,
        { 
          idempotencyKey: `referral-transfer-${session.userId}-${transferId}`,
          tenantId: user.tenantId || 'smmplan'
        }
      );

      await tx.payment.create({
        data: {
          userId: session.userId,
          amount: BigInt(transferAmount),
          currency: "RUB",
          status: "SUCCEEDED",
          gateway: "referral_transfer",
          gatewayId: transferId,
          tenantId: user.tenantId || 'smmplan'
        }
      });
    });

    return { success: true, amount: Number(transferAmount) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Ошибка перевода средств",
    };
  }
}
