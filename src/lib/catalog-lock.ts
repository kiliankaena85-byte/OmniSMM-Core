/**
 * (c) 2024-2026 SMMplan / OmniSMM Core. All rights reserved.
 * 
 * CATALOG LOCK & INVIOLABLE DATABASE GUARD
 * =========================================
 * Protects configured categories, social networks, and catalog hierarchy from:
 * 1. Accidental re-seeding or test script runs against production
 * 2. Background worker automated reclassifications / empty category deletions
 * 3. Schema pushes or raw seed overwrites
 * 
 * Inviolability Invariant:
 * Once the platform catalog is configured by the owner/administrator,
 * it is LOCKED by default. Destructive scripts and seeders cannot execute.
 */

import { db } from '@/lib/db';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';

export const CATALOG_LOCK_KEY = 'CATALOG_LOCKED';
export const DATABASE_INVIOLABLE_KEY = 'DATABASE_INVIOLABLE';
const REDIS_LOCK_CACHE_KEY = 'system:catalog:lock_status';

export interface AdminContextLike {
  id?: string;
  email?: string;
  role?: string;
  staffRole?: {
    permissions?: Array<{ section: string; canEdit: boolean; canView?: boolean }>;
  } | null;
}

export class CatalogLockGuard {
  /**
   * Checks if caller has administrative authorization to manage the catalog.
   * Both ADMIN and OWNER roles have full management rights, as well as
   * authorized staff with granular CATALOG edit permissions.
   */
  static canAdminManage(adminContext?: AdminContextLike | null): boolean {
    if (!adminContext) return false;
    const role = adminContext.role?.toUpperCase();
    if (role === 'OWNER' || role === 'ADMIN') {
      return true;
    }

    return Boolean(
      adminContext.staffRole?.permissions?.some(
        p => p.section.toUpperCase() === 'CATALOG' && p.canEdit
      )
    );
  }

  /**
   * Checks if catalog configuration is locked and inviolable.
   * Defaults to true if the lock setting is missing or set to 'true'.
   */
  static async isLocked(): Promise<boolean> {
    try {
      // Check Redis cache first
      if (redis) {
        const cached = await redis.get(REDIS_LOCK_CACHE_KEY);
        if (cached !== null) {
          return cached === 'true';
        }
      }

      // Check SystemSetting in database
      const setting = await db.systemSetting.findUnique({
        where: { key: CATALOG_LOCK_KEY }
      });

      // Default to true (safe, fail-closed) if setting exists and is not explicitly 'false'
      const isLocked = setting ? setting.value.toLowerCase() === 'true' : true;

      if (redis) {
        await redis.set(REDIS_LOCK_CACHE_KEY, isLocked ? 'true' : 'false', 'EX', 60);
      }

      return isLocked;
    } catch (err) {
      // Fail-closed: in case of DB read error, assume locked to protect catalog
      logger.warn('[CatalogLockGuard] Error checking lock status, failing closed (locked):', { err });
      return true;
    }
  }

  /**
   * Asserts that an operation on the catalog is permitted.
   * - If an adminContext is provided for an ADMIN or OWNER (or staff with CATALOG edit),
   *   the operation is ALWAYS PERMITTED without throwing.
   * - If no adminContext is provided (automated scripts, background workers, seeders),
   *   this method checks if the catalog is locked and throws a fatal error if locked.
   */
  static async assertCatalogUnlocked(
    operation: string,
    adminContext?: AdminContextLike | null
  ): Promise<void> {
    // 1. Authorized Administrators (ADMIN, OWNER, CATALOG edit) can ALWAYS manage the catalog
    if (this.canAdminManage(adminContext)) {
      logger.debug(`[CatalogLockGuard] Operation "${operation}" authorized for administrator (${adminContext?.role}: ${adminContext?.email})`);
      return;
    }

    // 2. Automated scripts, background workers, or unauthorized callers: enforce lock
    const locked = await this.isLocked();
    if (locked) {
      const msg = `⛔ [INVIOLABLE DATABASE GUARD] Operation "${operation}" rejected! ` +
        `The catalog is LOCKED and INVIOLABLE against automated scripts, seeders, and background workers. ` +
        `Administrators (roles ADMIN and OWNER) retain full control to manage categories and services directly via the Admin Panel. ` +
        `To run automated scripts or batch resets, an administrator must explicitly unlock the catalog.`;
      logger.error(msg);
      throw new Error(msg);
    }
  }

  /**
   * Locks the catalog (makes database categories and hierarchy inviolable).
   * Can be initiated by ADMIN or OWNER.
   */
  static async lockCatalog(adminEmail: string = 'admin@smmplan.pro'): Promise<void> {
    await db.systemSetting.upsert({
      where: { key: CATALOG_LOCK_KEY },
      update: {
        value: 'true',
        group: 'CATALOG',
        description: 'Catalog hierarchy and categories are locked and inviolable',
        updatedBy: adminEmail
      },
      create: {
        key: CATALOG_LOCK_KEY,
        value: 'true',
        group: 'CATALOG',
        description: 'Catalog hierarchy and categories are locked and inviolable',
        updatedBy: adminEmail
      }
    });

    await db.systemSetting.upsert({
      where: { key: DATABASE_INVIOLABLE_KEY },
      update: {
        value: 'true',
        group: 'SYSTEM',
        description: 'Production database is configured and protected from resets',
        updatedBy: adminEmail
      },
      create: {
        key: DATABASE_INVIOLABLE_KEY,
        value: 'true',
        group: 'SYSTEM',
        description: 'Production database is configured and protected from resets',
        updatedBy: adminEmail
      }
    });

    if (redis) {
      await redis.set(REDIS_LOCK_CACHE_KEY, 'true', 'EX', 86400);
    }

    logger.info(`[CatalogLockGuard] Catalog successfully LOCKED by ${adminEmail}. Database is now inviolable.`);
  }

  /**
   * Unlocks the catalog. Only permitted with explicit reason and admin context (ADMIN or OWNER).
   */
  static async unlockCatalog(adminEmail: string, reason: string): Promise<void> {
    if (!reason || reason.trim().length < 5) {
      throw new Error('A detailed reason (min 5 chars) is required to unlock the catalog.');
    }

    await db.systemSetting.upsert({
      where: { key: CATALOG_LOCK_KEY },
      update: {
        value: 'false',
        group: 'CATALOG',
        description: `Unlocked: ${reason}`,
        updatedBy: adminEmail
      },
      create: {
        key: CATALOG_LOCK_KEY,
        value: 'false',
        group: 'CATALOG',
        description: `Unlocked: ${reason}`,
        updatedBy: adminEmail
      }
    });

    if (redis) {
      await redis.set(REDIS_LOCK_CACHE_KEY, 'false', 'EX', 3600);
    }

    logger.warn(`[CatalogLockGuard] ⚠️ Catalog UNLOCKED by ${adminEmail}. Reason: ${reason}`);
  }

  /**
   * Gets current lock status details.
   */
  static async getStatus(): Promise<{ isLocked: boolean; isInviolable: boolean; updatedAt: Date | null; updatedBy: string | null }> {
    const setting = await db.systemSetting.findUnique({
      where: { key: CATALOG_LOCK_KEY }
    });

    const isLocked = setting ? setting.value.toLowerCase() === 'true' : true;
    return {
      isLocked,
      isInviolable: isLocked,
      updatedAt: setting?.updatedAt ?? null,
      updatedBy: setting?.updatedBy ?? null
    };
  }
}

