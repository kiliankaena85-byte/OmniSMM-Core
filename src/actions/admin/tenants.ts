'use server';

import { db } from '@/lib/db';
import { verifySession } from '@/lib/session';
import { requireStaffPermission } from '@/lib/server/rbac';
import { runWithTenantBypass } from '@/lib/tenant-context';
import { auditAdminAwaitable } from '@/lib/admin-audit';
import { z } from 'zod';
import { revalidatePath, revalidateTag } from 'next/cache';
import { cookies } from 'next/headers';
import { normalizeTenantId, registerValidTenant, sanitizeTenantSlug } from '@/lib/tenant-resolver-edge';
import { sendAdminAlert } from '@/lib/notifications';
import { DomainRegistryService } from '@/services/tenant/domain-registry.service';
import { TenantThemeService, TenantThemeConfig, ThemePresetName } from '@/services/tenant/tenant-theme.service';
import { DomainVerificationService } from '@/services/tenant/domain-verification.service';

const CreateTenantSchema = z.object({
  name: z.string().min(2, 'Название бренда должно быть не менее 2 символов').max(60),
  slug: z.string()
    .min(2, 'Идентификатор slug должен быть не менее 2 символов')
    .max(30)
    .regex(/^[a-z0-9-]+$/, 'Slug может содержать только строчные латинские буквы, цифры и дефис'),
  domain: z.string()
    .min(3, 'Доменное имя должно быть указано')
    .max(100)
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'Укажите корректный домен (например, smmflux.ru)'),
  customDomain: z.string().max(100).optional().nullable(),
  themeVariant: z.string().default('sky'),
  cloneCatalog: z.boolean().optional().default(false),
  cloneSourceTenant: z.string().optional().default('smmplan'),
  markupPercent: z.number().min(0).max(500).optional().default(0),
});

const UpdateTenantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2).max(60),
  domain: z.string().min(3).max(100),
  customDomain: z.string().max(100).optional().nullable(),
  isActive: z.boolean(),
});

export async function listTenantsAction() {
  return requireStaffPermission('settings', 'view', async () => {
    try {
      const tenants = await db.tenant.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          systemSettings: {
            select: {
              siteName: true,
              siteDescription: true,
              siteLogoUrl: true,
              siteFaviconUrl: true,
              isTestMode: true,
              maintenanceMode: true,
            }
          }
        }
      });

      return { success: true, data: tenants };
    } catch (error) {
      console.error('[TenantsAction] Failed to list tenants:', error);
      return { success: false, error: 'Не удалось загрузить список брендов', data: [] };
    }
  });
}

