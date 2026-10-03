'use server';

import { db } from "@/lib/db";
import { requireStaffPermission } from "@/lib/server/rbac";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { auditAdmin, auditAdminAwaitable } from "@/lib/admin-audit";
import { z } from "zod";
import { revalidatePath, revalidateTag } from "next/cache";
import { revalidateCatalogCache } from "./revalidate";
import { normalizeIconDescriptor } from "@/lib/icons/safe-svg";
import { cyrillicToSlug } from "@/utils/slugify";
import { CatalogLockGuard } from "@/lib/catalog-lock";

const categorySchema = z.object({
  name: z.string().min(1, "Название категории обязательно").max(255, "Category name too long"),
  slug: z.string().max(100, "Слаг слишком длинный").regex(/^[a-z0-9-_]*$/, "Слаг может содержать только строчные буквы, цифры, дефис и подчеркивание").optional().nullable(),
  networkId: z.string().min(1, "Network ID required"),
  sort: z.coerce.number().int().default(0),
  tenantId: z.string().optional().nullable(),
  activityType: z.string().optional().nullable(),
  requireWarning: z.coerce.boolean().default(false),
  warningMessage: z.string().max(1000, "Предупреждение слишком длинное").optional().nullable(),
  analyzerTags: z.string().max(255).optional().nullable(),
  icon: z.string().max(35000, "Icon payload too large").optional().nullable()
}).refine(data => !data.requireWarning || (typeof data.warningMessage === 'string' && data.warningMessage.trim().length > 0), {
  message: "Укажите текст предупреждения при включённой опции предупреждения",
  path: ["warningMessage"]
});

const idSchema = z.string().min(1);

export async function createCategory(rawData: { name: string; slug?: string | null; networkId: string; sort: number; tenantId?: string | null; activityType?: string | null; requireWarning?: boolean; warningMessage?: string | null; analyzerTags?: string | null; icon?: string | null }) {
  return requireStaffPermission('CATALOG', 'edit', async (admin) => {
    const data = categorySchema.parse(rawData);
    
    // Normalize and sanitize icon
    const iconResult = normalizeIconDescriptor(data.icon);
    if (!iconResult.success) {
      return { success: false, error: iconResult.error || 'Некорректная иконка' };
    }

    // Determine final slug
    let rawSlug = data.slug?.trim().toLowerCase();
    if (!rawSlug) {
      rawSlug = cyrillicToSlug(data.name) || `cat-${Date.now()}`;
    }

    // Check slug collision
    const categoryTenantId = data.tenantId || 'all';
    let finalSlug = rawSlug;
    let attempts = 0;
    while (await db.category.findFirst({ where: { slug: finalSlug, tenantId: categoryTenantId } })) {
      attempts++;
      finalSlug = `${rawSlug}-${attempts}`;
      if (attempts > 20) {
        finalSlug = `${rawSlug}-${Date.now()}`;
        break;
      }
    }

    const cat = await db.category.create({
      data: {
        name: data.name,
        slug: finalSlug,
        networkId: data.networkId,
        sort: data.sort,
        tenantId: data.tenantId || 'all',
        activityType: data.activityType,
        requireWarning: data.requireWarning,
        warningMessage: data.warningMessage,
        analyzerTags: data.analyzerTags,
        icon: iconResult.normalized
      }
    });

    await auditAdminAwaitable({
      adminId: admin.id,
      adminEmail: admin.email,
      action: "CATEGORY_CREATE",
      target: cat.id,
      targetType: "SETTINGS",
      newValue: { name: cat.name, slug: cat.slug, networkId: cat.networkId, tenantId: cat.tenantId, activityType: cat.activityType, requireWarning: cat.requireWarning, warningMessage: cat.warningMessage, analyzerTags: cat.analyzerTags, icon: cat.icon }
    });

    revalidatePath("/admin/catalog/categories");
    revalidatePath("/admin/catalog");
    revalidateTag("catalog", 'default');
    revalidateTag("services", 'default');
    revalidateTag("catalog-smmplan", 'default');
    revalidateTag("catalog-flux", 'default');
    revalidateTag("services-smmplan", 'default');
    revalidateTag("services-flux", 'default');
    revalidateCatalogCache();
    return { success: true, error: undefined, categoryId: cat.id, category: cat };
  });
}

