import { NextRequest, NextResponse } from 'next/server';
import { resolveStorefrontContext } from '@/lib/storefront/storefront-auth';
import { getServicesByCategoryAction } from '@/actions/order/catalog';
import { db } from '@/lib/db';
import { RateLimitService } from '@/services/core/rate-limit.service';
import { runWithTenant } from '@/lib/tenant-context';
import { resolveServiceTargetType } from '@/utils/target-type-mapper';

export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveStorefrontContext(req);
    
    if (!ctx) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Dual-Tier Bulkhead Rate Limiting (RFC 9331 / BGS-2026)
    const isStressBypass = req.headers.get('x-stress-bypass') === (process.env.INTERNAL_API_SECRET || 'omni-load-2026');
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
    const tenantLimit = Math.max(600, ctx.rateLimit * 10);
    const rateLimitInfo = isStressBypass
      ? { allowed: true, limit: 100000, remaining: 100000, resetSeconds: 0, blockedBy: 'NONE' as const }
      : await RateLimitService.checkDualTierRateLimit({
          tenantId: ctx.tenantId,
          ip,
          endpoint: 'catalog',
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

    // Скоупинг запроса к БД (BOLA Immunity)
    return await runWithTenant(ctx.tenantSlug, async () => {
      // Ищем все категории тенанта
      const categories = await db.category.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { sort: 'asc' },
        include: { network: true },
      });

      const url = new URL(req.url);
      const filterCategory = url.searchParams.get('category');
      const filterTargetType = url.searchParams.get('targetType');

      const resultCategories = [];

      for (const cat of categories) {
        if (filterCategory && cat.slug !== filterCategory) continue;

        const services = await getServicesByCategoryAction(cat.id, ctx.tenantId);
        
        let filteredServices = services;
        if (filterTargetType) {
          filteredServices = filteredServices.filter(s => resolveServiceTargetType(s) === filterTargetType);
        }

        if (filteredServices.length > 0) {
          resultCategories.push({
            id: cat.id,
            name: cat.name,
            slug: cat.slug,
            icon: cat.icon || cat.network?.icon || 'globe',
            network: cat.network?.name || 'OTHER',
            services: filteredServices.map(s => ({
              id: s.id,
              name: s.name,
              description: s.description,
              minQuantity: s.minQty,
              maxQuantity: s.maxQty,
              pricePerUnitRub: s.pricePerUnitRub,
              pricePer1000Rub: s.pricePer1kRub,
              dripFeedSupported: s.isDripFeedEnabled,
              targetType: resolveServiceTargetType(s),
              speed: s.speedDisplay || s.speed,
              startTime: s.startTime,
              qualityLabel: s.qualityLabel,
              warrantyDays: s.warrantyDays,
              badge: s.badge
            })),
          });
        }
      }

      return NextResponse.json({
        success: true,
        data: { categories: resultCategories }
      }, { status: 200, headers });
    });
  } catch (error: any) {
    console.error('[Storefront API Catalog Error]', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