export async function createTenantAction(formData: z.infer<typeof CreateTenantSchema>) {
  return requireStaffPermission('settings', 'edit', async (staffUser) => {
    const parsed = CreateTenantSchema.safeParse(formData);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || 'Невалидные данные' };
    }

    const { name, slug, domain, customDomain, themeVariant, cloneCatalog, cloneSourceTenant, markupPercent } = parsed.data;
    const cleanDomain = domain.toLowerCase().trim();
    const cleanSlug = slug.toLowerCase().trim();

    // Check unique constraints
    const existing = await db.tenant.findFirst({
      where: {
        OR: [
          { slug: cleanSlug },
          { domain: cleanDomain }
        ]
      }
    });

    if (existing) {
      return { success: false, error: 'Бренд с таким slug или доменом уже зарегистрирован' };
    }

    try {
      const tenant = await db.tenant.create({
        data: {
          id: cleanSlug,
          slug: cleanSlug,
          name: name.trim(),
          domain: cleanDomain,
          customDomain: customDomain?.toLowerCase().trim() || null,
          isActive: true,
          systemSettings: {
            create: {
              siteName: name.trim(),
              siteDescription: `Оптовая платформа продвижения в соцсетях ${name.trim()}`,
              welcomeMessage: `Добро пожаловать в ${name.trim()}! Ваш личный кабинет готов.`,
              taxRate: 6.0,
              isTestMode: false,
            }
          }
        }
      });

      registerValidTenant(cleanSlug);
      await DomainRegistryService.registerDomain({
        id: tenant.id,
        slug: cleanSlug,
        domain: cleanDomain,
        customDomain: customDomain?.toLowerCase().trim() || null,
        isActive: true,
      });

      if (customDomain) {
        try {
          const meta = DomainVerificationService.generateDomainMeta(cleanSlug, customDomain);
          await DomainVerificationService.saveDomainMeta(cleanSlug, meta);
        } catch (err) {
          console.warn(`[TenantsAction] Failed to initialize domain verification for ${cleanSlug}:`, err);
        }
      }

      const presetMap: Record<string, ThemePresetName> = {
        classic: 'sky',
        vibrant: 'violet',
        minimal: 'slate',
        sky: 'sky',
        violet: 'violet',
        emerald: 'emerald',
        amber: 'amber',
        rose: 'rose',
        indigo: 'indigo',
        slate: 'slate',
      };
      const presetToUse = presetMap[themeVariant] || 'sky';
      await TenantThemeService.saveTheme(cleanSlug, { preset: presetToUse }, staffUser.email).catch((err) => {
        console.warn(`[TenantsAction] Failed to initialize theme for ${cleanSlug}:`, err);
      });

      // Optional Turnkey White-Label catalog cloning
      if (cloneCatalog) {
        try {
          const srcTenant = cloneSourceTenant || 'smmplan';
          const multiplier = 1 + (Number(markupPercent) || 0) / 100;

          const sourceCategories = await db.category.findMany({
            where: { tenantId: srcTenant },
            include: { services: { where: { tenantId: srcTenant } } },
          });

          await db.$transaction(async (tx) => {
            for (const cat of sourceCategories) {
              const newCat = await tx.category.create({
                data: {
                  name: cat.name,
                  slug: `${cat.slug}-${cleanSlug}`,
                  networkId: cat.networkId,
                  tenantId: cleanSlug,
                  sort: cat.sort,
                  activityType: cat.activityType,
                  requireWarning: cat.requireWarning,
                  warningMessage: cat.warningMessage,
                  analyzerTags: cat.analyzerTags,
                  icon: cat.icon,
                },
              });

              if (cat.services && cat.services.length > 0) {
                await tx.service.createMany({
                  data: cat.services.map((s) => {
                    const baseRetailCents = s.pricePer1000Cents && s.pricePer1000Cents > 0
                      ? s.pricePer1000Cents
                      : Math.round(((s.costPer1kRub || s.rate) * (s.markup || 8.0)) * 100);
                    const targetPricePer1000Cents = Math.round(baseRetailCents * multiplier);

                    return {
                      name: s.name,
                      description: s.description,
                      icon: s.icon,
                      features: s.features ?? undefined,
                      categoryId: newCat.id,
                      tenantId: cleanSlug,
                      providerId: s.providerId,
                      externalId: s.externalId,
                      rate: s.rate,
                      costPer1kRub: s.costPer1kRub || s.rate,
                      providerCurrency: s.providerCurrency,
                      markup: s.markup ? Math.round(s.markup * multiplier * 100) / 100 : 8.0,
                      pricePer1000Cents: targetPricePer1000Cents,
                      slug: s.slug ? `${s.slug}-${cleanSlug}` : null,
                      minQty: s.minQty,
                      maxQty: s.maxQty,
                      isActive: s.isActive,
                      sortOrder: s.sortOrder,
                      isDripFeedEnabled: s.isDripFeedEnabled,
                      isRefillEnabled: s.isRefillEnabled,
                      isCancelEnabled: s.isCancelEnabled,
                      targetType: s.targetType,
                      customDataType: s.customDataType,
                      customDataLabel: s.customDataLabel,
                      qualityTier: s.qualityTier,
                    };
                  }),
                });
              }
            }
          }, { timeout: 30000 });
        } catch (catErr) {
          console.warn(`[TenantsAction] Failed to clone catalog for ${cleanSlug}:`, catErr);
        }
      }

      await auditAdminAwaitable({
        adminId: staffUser.id,
        adminEmail: staffUser.email,
        action: 'TENANT_CREATE',
        target: tenant.id,
        targetType: 'Tenant',
        newValue: { name, slug: cleanSlug, domain: cleanDomain },
      });

      sendAdminAlert(
        `🏢 <b>СОЗДАН НОВЫЙ ТЕНАНТ / БРЕНД</b>\n` +
        `<b>Название:</b> ${name}\n` +
        `<b>Slug / ID:</b> <code>${cleanSlug}</code>\n` +
        `<b>Домен:</b> <code>${cleanDomain}</code>\n` +
        `<b>Сотрудник:</b> ${staffUser.email}`,
        'INFO',
        cleanSlug
      );

      revalidatePath('/admin/tenants');
      return { success: true, data: tenant };
    } catch (error) {
      console.error('[TenantsAction] Failed to create tenant:', error);
      return { success: false, error: 'Ошибка создания тенанта в базе данных' };
    }
  });
}