export async function updateCategory(rawId: string, rawData: { name: string; slug?: string | null; networkId: string; sort: number; tenantId?: string | null; activityType?: string | null; requireWarning?: boolean; warningMessage?: string | null; analyzerTags?: string | null; icon?: string | null }) {
  return requireStaffPermission('CATALOG', 'edit', async (admin) => {
    const id = idSchema.parse(rawId);
    const data = categorySchema.parse(rawData);

    // Normalize and sanitize icon
    const iconResult = normalizeIconDescriptor(data.icon);
    if (!iconResult.success) {
      return { success: false, error: iconResult.error || 'Некорректная иконка' };
    }

    // Verify slug uniqueness if provided
    let updateSlug: string | undefined = undefined;
    if (data.slug?.trim()) {
      const targetSlug = data.slug.trim().toLowerCase();
      const catExisting = await db.category.findUnique({ where: { id }, select: { tenantId: true } });
      const targetTenantId = data.tenantId || catExisting?.tenantId || 'all';
      const existing = await db.category.findFirst({
        where: { slug: targetSlug, id: { not: id }, tenantId: targetTenantId }
      });
      if (existing) {
        return { success: false, error: `Слаг "${targetSlug}" уже занят другой категорией.` };
      }
      updateSlug = targetSlug;
    }

    const cat = await db.category.update({
      where: { id },
      data: {
        name: data.name,
        ...(updateSlug ? { slug: updateSlug } : {}),
        networkId: data.networkId,
        sort: data.sort,
        ...(data.tenantId ? { tenantId: data.tenantId } : {}),
        activityType: data.activityType,
        requireWarning: data.requireWarning,
        warningMessage: data.warningMessage,
        analyzerTags: data.analyzerTags,
        icon: iconResult.normalized
      }
    });

    await auditAdminAwaitable({
      adminId: admin.id,
      adminEmail: admin.email,
      action: "CATEGORY_UPDATE",
      target: cat.id,
      targetType: "SETTINGS",
      newValue: { name: cat.name, slug: cat.slug, networkId: cat.networkId, tenantId: cat.tenantId, requireWarning: cat.requireWarning, warningMessage: cat.warningMessage, analyzerTags: cat.analyzerTags, icon: cat.icon }
    });

    revalidatePath("/admin/catalog/categories");
    revalidatePath("/admin/catalog");
    revalidateTag("catalog", 'default');
    revalidateTag("services", 'default');
    revalidateTag("catalog-smmplan", 'default');
    revalidateTag("catalog-flux", 'default');
    revalidateTag("services-smmplan", 'default');
    revalidateTag("services-flux", 'default');
    revalidateCatalogCache();
    return { success: true, error: undefined };
  });
}

export async function deleteCategory(rawId: string) {
  return requireStaffPermission('CATALOG', 'edit', async (admin) => {
    const id = idSchema.parse(rawId);
    const category = await db.category.findUnique({
      where: { id },
      include: {
        _count: { select: { services: true } }
      }
    });

    if (!category) {
      return { success: false, error: 'Категория не найдена' };
    }

    if (category._count.services > 0) {
      return { 
        success: false, 
        hasServices: true,
        serviceCount: category._count.services,
        error: `Невозможно удалить. Категория содержит ${category._count.services} скрытых услуг или услуг из других проектов.`
      };
    }

    await db.category.delete({ where: { id } });

    await auditAdminAwaitable({
      adminId: admin.id,
      adminEmail: admin.email,
      action: "CATEGORY_DELETE",
      target: id,
      targetType: "SETTINGS",
      oldValue: { name: category.name, networkId: category.networkId, tenantId: category.tenantId, sort: category.sort }
    });

    revalidatePath("/admin/catalog/categories");
    revalidatePath("/admin/catalog/tree");
    revalidateTag("catalog", 'default');
    revalidateTag("services", 'default');
    revalidateTag("catalog-smmplan", 'default');
    revalidateTag("catalog-flux", 'default');
    revalidateTag("services-smmplan", 'default');
    revalidateTag("services-flux", 'default');
    revalidateCatalogCache();
    return { success: true, error: undefined };
  });
}

/**
 * Hides all services in a category (isActive = false)
 */
