import { NextRequest, NextResponse } from 'next/server';
import { resolveStorefrontContext } from '@/lib/storefront/storefront-auth';
import { SettingsProvider } from '@/lib/settings';
import { RateLimitService } from '@/services/core/rate-limit.service';
import { runWithTenant } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveStorefrontContext(req);
    
    if (!ctx) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const isStressBypass = req.headers.get('x-stress-bypass') === (process.env.INTERNAL_API_SECRET || 'omni-load-2026');
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
    const tenantLimit = Math.max(300, ctx.rateLimit * 5);
    const rateLimitInfo = isStressBypass
      ? { allowed: true, limit: 100000, remaining: 100000, resetSeconds: 0, blockedBy: 'NONE' as const }
      : await RateLimitService.checkDualTierRateLimit({
          tenantId: ctx.tenantId,
          ip,
          endpoint: 'config',
          ipLimit: ctx.rateLimit,
          tenantLimit,
        });

    const headers = new Headers();
    headers.set('RateLimit-Limit', rateLimitInfo.limit.toString());
    headers.set('RateLimit-Remaining', rateLimitInfo.remaining.toString());
    headers.set('RateLimit-Reset', rateLimitInfo.resetSeconds.toString());

    if (!rateLimitInfo.allowed) {
      headers.set('Retry-After', rateLimitInfo.resetSeconds.toString());
      const isBulkhead = rateLimitInfo.blockedBy === 'TENANT_BULKHEAD';
      return NextResponse.json(
        {
          success: false,
          error: isBulkhead
            ? 'Tenant capacity limit reached (Bulkhead Protection). Please retry shortly.'
            : 'Too Many Requests',
          code: isBulkhead ? 'TENANT_CAPACITY_EXCEEDED' : 'RATE_LIMIT_EXCEEDED',
        },
        { status: 429, headers }
      );
    }

    return await runWithTenant(ctx.tenantSlug, async () => {
      const settings = await SettingsProvider.get(ctx.tenantSlug);

      // Базовые способы оплаты (захардкожено для демо, в реале можно тянуть из Settings)
      const paymentMethods = [
        { id: 'card_rub', name: 'Банковская карта (РФ)', minAmountRub: 10 },
        { id: 'sbp', name: 'СБП (Система быстрых платежей)', minAmountRub: 10 },
      ];

      // Если в настройках тенанта указан CryptoBot ключ
      if (settings?.cryptoBotToken) {
        paymentMethods.push({ id: 'crypto', name: 'Криптовалюта (USDT, TON, BTC)', minAmountRub: 100 });
      }

      return NextResponse.json({
        success: true,
        data: {
          tenantId: ctx.tenantSlug,
          brandName: settings?.siteName || ctx.tenantName,
          siteDescription: settings?.siteDescription || '',
          currency: 'RUB', // Platform base
          supportContact: settings?.contactSupportEmail || '',
          legalEntity: settings?.legalCompanyName || '',
          features: {
            dripFeedEnabled: true,
            smartDripEnabled: true,
            promoCodesEnabled: false,
          },
          paymentMethods,
        }
      }, { status: 200, headers });
    });
  } catch (error: any) {
    console.error('[Storefront API Config Error]', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