export async function updateTenantAction(formData: z.infer<typeof UpdateTenantSchema>) {
  return requireStaffPermission('settings', 'edit', async (staffUser) => {
    const parsed = UpdateTenantSchema.safeParse(formData);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || 'Невалидные данные' };
    }

    const { id, name, domain, customDomain, isActive } = parsed.data;

    try {
      const oldTenant = await db.tenant.findUnique({ where: { id } });
      if (!oldTenant) {
        return { success: false, error: 'Тенант не найден' };
      }

      const updated = await db.tenant.update({
        where: { id },
        data: {
          name: name.trim(),
          domain: domain.toLowerCase().trim(),
          customDomain: customDomain?.toLowerCase().trim() || null,
          isActive,
        }
      });

      // Synchronize changes with DomainRegistryService
      const oldDomains: string[] = [];
      if (oldTenant.domain && oldTenant.domain !== updated.domain) {
        oldDomains.push(oldTenant.domain);
      }
      if (oldTenant.customDomain && oldTenant.customDomain !== updated.customDomain) {
        oldDomains.push(oldTenant.customDomain);
      }
      if (oldDomains.length > 0) {
        await DomainRegistryService.removeDomains(oldDomains);
      }

      await DomainRegistryService.registerDomain({
        id: updated.id,
        slug: updated.slug,
        domain: updated.domain,
        customDomain: updated.customDomain,
        isActive: updated.isActive,
      });

      if (updated.customDomain && updated.customDomain !== oldTenant.customDomain) {
        try {
          const meta = DomainVerificationService.generateDomainMeta(updated.slug, updated.customDomain);
          await DomainVerificationService.saveDomainMeta(updated.slug, meta);
        } catch (err) {
          console.warn(`[TenantsAction] Failed to update domain verification for ${updated.slug}:`, err);
        }
      }

      await auditAdminAwaitable({
        adminId: staffUser.id,
        adminEmail: staffUser.email,
        action: 'TENANT_UPDATE',
        target: id,
        targetType: 'Tenant',
        oldValue: { name: oldTenant.name, domain: oldTenant.domain, isActive: oldTenant.isActive },
        newValue: { name, domain, isActive },
      });

      revalidatePath('/admin/tenants');
      return { success: true, data: updated };
    } catch (error) {
      console.error('[TenantsAction] Failed to update tenant:', error);
      return { success: false, error: 'Ошибка обновления тенанта' };
    }
  });
}