export async function hideCategoryAndServicesAction(categoryId: string) {
  return requireStaffPermission('CATALOG', 'edit', async (admin) => {
    const id = idSchema.parse(categoryId);
    const category = await db.category.findUnique({
      where: { id },
      select: { id: true, name: true, tenantId: true, _count: { select: { services: true } } }
    });

    if (!category) {
      return { success: false as const, error: 'Категория не найдена' };
    }

    await db.service.updateMany({
      where: {
        categoryId: id,
        ...(category.tenantId && category.tenantId !== 'all' ? { tenantId: category.tenantId } : {})
      },
      data: { isActive: false }
    });

    await auditAdminAwaitable({
      adminId: admin.id,
      adminEmail: admin.email,
      action: "CATEGORY_HIDE_ALL_SERVICES",
      target: id,
      targetType: "SETTINGS",
      newValue: { categoryName: category.name, hiddenServicesCount: category._count.services }
    });

    revalidatePath("/admin/catalog/categories");
    revalidatePath("/admin/catalog/tree");
    revalidatePath("/admin/catalog");
    revalidateTag("catalog", 'default');
    revalidateTag("services", 'default');
    revalidateTag("catalog-smmplan", 'default');
    revalidateTag("catalog-flux", 'default');
    revalidateTag("services-smmplan", 'default');
    revalidateTag("services-flux", 'default');

    revalidateCatalogCache();
    return { 
      success: true as const, 
      count: category._count.services,
      message: `Все услуги категории «${category.name}» (${category._count.services} шт.) скрыты с витрины.` 
    };
  });
}

/**
 * Merges source category into target category:
 * moves all services from source to target, then deletes source category.
 */
export async function mergeCategoriesAction(sourceCategoryId: string, targetCategoryId: string) {
  return requireStaffPermission('CATALOG', 'edit', async (admin) => {
    if (!sourceCategoryId || !targetCategoryId) {
      return { success: false as const, error: 'Source and target category IDs are required.' };
    }

    if (sourceCategoryId === targetCategoryId) {
      return { success: false as const, error: 'Source and target categories cannot be the same.' };
    }

    const sourceCat = await db.category.findUnique({ 
      where: { id: sourceCategoryId },
      include: { services: { select: { id: true, name: true } } }
    });
    if (!sourceCat) {
      return { success: false as const, error: 'Source category not found.' };
    }

    const targetCat = await db.category.findUnique({ where: { id: targetCategoryId } });
    if (!targetCat) {
      return { success: false as const, error: 'Target category not found.' };
    }

    // Invariant: cannot merge categories across different networks (e.g. Instagram into TikTok)
    if (sourceCat.networkId !== targetCat.networkId) {
      return { success: false as const, error: 'Нельзя объединять категории из разных соцсетей.' };
    }

    // Invariant: cannot merge categories across conflicting tenants
    if (
      sourceCat.tenantId && 
      targetCat.tenantId && 
      sourceCat.tenantId !== 'all' && 
      targetCat.tenantId !== 'all' && 
      sourceCat.tenantId !== targetCat.tenantId
    ) {
      return { success: false as const, error: `Нельзя объединять категории из разных сайтов (${sourceCat.tenantId} и ${targetCat.tenantId}).` };
    }

    await db.$transaction(async (tx) => {
      // 1. Move all services from source to target
      await tx.service.updateMany({
        where: {
          categoryId: sourceCategoryId,
          ...(sourceCat.tenantId && sourceCat.tenantId !== 'all' ? { tenantId: sourceCat.tenantId } : {})
        },
        data: { categoryId: targetCategoryId }
      });

      // 2. If source had tenantId 'all' and target was single-tenant, upgrade target to 'all'
      if (sourceCat.tenantId === 'all' && targetCat.tenantId !== 'all') {
        await tx.category.update({
          where: { id: targetCategoryId },
          data: { tenantId: 'all' }
        });
      }

      // 3. Delete source category
      await tx.category.delete({
        where: { id: sourceCategoryId }
      });
    });

    await auditAdminAwaitable({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'CATEGORY_MERGE',
      target: sourceCategoryId,
      targetType: 'SETTINGS',
      oldValue: { 
        sourceName: sourceCat.name, 
        sourceNetworkId: sourceCat.networkId,
        sourceTenantId: sourceCat.tenantId,
        movedServicesCount: sourceCat.services.length,
        movedServiceIds: sourceCat.services.map(s => s.id)
      },
      newValue: { targetCategoryId, targetName: targetCat.name, targetNetworkId: targetCat.networkId }
    });

    revalidatePath("/admin/catalog/categories");
    revalidatePath("/admin/catalog");
    revalidateTag("catalog", 'default');
    revalidateTag("services", 'default');

    revalidateCatalogCache();
    return { success: true as const };
  });
}

