import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { WalletOps } from '../financial/wallet-ops';

export const adminMarketingService = {
  // ── PromoCodes ──
  async listPromoCodes(_tenantId?: string) {
    const promoCodes = await db.promoCode.findMany({
      include: { usages: true },
      orderBy: { createdAt: 'desc' },
    });
    return promoCodes.map(promo => ({
      ...promo,
      usages: promo.usages.map(usage => ({
        ...usage,
        discountCents: Number(usage.discountCents),
        revenueCents: Number(usage.revenueCents),
        profitCents: Number(usage.profitCents),
      }))
    }));
  },

  async createPromoCode(data: {
    code: string;
    type: 'DISCOUNT' | 'VOUCHER';
    discountPercent?: number;
    amount?: number;
    maxUses: number;
    expiresAt?: Date | null;
    description?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    budgetCents?: number;
    isSuspicious?: boolean;
  }) {
    return db.promoCode.create({
      data: {
        code: data.code.toUpperCase(),
        type: data.type,
        discountPercent: data.discountPercent || 0,
        amount: data.amount || 0,
        maxUses: data.maxUses,
        expiresAt: data.expiresAt,
        isActive: true,
        description: data.description,
        utmSource: data.utmSource,
        utmMedium: data.utmMedium,
        utmCampaign: data.utmCampaign,
        budgetCents: data.budgetCents || 0,
        isSuspicious: data.isSuspicious || false,
      },
    });
  },

  async togglePromoCode(id: string, isActive: boolean) {
    return db.promoCode.update({
      where: { id },
      data: { isActive },
    });
  },

  async deletePromoCode(id: string) {
    return db.promoCode.delete({
      where: { id },
    });
  },

  // ── Referrals & Commissions ──
  async getReferralStats() {
    const totalCommissions = await db.commission.aggregate({
      _sum: { amount: true },
      where: { status: 'PAID' },
    });

    const pendingCommissions = await db.commission.aggregate({
      _sum: { amount: true },
      where: { status: 'PENDING' },
    });

    return {
      totalPaidOut: totalCommissions._sum.amount || 0,
      totalPending: pendingCommissions._sum.amount || 0,
    };
  },

  async getReferralChartData() {
    // Fetch last 6 months of paid commissions
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    sixMonthsAgo.setHours(0, 0, 0, 0);

    const commissions = await db.commission.findMany({
      where: { 
        status: 'PAID',
        updatedAt: { gte: sixMonthsAgo }
      },
      select: { amount: true, updatedAt: true },
    });

    const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    const monthlyData: Record<string, number> = {};
    
    // Initialize last 6 months with 0
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      monthlyData[months[d.getMonth()]] = 0;
    }

    for (const commission of commissions) {
      const month = months[commission.updatedAt.getMonth()];
      if (monthlyData[month] !== undefined) {
        monthlyData[month] += Number(commission.amount);
      }
    }

    return Object.keys(monthlyData).map(month => ({
      name: month,
      total: monthlyData[month] / 100
    }));
  },

  async listTopReferrers(tenantId?: string) {
    // Find users with the highest referral balance or most referrals
    return db.user.findMany({
      where: {
        referralBalance: { gt: 0 },
        ...(tenantId ? { tenantId } : {})
      },
      orderBy: { referralBalance: 'desc' },
      take: 50,
      select: {
        id: true,
        email: true,
        referralCode: true,
        referralBalance: true,
        _count: {
          select: { referrals: true, commissions: true },
        },
      },
    });
  },

  async processPayout(userId: string, adminId: string, amountToPayCents: number) {
    // Transaction to move referral balance to main balance
    return db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('User not found');
      const amountBigInt = BigInt(amountToPayCents);
      if (user.referralBalance < amountBigInt) {
        throw new Error('Insufficient referral balance');
      }
      
      if (user.referralBalance !== amountBigInt) {
        throw new Error('Partial payouts are not supported to maintain financial data integrity. Payout amount must exactly match the full referral balance.');
      }

      // Deduct from referral atomically via WalletOps (strict withdrawal — never creates debt)
      // INV-REF-02: one payoutId binds the debit/credit pair. Amount-based keys collided on a
      // repeat payout of the same sum (credit returned cached → referral debited, main not credited).
      const payoutId = randomUUID();
      await WalletOps.referralDebit(
        tx,
        userId,
        amountToPayCents,
        `Вывод реферального баланса (admin payout)`,
        {
          adminId,
          idempotencyKey: `referral-debit-payout-${payoutId}`,
          transactionType: 'REFERRAL_REVERSAL',
          tenantId: user.tenantId || 'smmplan'
        }
      );

      // Mark all pending commissions for this user as PAID
      await tx.commission.updateMany({
        where: { referrerId: userId, status: 'PENDING' },
        data: { status: 'PAID' },
      });

      // Financial Integrity: Credit main balance via WalletOps primitive
      const creditResult = await WalletOps.credit(
        tx,
        userId,
        amountToPayCents,
        `Выплата реферального баланса (admin payout)`,
        { adminId, idempotencyKey: `referral-payout-${payoutId}` }
      );

      // Audit Log
      await tx.adminAuditLog.create({
        data: {
          adminId: adminId,
          adminEmail: 'System', // Will map to real in action
          action: 'REFERRAL_PAYOUT',
          target: userId,
          targetType: 'USER',
          newValue: JSON.stringify({ amount: amountToPayCents, newBalance: creditResult.balance?.toString() ?? '0' }),
        },
      });

      return { ...user, balance: creditResult.balance };
    });
  },
};
