import { db } from '@/lib/db';
import { redis } from '@/lib/redis';
import { Prisma, UsnScheme } from '@prisma/client';
import { calculatePartialRefund } from '@/utils/refund';

interface FinancialMetrics {
  revenueGross: number; // Изначально принесенные деньги
  refunds: number; // Отмененные деньги, возвращенные балансами
  cogs: number; // Оплачено провайдерам (COGS)
  gatewayFees: number; // Комиссии шлюзов (ЮKassa, CryptoBot)
  revenueNet: number; // Выручка минус возвраты и комиссии шлюзов
  marginGross: number; // Net Revenue - COGS
  ebitda: number; // EBITDA = Gross Margin - OPEX
  taxes: number;
  opex: number;
  profitNet: number; // Margin - Taxes - OPEX
  marginPercentage: number;
  annualRevenue: number; // Выручка за текущий календарный год
  effectiveTaxRate: number; // Итоговая расчетная ставка налога (%)
  isVatThresholdExceeded: boolean; // Превышен ли порог НДС 20 млн рублей
  usnScheme: UsnScheme;
}

class AccountingService {
  async getMetrics(startDate?: Date, endDate?: Date, tenantId?: string): Promise<FinancialMetrics> {
    const isSingleTenant = tenantId && tenantId !== 'all';
    // Quantize timestamps to 30-second buckets to ensure high cache hit rate across frequent dashboard renders
    const quantizeTimestamp = (d?: Date) => (d ? Math.floor(d.getTime() / 30_000) * 30_000 : 'all');
    const cacheKey = `accounting:metrics:${tenantId || 'all'}:${quantizeTimestamp(startDate)}:${quantizeTimestamp(endDate)}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as FinancialMetrics;
      }
    } catch {
      // Redis error fallback
    }
    
    // Quantize timestamps to 30 seconds for cache determinism
    const qStartDate = startDate ? new Date(Math.floor(startDate.getTime() / 30000) * 30000) : undefined;
    const qEndDate = endDate ? new Date(Math.floor(endDate.getTime() / 30000) * 30000) : undefined;

    const dateFilter = qStartDate && qEndDate ? { createdAt: { gte: qStartDate, lte: qEndDate } } : {};

    // 1. Calculate Revenue and Gateway Fees (All payments SUCCEEDED)
    const paymentGroups = await db.payment.groupBy({
      by: ['gateway'],
      _sum: { amount: true },
      where: {
        ...dateFilter,
        status: 'SUCCEEDED',
        gateway: { notIn: ['referral_transfer', 'test'] },
        ...(isSingleTenant ? { tenantId } : {})
      }
    });
    
    let revenueGross = 0;
    let gatewayFees = 0;

    for (const group of paymentGroups) {
      const amount = Number(group._sum.amount || 0);
      revenueGross += amount;
      
      const g = (group.gateway || '').toLowerCase();
      let feeRate = 0.035;
      if (g.includes('sbp') || g.includes('qr')) {
        feeRate = 0.007; // СБП 0.7%
      } else if (g.includes('crypto')) {
        feeRate = 0.01; // CryptoBot 1.0%
      } else if (g.includes('robo')) {
        feeRate = 0.039; // Robokassa 3.9%
      } else if (g.includes('yoo')) {
        feeRate = 0.035; // ЮKassa 3.5%
      } else {
        feeRate = 0.035; // Default 3.5%
      }

      gatewayFees += amount * feeRate;
    }
    
    gatewayFees = Math.round(gatewayFees);

    // 2. Calculate Refunds (For canceled/partial orders that were actually paid)
    const refundedOrders = await db.order.findMany({
      where: {
        ...dateFilter,
        status: { in: ['PARTIAL', 'CANCELED'] },
        ...(isSingleTenant ? { tenantId } : {}),
        NOT: {
          status: 'CANCELED',
          payment: {
            status: { not: 'SUCCEEDED' }
          }
        }
      },
      select: {
        status: true,
        quantity: true,
        remains: true,
        charge: true,
        error: true,
        payment: {
          select: {
            status: true
          }
        }
      }
    });

    let refunds = 0;
    for (const order of refundedOrders) {
      // Guard against unpaid canceled orders (e.g. cart checkout where payment was abandoned/expired)
      if (order.status === 'CANCELED') {
        const pStatus = (order as { payment?: { status?: string } | null }).payment?.status;
        if (pStatus && pStatus !== 'SUCCEEDED') {
          continue;
        }
        const err = (order as { error?: string | null }).error || '';
        if (
          err.includes('auto-expire') ||
          err.includes('Оплата не поступила') ||
          err.includes('Ожидание оплаты истекло')
        ) {
          continue;
        }
      }

      if (order.quantity > 0 && order.remains > 0) {
        refunds += calculatePartialRefund(order);
      } else if (order.status === 'CANCELED') {
        refunds += Number(order.charge);
      }
    }

    // 3. Calculate COGS (Provider Costs for confirmed part)
    let cogs: number;
    if (startDate && endDate) {
      const cogsResult = isSingleTenant
        ? await db.$queryRaw<[{ total: bigint | null }]>`
            SELECT SUM(
              CASE
                WHEN "quantity" > 0
                THEN ROUND(CAST("quantity" - "remains" AS NUMERIC) / "quantity" * "providerCost")
                ELSE 0
              END
            ) as total
            FROM "Order"
            WHERE status NOT IN ('AWAITING_PAYMENT', 'PENDING', 'ERROR')
              AND "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
              AND "tenantId" = ${tenantId}
          `
        : await db.$queryRaw<[{ total: bigint | null }]>`
            SELECT SUM(
              CASE
                WHEN "quantity" > 0
                THEN ROUND(CAST("quantity" - "remains" AS NUMERIC) / "quantity" * "providerCost")
                ELSE 0
              END
            ) as total
            FROM "Order"
            WHERE status NOT IN ('AWAITING_PAYMENT', 'PENDING', 'ERROR')
              AND "createdAt" >= ${startDate} AND "createdAt" <= ${endDate}
          `;
      cogs = Number(cogsResult[0]?.total ?? 0);
    } else {
      const cogsResult = isSingleTenant
        ? await db.$queryRaw<[{ total: bigint | null }]>`
            SELECT SUM(
              CASE
                WHEN "quantity" > 0
                THEN ROUND(CAST("quantity" - "remains" AS NUMERIC) / "quantity" * "providerCost")
                ELSE 0
              END
            ) as total
            FROM "Order"
            WHERE status NOT IN ('AWAITING_PAYMENT', 'PENDING', 'ERROR')
              AND "tenantId" = ${tenantId}
          `
        : await db.$queryRaw<[{ total: bigint | null }]>`
            SELECT SUM(
              CASE
                WHEN "quantity" > 0
                THEN ROUND(CAST("quantity" - "remains" AS NUMERIC) / "quantity" * "providerCost")
                ELSE 0
              END
            ) as total
            FROM "Order"
            WHERE status NOT IN ('AWAITING_PAYMENT', 'PENDING', 'ERROR')
          `;
      cogs = Number(cogsResult[0]?.total ?? 0);
    }

    const revenueNet = revenueGross - refunds - gatewayFees;
    const marginGross = revenueNet - cogs;

    // 4. Calculate Taxes and OPEX
    const activeSettingsId = isSingleTenant ? tenantId : 'smmplan';
    const settings = await db.systemSettings.findUnique({ where: { id: activeSettingsId } });
    const baseTaxRate = settings?.taxRate ?? 6.0;
    const opex = settings?.opexMonthly || 0.0;
    const usnScheme = settings?.usnScheme ?? 'INCOME_EXPENSES';

    // Calculate dynamic tax rate based on annual revenue of current calendar year (deducting REFUNDs)
    const currentYear = new Date().getFullYear();
    const startOfYear = new Date(currentYear, 0, 1);
    const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59, 999);

    const [annualPayments, annualRefunds] = await Promise.all([
      db.payment.aggregate({
        _sum: { amount: true },
        where: {
          status: 'SUCCEEDED',
          gateway: { notIn: ['referral_transfer', 'test'] },
          ...(isSingleTenant ? { tenantId } : {}),
          createdAt: {
            gte: startOfYear,
            lte: endOfYear
          }
        }
      }),
      db.ledgerEntry ? db.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: {
          transactionType: { in: ['REFUND', 'ORDER_CANCEL'] },
          ...(isSingleTenant ? { tenantId } : {}),
          createdAt: {
            gte: startOfYear,
            lte: endOfYear
          }
        }
      }).catch(() => ({ _sum: { amount: BigInt(0) } })) : Promise.resolve({ _sum: { amount: BigInt(0) } })
    ]);

    const grossAnnual = Number(annualPayments._sum.amount || 0);
    const refundAnnual = Number(annualRefunds?._sum?.amount || 0);
    const annualRevenue = Math.max(0, grossAnnual - refundAnnual);

    // Threshold is 20 million rubles (2,000,000,000 cents) (п. 1 ст. 145 НК РФ, 176-ФЗ / 425-ФЗ: расчет строго по валовому приходу)
    const isVatThresholdExceeded = grossAnnual >= 2000000000;
    
    // Under 2026 tax reform (ФЗ № 425-ФЗ), VAT rate upon exceeding 20M limit is 22% (п. 3 ст. 164 НК РФ)
    const effectiveTaxRate = isVatThresholdExceeded ? baseTaxRate + 22.0 : baseTaxRate;

    const ebitda = Math.round(marginGross - opex);
    const taxes = usnScheme === 'INCOME'
      ? Math.round((revenueGross > 0 ? revenueGross : 0) * (effectiveTaxRate / 100))
      : Math.round((marginGross > 0 ? marginGross : 0) * (effectiveTaxRate / 100));
    const profitNet = marginGross - taxes - opex;
    const marginPercentage = revenueNet > 0 ? (marginGross / revenueNet) * 100 : 0;

    const result: FinancialMetrics = {
      revenueGross,
      refunds,
      gatewayFees,
      revenueNet,
      cogs,
      marginGross,
      ebitda,
      taxes,
      opex,
      profitNet,
      marginPercentage,
      annualRevenue,
      effectiveTaxRate,
      isVatThresholdExceeded,
      usnScheme
    };

    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 45);
    } catch {
      // Redis write failure is non-fatal
    }

    return result;
  }

  async getSettings(tenantId?: string) {
    const activeSettingsId = tenantId && tenantId !== 'all' ? tenantId : 'smmplan';
    let settings = await db.systemSettings.findUnique({ where: { id: activeSettingsId } });
    if (!settings) {
      settings = await db.systemSettings.create({
        data: { id: activeSettingsId, taxRate: 6.0, opexMonthly: 0.0, usnScheme: 'INCOME_EXPENSES' }
      });
    }
    return settings;
  }

  async updateSettings(taxRate: number, opexMonthly: number, usnScheme?: UsnScheme, tenantId?: string) {
    const activeSettingsId = tenantId && tenantId !== 'all' ? tenantId : 'smmplan';
    return db.systemSettings.upsert({
      where: { id: activeSettingsId },
      update: { taxRate, opexMonthly, ...(usnScheme ? { usnScheme } : {}) },
      create: { id: activeSettingsId, taxRate, opexMonthly, usnScheme: usnScheme || 'INCOME_EXPENSES' }
    });
  }

  async getGatewayBreakdown(startDate?: Date, endDate?: Date, tenantId?: string) {
    const isSingleTenant = tenantId && tenantId !== 'all';
    const where: Prisma.PaymentWhereInput = {};
    if (startDate && endDate) {
      where.createdAt = { gte: startDate, lte: endDate };
    }
    if (isSingleTenant) {
      where.tenantId = tenantId;
    }

    const [allPayments, succeededPayments] = await Promise.all([
      db.payment.groupBy({
        by: ['gateway'],
        _count: true,
        where,
      }),
      db.payment.groupBy({
        by: ['gateway'],
        _sum: { amount: true },
        _count: true,
        where: {
          ...where,
          status: 'SUCCEEDED',
        },
      }),
    ]);

    const totalRevenueKopecks = succeededPayments.reduce((acc, p) => acc + BigInt(p._sum.amount || 0), BigInt(0));

    const totalMap = new Map<string, number>();
    for (const ap of allPayments) {
      totalMap.set(ap.gateway, ap._count);
    }

    return succeededPayments.map(sp => {
      const g = sp.gateway;
      const amountKopecks = BigInt(sp._sum.amount || 0);
      const totalCount = totalMap.get(g) || sp._count;
      const successCount = sp._count;
      const successRate = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 100;
      
      let feePct = 3.5;
      let label: string;
      let icon: string;
      if (g.toLowerCase().includes('sbp') || g.toLowerCase().includes('qr')) {
        feePct = 0.7;
        label = 'СБП (QR / Пэй)';
        icon = '⚡';
      } else if (g.toLowerCase().includes('crypto')) {
        feePct = 1.0;
        label = 'CryptoCloud';
        icon = '₿';
      } else if (g.toLowerCase().includes('robo')) {
        feePct = 3.9;
        label = 'Robokassa';
        icon = '🛡️';
      } else if (g.toLowerCase().includes('yoo')) {
        feePct = 3.5;
        label = 'ЮKassa (Карты/Банки)';
        icon = '💳';
      } else {
        label = g.toUpperCase();
        icon = '🌐';
      }

      const feeKopecks = (amountKopecks * BigInt(Math.round(feePct * 10))) / BigInt(1000);
      const sharePct = totalRevenueKopecks > BigInt(0)
        ? Math.round(Number((amountKopecks * BigInt(100)) / totalRevenueKopecks))
        : 0;

      return {
        gateway: g,
        label,
        icon,
        amountKopecks,
        feeKopecks,
        feePct,
        successCount,
        totalCount,
        successRate,
        sharePct,
      };
    }).sort((a, b) => Number(b.amountKopecks - a.amountKopecks));
  }
}

export const accountingService = new AccountingService();