export async function toggleTenantStatusAction(id: string, isActive: boolean) {
  return requireStaffPermission('settings', 'edit', async (staffUser) => {
    if ((id === 'smmplan' || id === 'flux') && !isActive) {
      return { success: false, error: 'Нельзя деактивировать системный базовый бренд' };
    }

    try {
      const updated = await db.tenant.update({
        where: { id },
        data: { isActive }
      });

      await DomainRegistryService.registerDomain({
        id: updated.id,
        slug: updated.slug,
        domain: updated.domain,
        customDomain: updated.customDomain,
        isActive: updated.isActive,
      });

      await auditAdminAwaitable({
        adminId: staffUser.id,
        adminEmail: staffUser.email,
        action: 'TENANT_STATUS_TOGGLE',
        target: id,
        targetType: 'Tenant',
        newValue: { isActive },
      });

      sendAdminAlert(
        `🚨 <b>СТАТУС ТЕНАНТА ИЗМЕНЁН</b>\n` +
        `<b>Тенант:</b> <code>${id}</code>\n` +
        `<b>Статус:</b> ${isActive ? '🟢 АКТИВЕН' : '🔴 ДЕАКТИВИРОВАН'}\n` +
        `<b>Сотрудник:</b> ${staffUser.email}`,
        isActive ? 'INFO' : 'CRITICAL',
        id
      );

      revalidatePath('/admin/tenants');
      return { success: true, data: updated };
    } catch (error) {
      console.error('[TenantsAction] Failed to toggle tenant status:', error);
      return { success: false, error: 'Ошибка изменения статуса тенанта' };
    }
  });
}

export async function toggleTenantMaintenanceAction(id: string, maintenanceMode: boolean) {
  return requireStaffPermission('settings', 'edit', async (staffUser) => {
    try {
      const { SettingsProvider } = await import('@/lib/settings');
      await SettingsProvider.setMaintenanceMode(maintenanceMode, id);

      await auditAdminAwaitable({
        adminId: staffUser.id,
        adminEmail: staffUser.email,
        action: 'TENANT_MAINTENANCE_TOGGLE',
        target: id,
        targetType: 'Tenant',
        newValue: { maintenanceMode },
      });

      sendAdminAlert(
        `🚨 <b>РЕЖИМ ТЕХРАБОТ ИЗМЕНЁН</b>\n` +
        `<b>Тенант / Бренд:</b> <code>${id}</code>\n` +
        `<b>Статус:</b> ${maintenanceMode ? '🔴 ВКЛЮЧЁН (Витрина закрыта)' : '🟢 ВЫКЛЮЧЕН (Витрина доступна)'}\n` +
        `<b>Сотрудник:</b> ${staffUser.email}`,
        'CRITICAL',
        id
      );

      revalidatePath('/admin/tenants');
      revalidatePath('/admin/settings');
      revalidatePath('/', 'layout');
      return { success: true, maintenanceMode };
    } catch (error) {
      console.error('[TenantsAction] Failed to toggle tenant maintenance:', error);
      return { success: false, error: 'Ошибка переключения режима техработ' };
    }
  });
}

export async function deleteTenantAction(id: string) {
  const session = await verifySession();
  if (!session || session.role !== 'OWNER') {
    return { success: false, error: 'Удаление брендов доступно только Владельцу (OWNER)' };
  }

  if (id === 'smmplan' || id === 'flux') {
    return { success: false, error: 'Запрещено удалять системные базовые бренды (smmplan, flux)' };
  }

  try {
    const tenantToDelete = await db.tenant.findUnique({ where: { id } });
    if (!tenantToDelete) {
      return { success: false, error: 'Тенант не найден' };
    }

    const domainsToRemove = [tenantToDelete.domain, tenantToDelete.customDomain, tenantToDelete.slug].filter(Boolean) as string[];
    if (domainsToRemove.length > 0) {
      await DomainRegistryService.removeDomains(domainsToRemove);
    }
    const { unregisterValidTenant } = await import('@/lib/tenant-resolver-edge');
    unregisterValidTenant(tenantToDelete.slug);

    await db.tenant.delete({ where: { id } });

    const user = await runWithTenantBypass('Admin delete tenant staff lookup', async () => {
      return db.user.findUnique({
        where: { id: session.userId },
        select: { email: true }
      });
    });

    await auditAdminAwaitable({
      adminId: session.userId,
      adminEmail: user?.email || 'owner@smmplan.pro',
      action: 'TENANT_DELETE',
      target: id,
      targetType: 'Tenant',
    });

    revalidatePath('/admin/tenants');
    return { success: true };
  } catch (error) {
    console.error('[TenantsAction] Failed to delete tenant:', error);
    return { success: false, error: 'Ошибка удаления тенанта (проверьте связанные данные)' };
  }
}

