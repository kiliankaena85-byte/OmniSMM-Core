import { NextRequest, NextResponse } from 'next/server';
import { resolveStorefrontContext } from '@/lib/storefront/storefront-auth';
import { RateLimitService } from '@/services/core/rate-limit.service';
import { db } from '@/lib/db';
import { runWithTenant } from '@/lib/tenant-context';

export async function GET(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const ctx = await resolveStorefrontContext(req);
    
    if (!ctx) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const orderId = params.id;
    if (!orderId) {
      return NextResponse.json({ success: false, error: 'Order ID is required' }, { status: 400 });
    }

    const isStressBypass = req.headers.get('x-stress-bypass') === (process.env.INTERNAL_API_SECRET || 'omni-load-2026');
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';
    const rateLimitInfo = isStressBypass
      ? { allowed: true, limit: 100000, remaining: 100000, resetSeconds: 0, blockedBy: 'NONE' as const }
      : await RateLimitService.checkDualTierRateLimit({
          tenantId: ctx.tenantId,
          ip,
          endpoint: 'orders_status',
          ipLimit: 120,
          tenantLimit: 600,
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

    const url = new URL(req.url);
    const email = url.searchParams.get('email');

    if (ctx.keyType === 'publishable' && !email) {
      return NextResponse.json({ success: false, error: 'Email query parameter is required for publishable keys' }, { status: 403, headers });
    }

    return await runWithTenant(ctx.tenantSlug, async () => {
      // Ищем заказ с привязкой к тенанту (по numericId или CUID id)
      const isNumeric = /^\d+$/.test(orderId);
      const order = isNumeric
        ? await db.order.findFirst({
            where: { numericId: parseInt(orderId, 10), tenantId: ctx.tenantId },
            include: { service: true, user: true }
          })
        : await db.order.findFirst({
            where: { id: orderId, tenantId: ctx.tenantId },
            include: { service: true, user: true }
          });

      if (!order) {
        return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404, headers });
      }

      // Проверка email, если запросили по публичному ключу
      const orderEmail = order.user?.email || order.email || '';
      if (ctx.keyType === 'publishable' && orderEmail.toLowerCase() !== email?.toLowerCase()) {
        return NextResponse.json({ success: false, error: 'Order not found' }, { status: 404, headers });
      }

      return NextResponse.json({
        success: true,
        data: {
          orderId: order.id,
          numericId: order.numericId,
          status: order.status,
          serviceName: order.service.name,
          link: order.link,
          quantity: order.quantity,
          remains: order.remains,
          startCount: order.startCount,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
        }
      }, { status: 200, headers });
    });
  } catch (error: any) {
    console.error('[Storefront API Get Order Error]', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
