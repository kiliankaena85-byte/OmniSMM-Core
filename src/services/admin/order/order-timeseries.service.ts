import { db } from '@/lib/db';
import { redis } from '@/lib/redis';

export class OrderTimeseriesService {
  /**
   * Retrieves order counts grouped by hour/day/week/month to build the Orders Dynamics Chart.
   */
  static async getOrdersTimeseries(
    startDate: Date,
    endDate: Date,
    step: 'hour' | 'day' | 'week' | 'month',
    tenantId?: string
  ) {
    // Quantize timestamps to 30-second buckets to ensure high cache hit rate across frequent dashboard renders
    const qStartDate = new Date(Math.floor(startDate.getTime() / 30_000) * 30_000);
    const qEndDate = new Date(Math.floor(endDate.getTime() / 30_000) * 30_000);
    const cacheKey = `orders:timeseries:${tenantId || 'all'}:${step}:${qStartDate.getTime()}:${qEndDate.getTime()}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Redis error fallback
    }
    const rawData = step === 'hour'
      ? await db.$queryRaw<{ date: Date; status: string; count: number }[]>`
        SELECT 
          DATE_TRUNC('hour', "createdAt") as date, 
          status, 
          COUNT(*)::int as count 
        FROM "Order"
        WHERE "createdAt" >= ${qStartDate} AND "createdAt" <= ${qEndDate}
          AND (${tenantId || null}::text IS NULL OR "tenantId" = ${tenantId || ''})
        GROUP BY DATE_TRUNC('hour', "createdAt"), status
        ORDER BY date ASC
      `
      : step === 'week'
      ? await db.$queryRaw<{ date: Date; status: string; count: number }[]>`
        SELECT 
          DATE_TRUNC('week', "createdAt") as date, 
          status, 
          COUNT(*)::int as count 
        FROM "Order"
        WHERE "createdAt" >= ${qStartDate} AND "createdAt" <= ${qEndDate}
          AND (${tenantId || null}::text IS NULL OR "tenantId" = ${tenantId || ''})
        GROUP BY DATE_TRUNC('week', "createdAt"), status
        ORDER BY date ASC
      `
      : step === 'month'
      ? await db.$queryRaw<{ date: Date; status: string; count: number }[]>`
        SELECT 
          DATE_TRUNC('month', "createdAt") as date, 
          status, 
          COUNT(*)::int as count 
        FROM "Order"
        WHERE "createdAt" >= ${qStartDate} AND "createdAt" <= ${qEndDate}
          AND (${tenantId || null}::text IS NULL OR "tenantId" = ${tenantId || ''})
        GROUP BY DATE_TRUNC('month', "createdAt"), status
        ORDER BY date ASC
      `
      : await db.$queryRaw<{ date: Date; status: string; count: number }[]>`
        SELECT 
          DATE_TRUNC('day', "createdAt") as date, 
          status, 
          COUNT(*)::int as count 
        FROM "Order"
        WHERE "createdAt" >= ${qStartDate} AND "createdAt" <= ${qEndDate}
          AND (${tenantId || null}::text IS NULL OR "tenantId" = ${tenantId || ''})
        GROUP BY DATE_TRUNC('day', "createdAt"), status
        ORDER BY date ASC
      `;

    type WaveChartRow = {
      dateStr: string;
      completed: number;
      inProgress: number;
      pending: number;
      unpaid: number;
      canceled: number;
      partial: number;
      total: number;
    };
    const result: WaveChartRow[] = [];

    if (step === 'hour') {
      const current = new Date(startDate);
      current.setMinutes(0, 0, 0);
      while (current <= endDate) {
        const dateStr = current.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        result.push({ dateStr, completed: 0, inProgress: 0, pending: 0, unpaid: 0, canceled: 0, partial: 0, total: 0 });
        current.setHours(current.getHours() + 1);
      }
    } else if (step === 'day') {
      const current = new Date(startDate);
      current.setHours(0, 0, 0, 0);
      while (current <= endDate) {
        const dateStr = current.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
        result.push({ dateStr, completed: 0, inProgress: 0, pending: 0, unpaid: 0, canceled: 0, partial: 0, total: 0 });
        current.setDate(current.getDate() + 1);
      }
    } else if (step === 'week') {
      const current = new Date(startDate);
      const day = current.getDay();
      const diff = current.getDate() - day + (day === 0 ? -6 : 1);
      current.setDate(diff);
      current.setHours(0, 0, 0, 0);
      while (current <= endDate) {
        const dateStr = current.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
        result.push({ dateStr, completed: 0, inProgress: 0, pending: 0, unpaid: 0, canceled: 0, partial: 0, total: 0 });
        current.setDate(current.getDate() + 7);
      }
    } else if (step === 'month') {
      const current = new Date(startDate);
      current.setDate(1);
      current.setHours(0, 0, 0, 0);
      while (current <= endDate) {
        const dateStr = current.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' });
        result.push({ dateStr, completed: 0, inProgress: 0, pending: 0, unpaid: 0, canceled: 0, partial: 0, total: 0 });
        current.setMonth(current.getMonth() + 1);
      }
    }

    for (const row of rawData) {
      let dStr = '';
      const rDate = new Date(row.date);
      if (step === 'hour') dStr = rDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      else if (step === 'day' || step === 'week') dStr = rDate.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
      else if (step === 'month') dStr = rDate.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' });

      const match = result.find((r) => r.dateStr === dStr);
      if (match) {
        const count = Number(row.count);
        match.total += count;
        if (row.status === 'COMPLETED') match.completed += count;
        else if (row.status === 'IN_PROGRESS') match.inProgress += count;
        else if (row.status === 'PENDING') match.pending += count;
        else if (row.status === 'AWAITING_PAYMENT') match.unpaid += count;
        else if (row.status === 'CANCELED' || row.status === 'ERROR') match.canceled += count;
        else if (row.status === 'PARTIAL' || row.status === 'REFUNDING') match.partial += count;
      }
    }

    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 45);
    } catch {
      // Redis write failure is non-fatal
    }

    return result;
  }
}