import { redis } from '@/lib/redis';

/**
 * Explicit and secure Server Action for switching the active administrative tenant.
 * Persists tenant in server-side staff session, validates staff permissions, and records audit trail.
 */
export async function switchAdminTenantAction(tenantId: string) {
  const session = await verifySession();
  if (!session) {
    return { success: false, error: 'Необходима авторизация' };
  }

  const STAFF_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'SUPPORT', 'OPERATOR'];
  if (!session.role || !STAFF_ROLES.includes(session.role)) {
    return { success: false, error: 'Доступ запрещён: требуется роль сотрудника' };
  }

  const user = await runWithTenantBypass('Admin switch tenant staff lookup', async () => {
    return db.user.findUnique({
      where: { id: session.userId },
      select: { id: true, email: true, role: true, allowedTenants: true, tenantId: true },
    });
  });

  if (!user) {
    return { success: false, error: 'Пользователь не найден' };
  }

  const normalized = normalizeTenantId(tenantId) || 'smmplan';

  // Strict tenant boundary constraint (ISO 29148 / NIST SP 800-162):
  // Only OWNER can switch to any tenant or view all.
  // ADMIN, SUPPORT, MANAGER, OPERATOR are strictly restricted to their assigned allowedTenants.
  if (user.role !== 'OWNER') {
    const allowed = (user.allowedTenants && user.allowedTenants.length > 0)
      ? user.allowedTenants
      : [user.tenantId || 'smmplan'];

    if (!allowed.includes(normalized)) {
      return {
        success: false,
        error: `Доступ к бренду [${normalized}] ограничен настройками вашей роли`,
      };
    }
  }

  // Server-side session storage in Redis for Staff
  await redis.set(`staff:${session.userId}:active_tenant`, normalized, 'EX', 86400 * 30).catch(() => {});

  // Security audit log for tenant switching
  await auditAdminAwaitable({
    adminId: session.userId,
    adminEmail: user.email,
    action: 'TENANT_SWITCH',
    target: normalized,
    targetType: 'SYSTEM',
    newValue: {
      userId: session.userId,
      role: session.role,
      targetTenant: normalized,
    },
  }).catch(() => {});

  const cookieStore = await cookies();
  cookieStore.set('x_admin_tenant', normalized, {
    path: '/',
    maxAge: 31536000, // 1 year
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
  });

  revalidatePath('/admin', 'layout');

  try {
    const invalidateTag = revalidateTag as unknown as (tag: string, profile?: string) => void;
    invalidateTag('catalog', 'default');
    invalidateTag('services', 'default');
    invalidateTag(`catalog-${normalized}`, 'default');
    invalidateTag(`services-${normalized}`, 'default');
    invalidateTag('clients', 'default');
    invalidateTag(`clients-${normalized}`, 'default');
  } catch (err: unknown) {
    // Non-fatal tag revalidation error in standalone/test execution
  }

  return { success: true, tenantId: normalized };
}

const UpdateTenantThemeSchema = z.object({
  tenantId: z.string().min(1),
  preset: z.enum(['sky', 'violet', 'emerald', 'amber', 'rose', 'indigo', 'slate', 'custom']),
  primaryColor: z.string().optional(),
  primaryForeground: z.string().optional(),
  secondaryColor: z.string().optional(),
  secondaryForeground: z.string().optional(),
  ringColor: z.string().optional(),
  accentColor: z.string().optional(),
  accentForeground: z.string().optional(),
  borderRadius: z.string().optional(),
  darkPrimaryColor: z.string().optional(),
  darkPrimaryForeground: z.string().optional(),
  darkSecondaryColor: z.string().optional(),
  darkSecondaryForeground: z.string().optional(),
  darkRingColor: z.string().optional(),
});