const networkSchema = z.object({
  name: z.string().min(1, "Name is required").max(255, "Name too long"),
  slug: z.string().min(1, "Slug is required").max(255, "Slug too long").regex(/^[a-z0-9-_]+$/, "Slug must be lowercase alphanumeric, dashes or underscores"),
  sort: z.coerce.number().int().default(0),
  icon: z.string().max(35000, "Icon payload too large").optional().nullable()
});

/** Create a new network with Zod validation and unique constraint check */
export async function createNetworkAction(rawData: { name: string; slug: string; sort: number; icon?: string | null }) {
  return requireStaffPermission('CATALOG', 'edit', async (admin) => {
    const parsed = networkSchema.safeParse(rawData);
    if (!parsed.success) {
      return { success: false as const, error: parsed.error.errors[0]?.message || 'Invalid network data' };
    }
    const data = parsed.data;

    // Normalize and sanitize icon
    const iconResult = normalizeIconDescriptor(data.icon);
    if (!iconResult.success) {
      return { success: false as const, error: iconResult.error || 'Некорректная иконка' };
    }

    // Check uniqueness of name and slug
    const existing = await db.network.findFirst({
      where: {
        OR: [
          { name: data.name },
          { slug: data.slug }
        ]
      }
    });
    if (existing) {
      return { success: false as const, error: 'Сеть с таким названием или slug уже существует' };
    }

    const network = await db.network.create({
      data: {
        name: data.name,
        slug: data.slug,
        sort: data.sort,
        icon: iconResult.normalized
      }
    });

    await auditAdminAwaitable({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'NETWORK_CREATE',
      target: network.id,
      targetType: 'SETTINGS',
      newValue: { name: network.name, slug: network.slug, sort: network.sort, icon: network.icon }
    });

    revalidatePath("/admin/catalog/categories");
    revalidatePath("/admin/catalog");
    revalidateTag("catalog", 'default');

    revalidateCatalogCache();
    return { success: true as const, networkId: network.id };
  });
}

/** Update an existing network with Zod validation and unique constraint check */
export async function updateNetworkAction(id: string, rawData: { name: string; slug: string; sort: number; icon?: string | null }) {
  return requireStaffPermission('CATALOG', 'edit', async (admin) => {
    if (!id || typeof id !== 'string') {
      return { success: false as const, error: 'Network ID is required' };
    }

    const parsed = networkSchema.safeParse(rawData);
    if (!parsed.success) {
      return { success: false as const, error: parsed.error.errors[0]?.message || 'Invalid network data' };
    }
    const data = parsed.data;

    // Normalize and sanitize icon
    const iconResult = normalizeIconDescriptor(data.icon);
    if (!iconResult.success) {
      return { success: false as const, error: iconResult.error || 'Некорректная иконка' };
    }

    // Check network exists
    const network = await db.network.findUnique({ where: { id } });
    if (!network) {
      return { success: false as const, error: 'Network not found' };
    }

    // Check uniqueness of name and slug for other networks
    const existing = await db.network.findFirst({
      where: {
        OR: [
          { name: data.name },
          { slug: data.slug }
        ],
        NOT: { id }
      }
    });
    if (existing) {
      return { success: false as const, error: 'Сеть с таким названием или slug уже существует' };
    }

    const updated = await db.network.update({
      where: { id },
      data: {
        name: data.name,
        slug: data.slug,
        sort: data.sort,
        icon: iconResult.normalized
      }
    });

    await auditAdminAwaitable({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'NETWORK_UPDATE',
      target: id,
      targetType: 'SETTINGS',
      oldValue: { name: network.name, slug: network.slug, sort: network.sort, icon: network.icon },
      newValue: { name: updated.name, slug: updated.slug, sort: updated.sort, icon: updated.icon }
    });

    revalidatePath("/admin/catalog/categories");
    revalidatePath("/admin/catalog");
    revalidateTag("catalog", 'default');

    revalidateCatalogCache();
    return { success: true as const };
  });
}

