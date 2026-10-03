import { NextRequest } from 'next/server';
import { StorefrontKeyService } from '@/services/storefront/storefront-key.service';
import { db } from '@/lib/db';

export interface StorefrontContext {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  keyType: 'publishable' | 'secret';
  rateLimit: number;
}

export async function resolveStorefrontContext(req: NextRequest): Promise<StorefrontContext | null> {
  // 1. Извлечение токена из заголовков (X-Storefront-Key или Authorization: Bearer)
  const headerKey = req.headers.get('x-storefront-key');
  const authHeader = req.headers.get('authorization');
  let token = headerKey;

  if (!token && authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  // 2. Аутентификация по ключу
  if (token) {
    const keyContext = await StorefrontKeyService.verifyKey(token);
    if (keyContext) {
      return keyContext;
    }
  }

  // 3. Fallback: аутентификация по валидированному x-tenant-id (из proxy.ts)
  const verifiedTenantId = req.headers.get('x-tenant-id');
  if (verifiedTenantId) {
    const tenant = await db.tenant.findUnique({
      where: { slug: verifiedTenantId },
    });
    if (tenant && tenant.isActive) {
      return {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        keyType: 'publishable',
        rateLimit: 120,
      };
    }
  }

  // 4. Fallback: аутентификация по кастомному домену (investor-store.ru) или домену платформы (smmplan / flux)
  // Применима только для публичных запросов (keyType = publishable)
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  if (host) {
    // Учитываем порты в dev окружении
    const domain = host.split(':')[0].toLowerCase();
    
    // Платформенные домены SMMplan (smmplan.pro, smmplan.tail*.ts.net, etc.) или локальный origin (localhost / 127.0.0.1)
    if (domain.includes('smmplan') || domain === 'localhost' || domain === '127.0.0.1' || domain === '0.0.0.0') {
      const tenant = await db.tenant.findUnique({
        where: { slug: 'smmplan' },
      });
      if (tenant && tenant.isActive) {
        return {
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          tenantName: tenant.name,
          keyType: 'publishable',
          rateLimit: 120,
        };
      }
    }

    // Платформенные домены SMMflux (smmflux.ru, etc.)
    if (domain.includes('smmflux') || domain.includes('flux')) {
      const tenant = await db.tenant.findUnique({
        where: { slug: 'flux' },
      });
      if (tenant && tenant.isActive) {
        return {
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          tenantName: tenant.name,
          keyType: 'publishable',
          rateLimit: 120,
        };
      }
    }

    // Кастомный домен инвестора (investor-store.ru)
    if (!domain.includes('localhost') && !domain.includes('127.0.0.1')) {
      const tenant = await db.tenant.findUnique({
        where: { customDomain: domain },
      });

      if (tenant && tenant.isActive) {
        return {
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          tenantName: tenant.name,
          keyType: 'publishable',
          rateLimit: 60,
        };
      }
    }
  }

  return null;
}