export async function getTenantThemeAction(tenantId: string) {
  return requireStaffPermission('settings', 'view', async () => {
    try {
      const theme = await TenantThemeService.getTheme(tenantId);
      return { success: true, data: theme };
    } catch (error) {
      console.error('[getTenantThemeAction] Error:', error);
      return { success: false, error: 'Ошибка получения темы оформления' };
    }
  });
}

export async function updateTenantThemeAction(formData: z.infer<typeof UpdateTenantThemeSchema>) {
  return requireStaffPermission('settings', 'edit', async (staffUser) => {
    const parsed = UpdateTenantThemeSchema.safeParse(formData);
    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message || 'Невалидные данные темы' };
    }

    const { tenantId, ...themeConfig } = parsed.data;

    try {
      const saved = await TenantThemeService.saveTheme(tenantId, themeConfig, staffUser.email);

      await auditAdminAwaitable({
        adminId: staffUser.id,
        adminEmail: staffUser.email,
        action: 'TENANT_THEME_UPDATE',
        target: tenantId,
        targetType: 'TenantTheme',
        newValue: themeConfig,
      });

      revalidatePath('/', 'layout');
      revalidatePath('/dashboard', 'layout');
      revalidatePath('/admin/tenants');

      return { success: true, data: saved };
    } catch (error) {
      console.error('[updateTenantThemeAction] Error:', error);
      return { success: false, error: 'Ошибка сохранения темы оформления' };
    }
  });
}

export async function getDomainVerificationAction(tenantId: string) {
  return requireStaffPermission('settings', 'view', async () => {
    try {
      const cleanSlug = sanitizeTenantSlug(tenantId);
      const meta = await DomainVerificationService.getDomainMeta(cleanSlug);
      return { success: true, data: meta };
    } catch (error) {
      console.error('[getDomainVerificationAction] Error:', error);
      return { success: false, error: 'Ошибка получения статуса верификации домена' };
    }
  });
}

export async function verifyCustomDomainAction(tenantId: string) {
  return requireStaffPermission('settings', 'edit', async (staffUser) => {
    try {
      const cleanSlug = sanitizeTenantSlug(tenantId);
      const result = await DomainVerificationService.verifyDomain(cleanSlug);

      await auditAdminAwaitable({
        adminId: staffUser.id,
        adminEmail: staffUser.email,
        action: 'TENANT_DOMAIN_VERIFY',
        target: cleanSlug,
        targetType: 'TenantDomain',
        newValue: { status: result.status, customDomain: result.meta?.customDomain, error: result.error },
      });

      revalidatePath('/admin/tenants');
      return { success: result.success, status: result.status, error: result.error, data: result.meta };
    } catch (error) {
      console.error('[verifyCustomDomainAction] Error:', error);
      return { success: false, error: 'Ошибка при проверке DNS-записей домена' };
    }
  });
}

export async function regenerateDomainVerificationTokenAction(tenantId: string) {
  return requireStaffPermission('settings', 'edit', async (staffUser) => {
    try {
      const cleanSlug = sanitizeTenantSlug(tenantId);
      const meta = await DomainVerificationService.regenerateToken(cleanSlug);

      await auditAdminAwaitable({
        adminId: staffUser.id,
        adminEmail: staffUser.email,
        action: 'TENANT_DOMAIN_TOKEN_ROTATE',
        target: cleanSlug,
        targetType: 'TenantDomain',
        newValue: { token: meta.verificationToken },
      });

      revalidatePath('/admin/tenants');
      return { success: true, data: meta };
    } catch (error) {
      console.error('[regenerateDomainVerificationTokenAction] Error:', error);
      return { success: false, error: 'Ошибка обновления токена верификации' };
    }
  });
}