/** Delete a network if it has no associated categories */
export async function deleteNetworkAction(id: string) {
  return requireStaffPermission('CATALOG', 'edit', async (admin) => {
    if (!id || typeof id !== 'string') {
      return { success: false as const, error: 'Network ID is required' };
    }

    const network = await db.network.findUnique({ where: { id } });
    if (!network) {
      return { success: false as const, error: 'Network not found' };
    }

    // Check if network has categories
    // tenant-isolation-ignore: Network deletion checks categories across all tenants for integrity
    const categoryCount = await db.category.count({
      where: { networkId: id }
    });
    if (categoryCount > 0) {
      return {
        success: false as const,
        error: `Невозможно удалить сеть. Она содержит ${categoryCount} категорий. Удалите или переместите их сначала.`
      };
    }

    await db.network.delete({ where: { id } });

    await auditAdminAwaitable({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'NETWORK_DELETE',
      target: id,
      targetType: 'SETTINGS',
      oldValue: { name: network.name, slug: network.slug, sort: network.sort }
    });

    revalidatePath("/admin/catalog/categories");
    revalidatePath("/admin/catalog");
    revalidateTag("catalog", 'default');

    revalidateCatalogCache();
    return { success: true as const };
  });
}

/**
 * Deletes all empty categories (categories with 0 services).
 * Optionally filtered by networkId.
 */
export async function cleanupEmptyCategoriesAction(networkId?: string | null) {
  return requireStaffPermission('CATALOG', 'edit', async (admin) => {
    const whereClause: Record<string, unknown> = {
      services: { none: {} }
    };
    if (networkId && networkId !== 'ALL') {
      whereClause.networkId = networkId;
    }

    const emptyCats = await db.category.findMany({
      where: whereClause,
      select: { id: true, name: true, networkId: true, tenantId: true }
    });

    if (emptyCats.length === 0) {
      revalidateCatalogCache();
      return {
        success: true as const,
        deletedCount: 0,
        message: 'Пустых категорий без услуг не обнаружено.'
      };
    }

    const deleteResult = await db.category.deleteMany({
      where: {
        id: { in: emptyCats.map(c => c.id) },
        ...(admin.role !== 'OWNER' && admin.tenantId ? { tenantId: admin.tenantId } : {})
      }
    });

    await auditAdminAwaitable({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'CATEGORY_BULK_CLEANUP_EMPTY',
      target: networkId || 'ALL',
      targetType: 'SETTINGS',
      newValue: {
        deletedCount: deleteResult.count,
        categories: emptyCats.map(c => ({ id: c.id, name: c.name }))
      }
    });

    revalidatePath("/admin/catalog/categories");
    revalidatePath("/admin/catalog/tree");
    revalidatePath("/admin/catalog");
    revalidateTag("catalog", 'default');
    revalidateTag("services", 'default');
    revalidateTag("catalog-smmplan", 'default');
    revalidateTag("catalog-flux", 'default');
    revalidateTag("services-smmplan", 'default');
    revalidateTag("services-flux", 'default');

    revalidateCatalogCache();
    return {
      success: true as const,
      deletedCount: deleteResult.count,
      message: `Успешно удалено ${deleteResult.count} пустых категорий без услуг.`
    };
  });
}

/**
 * Returns current catalog lock and inviolability status.
 * Accessible to administrators and staff with CATALOG permissions.
 */
export async function getCatalogLockStatusAction() {
  return requireStaffPermission('CATALOG', 'view', async (admin) => {
    const isLocked = await CatalogLockGuard.isLocked();
    const status = await CatalogLockGuard.getStatus();
    return {
      success: true as const,
      isLocked,
      canManage: admin.role === 'ADMIN' || admin.role === 'OWNER',
      updatedAt: status.updatedAt,
      updatedBy: status.updatedBy
    };
  });
}

/**
 * Toggles catalog lock status.
 * Both ADMIN and OWNER roles have full authority to lock or unlock the catalog.
 */
export async function toggleCatalogLockAction(lock: boolean, reason?: string) {
  return requireStaffPermission('CATALOG', 'edit', async (admin) => {
    if (admin.role !== 'ADMIN' && admin.role !== 'OWNER') {
      return { 
        success: false as const, 
        error: 'Только Администратор (ADMIN) или Владелец (OWNER) могут изменять статус блокировки каталога.' 
      };
    }

    if (lock) {
      await CatalogLockGuard.lockCatalog(admin.email);
    } else {
      await CatalogLockGuard.unlockCatalog(admin.email, reason || 'Ручная разблокировка администратором через панель управления');
    }

    await auditAdminAwaitable({
      adminId: admin.id,
      adminEmail: admin.email,
      action: lock ? 'CATALOG_LOCK' : 'CATALOG_UNLOCK',
      target: 'CATALOG_LOCK',
      targetType: 'SETTINGS',
      newValue: { locked: lock, reason: reason || null, updatedBy: admin.email }
    });

    revalidateCatalogCache();
    return { success: true as const, isLocked: lock };
  });
}



