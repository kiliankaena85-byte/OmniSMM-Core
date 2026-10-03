import { db } from '@/lib/db';
import { redis } from '@/lib/redis';
import { SettingsProvider } from '@/lib/settings';
import { providerService } from '@/services/providers/provider.service';
import { ProviderDiagnosticService } from './provider-diagnostic.service';

export interface CachedProviderBalance {
  providerId: string;
  providerName: string;
  balance: number;
  rawBalance: string;
  currency: string;
  balanceUsd: number;
  balanceRub: number;
  status: 'healthy' | 'warning' | 'critical' | 'error';
  latencyMs: number;
  cachedAt: number;
  expiresAt: number;
  error?: string;
  suggestedFix?: string;
}

export interface GlobalLiquiditySummary {
  totalRub: number;
  totalUsd: number;
  activeCount: number;
  healthyCount: number;
  warningCount: number;
  criticalCount: number;
  errorCount: number;
  burnRate24hRub: number;
  runwayDays: number | null;
  providers: CachedProviderBalance[];
  cachedAt: number;
}

export class ProviderBalanceService {
  private readonly CACHE_TTL_SECONDS = 120;
  private readonly ERROR_CACHE_TTL_SECONDS = 30;
  private readonly TIMEOUT_MS = 5000;

  /**
   * Retrieves current balance for a specific provider with 60-second Redis caching
   * and 5s timeout protection.
   */
  async getProviderBalance(providerId: string, forceRefresh = false): Promise<CachedProviderBalance> {
    const cacheKey = `provider:${providerId}:balance`;

    if (!forceRefresh) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as CachedProviderBalance;
        }
      } catch (err) {
        console.warn(`[ProviderBalanceService] Redis read error for ${cacheKey}:`, err);
      }
    }

    const provider = await db.provider.findUnique({
      where: { id: providerId },
    });

    if (!provider) {
      const now = Date.now();
      return {
        providerId,
        providerName: 'Unknown',
        balance: 0,
        rawBalance: '0',
        currency: 'USD',
        balanceUsd: 0,
        balanceRub: 0,
        status: 'error',
        latencyMs: 0,
        cachedAt: now,
        expiresAt: now + this.ERROR_CACHE_TTL_SECONDS * 1000,
        error: 'Провайдер не найден в базе данных.',
      };
    }

    const startTime = Date.now();
    let latencyMs = 0;

    try {
      const instance = await providerService.getProviderInstance(provider);

      let timeoutId: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`ETIMEDOUT: Connection timed out after ${this.TIMEOUT_MS}ms`)), this.TIMEOUT_MS);
      });

      let balanceData: { balance: string; currency?: string };
      try {
        balanceData = await Promise.race([
          instance.getBalance(),
          timeoutPromise,
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }

      latencyMs = Date.now() - startTime;

      const rawBalance = balanceData.balance ?? '0';
      let numBalance = 0;
      if (typeof rawBalance === 'number') {
        numBalance = isNaN(rawBalance) ? 0 : rawBalance;
      } else {
        const str = String(rawBalance).trim();
        const parsed = parseFloat(str.replace(/,/g, '.'));
        numBalance = isNaN(parsed) ? 0 : parsed;
      }
      const reportedCurrency = balanceData.currency?.toUpperCase().trim();
      const storedCurrency = provider.balanceCurrency?.toUpperCase().trim();
      let currency: string;
      if (reportedCurrency && reportedCurrency !== 'UNKNOWN' && reportedCurrency.length >= 3) {
        currency = reportedCurrency;
      } else if (storedCurrency && storedCurrency.length >= 3) {
        currency = storedCurrency;
      } else {
        currency = 'USD';
        console.warn(`[ProviderBalance] Provider ${provider.name} returned no currency and none stored in DB; fallback to USD`);
      }

      // Normalize exchange rate
      let usdRate = 95.0;
      try {
        usdRate = await SettingsProvider.getExchangeRateUSD();
        if (!usdRate || usdRate <= 0) usdRate = 95.0;
      } catch {
        usdRate = 95.0;
      }

      let balanceUsd = 0;
      let balanceRub = 0;

      if (currency === 'USD') {
        balanceUsd = numBalance;
        balanceRub = numBalance * usdRate;
      } else if (currency === 'RUB') {
        balanceRub = numBalance;
        balanceUsd = usdRate > 0 ? numBalance / usdRate : 0;
      } else if (currency === 'EUR') {
        balanceUsd = numBalance * 1.08;
        balanceRub = balanceUsd * usdRate;
      } else {
        balanceUsd = numBalance;
        balanceRub = numBalance * usdRate;
      }

      // 3-tier health evaluation based on USD equivalent
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (balanceUsd > 50) {
        status = 'healthy';
      } else if (balanceUsd >= 10) {
        status = 'warning';
      } else {
        status = 'critical';
      }

      const now = Date.now();
      const result: CachedProviderBalance = {
        providerId: provider.id,
        providerName: provider.name,
        balance: numBalance,
        rawBalance,
        currency,
        balanceUsd: Math.round(balanceUsd * 100) / 100,
        balanceRub: Math.round(balanceRub * 100) / 100,
        status,
        latencyMs,
        cachedAt: now,
        expiresAt: now + this.CACHE_TTL_SECONDS * 1000,
      };

      try {
        await redis.set(cacheKey, JSON.stringify(result), 'EX', this.CACHE_TTL_SECONDS);
      } catch (cacheErr) {
        console.warn(`[ProviderBalanceService] Redis write error for ${cacheKey}:`, cacheErr);
      }

      // ── Balance Alert (deduped per 1h via Redis atomic lock) ───────────────
      if (status === 'critical' || status === 'warning') {
        const alertKey = `provider:${provider.id}:balance_alert:${status}`;
          // Atomic lock: 'NX' prevents TOCTOU alert storms during concurrent checks
          const lockAcquired = await redis.set(alertKey, '1', 'EX', 3600, 'NX');
          if (lockAcquired === 'OK') {
            const { sendAdminAlert } = await import('@/lib/notifications');
            const emoji = status === 'critical' ? '🚨' : '⚠️';
            const level = status === 'critical' ? 'CRITICAL' : 'WARNING';
            const thresholdUsd = status === 'critical' ? 10 : 50;
            const thresholdRub = thresholdUsd * usdRate;

            let formattedBalance = '';
            let formattedThreshold = '';

            if (currency === 'RUB') {
              formattedBalance = `${numBalance.toFixed(2)} ₽ (~$${balanceUsd.toFixed(2)})`;
              formattedThreshold = `${thresholdRub.toLocaleString('ru-RU')} ₽ ($${thresholdUsd}.00)`;
            } else if (currency === 'USD') {
              formattedBalance = `$${numBalance.toFixed(2)} (~${balanceRub.toFixed(2)} ₽)`;
              formattedThreshold = `$${thresholdUsd}.00 (~${thresholdRub.toLocaleString('ru-RU')} ₽)`;
            } else if (currency === 'EUR') {
              formattedBalance = `€${numBalance.toFixed(2)} (~$${balanceUsd.toFixed(2)} / ~${balanceRub.toFixed(2)} ₽)`;
              formattedThreshold = `€${(thresholdUsd / 1.08).toFixed(2)} ($${thresholdUsd}.00 / ${thresholdRub.toLocaleString('ru-RU')} ₽)`;
            } else {
              formattedBalance = `${numBalance.toFixed(2)} ${currency} (~$${balanceUsd.toFixed(2)} / ~${balanceRub.toFixed(2)} ₽)`;
              formattedThreshold = `$${thresholdUsd}.00 (~${thresholdRub.toLocaleString('ru-RU')} ₽)`;
            }

            // Asynchronous fire-and-forget alert: SMTP latency never blocks the HTTP response
            void (async () => {
              try {
                await sendAdminAlert(
                  `${emoji} Баланс провайдера "${provider.name}" = ${formattedBalance} — ниже порога ${formattedThreshold}. Пополните депозит!`,
                  level
                );
              } catch (alertErr) {
                // If delivery fails, release lock early so next check can retry alerting
                await redis.del(alertKey).catch(() => {});
                console.warn(`[ProviderBalanceService] Async balance alert failed for ${provider.name}:`, alertErr);
              }
            })();
          }
        } catch (alertErr) {
          console.warn(`[ProviderBalanceService] Balance alert check failed for ${provider.name}:`, alertErr);
        }
      }

      // Update provider SLA metrics in DB
      try {
        const prevAvg = provider.avgResponseMs || 0;
        const newAvg = prevAvg > 0 ? Math.round(prevAvg * 0.7 + latencyMs * 0.3) : latencyMs;
        await db.provider.update({
          where: { id: provider.id },
          data: {
            lastSuccessAt: new Date(),
            avgResponseMs: newAvg,
            errorCount5m: 0,
          },
        });
      } catch (dbErr) {
        console.warn(`[ProviderBalanceService] SLA update failed for provider ${provider.id}:`, dbErr);
      }

      return result;
    } catch (err: unknown) {
      latencyMs = Date.now() - startTime;
      const translated = ProviderDiagnosticService.translateError(err, provider.apiUrl);
      const now = Date.now();

      const errorResult: CachedProviderBalance = {
        providerId: provider.id,
        providerName: provider.name,
        balance: 0,
        rawBalance: '0',
        currency: provider.balanceCurrency || 'USD',
        balanceUsd: 0,
        balanceRub: 0,
        status: 'error',
        latencyMs,
        cachedAt: now,
        expiresAt: now + this.ERROR_CACHE_TTL_SECONDS * 1000,
        error: translated.message,
        suggestedFix: translated.suggestedFix,
      };

      try {
        await redis.set(cacheKey, JSON.stringify(errorResult), 'EX', this.ERROR_CACHE_TTL_SECONDS);
      } catch (cacheErr) {
        console.warn(`[ProviderBalanceService] Redis write error for error record ${cacheKey}:`, cacheErr);
      }

      // Record error in provider SLA metrics + optionally auto-deactivate on repeated failures
      try {
        const updated = await db.provider.update({
          where: { id: provider.id },
          data: {
            lastErrorAt: new Date(),
            errorCount5m: { increment: 1 },
          },
          select: { errorCount5m: true, name: true, isActive: true },
        });

        // ── Optional Auto-Deactivation ──────────────────────────────────────────
        // ⚠️  ОТКЛЮЧЕНО ПО УМОЛЧАНИЮ — требует ручного тестирования перед включением.
        // Что делает: при >= 5 ошибках провайдер ставится isActive=false (NEW ORDERS STOP).
        // Что НЕ делает: не переключает уже размещённые заказы на другого провайдера.
        // Включить: поменяй false → true ниже.
        const ENABLE_AUTO_DEACTIVATION = false;
        const AUTO_DEACTIVATION_THRESHOLD = 5;

        if (
          ENABLE_AUTO_DEACTIVATION &&
          updated.isActive &&
          updated.errorCount5m >= AUTO_DEACTIVATION_THRESHOLD
        ) {
          await db.provider.update({
            where: { id: provider.id },
            data: { isActive: false },
          });
          const { sendAdminAlert } = await import('@/lib/notifications');
          await sendAdminAlert(
            `🔴 Провайдер "${provider.name}" АВТОМАТИЧЕСКИ ОТКЛЮЧЁН: ${updated.errorCount5m} ошибок подряд. Включите вручную в /admin/providers после устранения.`,
            'CRITICAL'
          );
          console.warn(`[ProviderBalanceService] Auto-deactivation triggered for provider ${provider.id} (${provider.name}): ${updated.errorCount5m} errors`);
        } else if (updated.errorCount5m >= AUTO_DEACTIVATION_THRESHOLD) {
          // ── Режим мониторинга (без авто-отключения): только предупреждение ───
          const alertKey = `provider:${provider.id}:error_alert`;
          const alreadyAlerted = await redis.get(alertKey).catch(() => null);
          if (!alreadyAlerted) {
            void (async () => {
              try {
                const { sendAdminAlert } = await import('@/lib/notifications');
                await sendAdminAlert(
                  `⚠️ Провайдер "${provider.name}" накопил ${updated.errorCount5m} ошибок за 5 мин. Требует проверки. Авто-отключение ВЫКЛЮЧЕНО — действуй вручную в /admin/providers.`,
                  'WARNING'
                );
                await redis.set(alertKey, '1', 'EX', 3600).catch(() => null);
              } catch (alertErr) {
                console.warn(`[ProviderBalanceService] Async error alert failed for ${provider.name}:`, alertErr);
              }
            })();
          }
        }
      } catch (dbErr) {
        console.warn(`[ProviderBalanceService] SLA error update failed for provider ${provider.id}:`, dbErr);
      }

      return errorResult;
    }
  }

  /**
   * Retrieves balances for all active providers in parallel.
   */
  async getAllProviderBalances(forceRefresh = false): Promise<CachedProviderBalance[]> {
    const providers = await db.provider.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    const balancePromises = providers.map((p) => this.getProviderBalance(p.id, forceRefresh));
    const results = await Promise.allSettled(balancePromises);

    return results.map((res, index) => {
      if (res.status === 'fulfilled') {
        return res.value;
      }
      const provider = providers[index];
      const now = Date.now();
      return {
        providerId: provider.id,
        providerName: provider.name,
        balance: 0,
        rawBalance: '0',
        currency: provider.balanceCurrency || 'USD',
        balanceUsd: 0,
        balanceRub: 0,
        status: 'error',
        latencyMs: 0,
        cachedAt: now,
        expiresAt: now + this.ERROR_CACHE_TTL_SECONDS * 1000,
        error: res.reason?.message || 'Не удалось получить баланс провайдера.',
      };
    });
  }

  /**
   * Calculates aggregated global liquidity across all active providers,
   * including 24h burn rate and estimated runway in days.
   */
  async getGlobalLiquiditySummary(forceRefresh = false): Promise<GlobalLiquiditySummary> {
    const cacheKey = 'providers:global:liquidity';

    if (!forceRefresh) {
      try {
        const cached = await redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as GlobalLiquiditySummary;
        }
      } catch (err) {
        console.warn(`[ProviderBalanceService] Redis read error for ${cacheKey}:`, err);
      }
    }

    const providerBalances = await this.getAllProviderBalances(forceRefresh);

    // Calculate 24h burn rate from non-failed orders
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);

    let burnRate24hRub = 0;
    try {
      // tenant-isolation-ignore: Global platform balance and provider burn rate summary
      const aggregate = await db.order.aggregate({
        _sum: { providerCost: true },
        where: {
          createdAt: { gte: yesterday },
          status: { notIn: ['ERROR', 'CANCELED'] },
        },
      });

      const burnRate24hCents = Number(aggregate._sum.providerCost || 0);
      burnRate24hRub = burnRate24hCents / 100;
    } catch (orderErr) {
      console.warn('[ProviderBalanceService] Failed to query orders for burn rate calculation:', orderErr);
    }

    let totalRub = 0;
    let totalUsd = 0;
    let healthyCount = 0;
    let warningCount = 0;
    let criticalCount = 0;
    let errorCount = 0;

    for (const p of providerBalances) {
      if (p.status !== 'error') {
        totalRub += p.balanceRub;
        totalUsd += p.balanceUsd;
      }

      if (p.status === 'healthy') healthyCount++;
      else if (p.status === 'warning') warningCount++;
      else if (p.status === 'critical') criticalCount++;
      else if (p.status === 'error') errorCount++;
    }

    const runwayDays = burnRate24hRub > 0 ? Math.floor(totalRub / burnRate24hRub) : null;
    const now = Date.now();

    const summary: GlobalLiquiditySummary = {
      totalRub: Math.round(totalRub * 100) / 100,
      totalUsd: Math.round(totalUsd * 100) / 100,
      activeCount: providerBalances.length,
      healthyCount,
      warningCount,
      criticalCount,
      errorCount,
      burnRate24hRub: Math.round(burnRate24hRub * 100) / 100,
      runwayDays,
      providers: providerBalances,
      cachedAt: now,
    };

    try {
      await redis.set(cacheKey, JSON.stringify(summary), 'EX', this.CACHE_TTL_SECONDS);
    } catch (cacheErr) {
      console.warn(`[ProviderBalanceService] Redis write error for ${cacheKey}:`, cacheErr);
    }

    return summary;
  }
}

export const providerBalanceService = new ProviderBalanceService();
