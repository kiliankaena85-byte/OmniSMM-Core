import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CatalogLockGuard, CATALOG_LOCK_KEY, DATABASE_INVIOLABLE_KEY } from '@/lib/catalog-lock';
import { db } from '@/lib/db';
import { redis } from '@/lib/redis';

describe('CatalogLockGuard Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when catalog is locked in database', async () => {
    vi.spyOn(redis, 'get').mockResolvedValue(null as any);
    vi.spyOn(db.systemSetting, 'findUnique').mockResolvedValue({
      key: CATALOG_LOCK_KEY,
      value: 'true',
      group: 'CATALOG',
      description: 'Locked',
      updatedAt: new Date(),
      updatedBy: 'owner@smmplan.pro'
    });

    const isLocked = await CatalogLockGuard.isLocked();
    expect(isLocked).toBe(true);
  });

  it('should return false when explicitly unlocked in database', async () => {
    vi.spyOn(redis, 'get').mockResolvedValue(null as any);
    vi.spyOn(db.systemSetting, 'findUnique').mockResolvedValue({
      key: CATALOG_LOCK_KEY,
      value: 'false',
      group: 'CATALOG',
      description: 'Unlocked',
      updatedAt: new Date(),
      updatedBy: 'owner@smmplan.pro'
    });

    const isLocked = await CatalogLockGuard.isLocked();
    expect(isLocked).toBe(false);
  });

  it('assertCatalogUnlocked should throw when catalog is locked and no adminContext is provided', async () => {
    vi.spyOn(redis, 'get').mockResolvedValue('true' as any);

    await expect(CatalogLockGuard.assertCatalogUnlocked('TEST_SEED'))
      .rejects
      .toThrow(/INVIOLABLE DATABASE GUARD/);
  });

  it('assertCatalogUnlocked should SUCCEED when catalog is locked if adminContext is ADMIN', async () => {
    vi.spyOn(redis, 'get').mockResolvedValue('true' as any);

    await expect(CatalogLockGuard.assertCatalogUnlocked('ADMIN_CATEGORY_UPDATE', {
      id: 'admin_1',
      email: 'admin@smmplan.pro',
      role: 'ADMIN'
    })).resolves.not.toThrow();
  });

  it('assertCatalogUnlocked should SUCCEED when catalog is locked if adminContext is OWNER', async () => {
    vi.spyOn(redis, 'get').mockResolvedValue('true' as any);

    await expect(CatalogLockGuard.assertCatalogUnlocked('OWNER_CATEGORY_DELETE', {
      id: 'owner_1',
      email: 'owner@smmplan.pro',
      role: 'OWNER'
    })).resolves.not.toThrow();
  });

  it('assertCatalogUnlocked should SUCCEED when catalog is locked if staffRole has CATALOG edit permission', async () => {
    vi.spyOn(redis, 'get').mockResolvedValue('true' as any);

    await expect(CatalogLockGuard.assertCatalogUnlocked('STAFF_CATEGORY_EDIT', {
      id: 'staff_1',
      email: 'manager@smmplan.pro',
      role: 'MANAGER',
      staffRole: {
        permissions: [{ section: 'CATALOG', canEdit: true, canView: true }]
      }
    })).resolves.not.toThrow();
  });

  it('assertCatalogUnlocked should throw when catalog is locked if user is normal USER', async () => {
    vi.spyOn(redis, 'get').mockResolvedValue('true' as any);

    await expect(CatalogLockGuard.assertCatalogUnlocked('UNAUTHORIZED_ACTION', {
      id: 'user_1',
      email: 'client@example.com',
      role: 'USER'
    })).rejects.toThrow(/INVIOLABLE DATABASE GUARD/);
  });

  it('canAdminManage correctly identifies authorized managers', () => {
    expect(CatalogLockGuard.canAdminManage({ role: 'ADMIN' })).toBe(true);
    expect(CatalogLockGuard.canAdminManage({ role: 'OWNER' })).toBe(true);
    expect(CatalogLockGuard.canAdminManage({
      role: 'SUPPORT',
      staffRole: { permissions: [{ section: 'CATALOG', canEdit: true }] }
    })).toBe(true);
    expect(CatalogLockGuard.canAdminManage({
      role: 'SUPPORT',
      staffRole: { permissions: [{ section: 'CATALOG', canEdit: false }] }
    })).toBe(false);
    expect(CatalogLockGuard.canAdminManage({ role: 'USER' })).toBe(false);
    expect(CatalogLockGuard.canAdminManage(null)).toBe(false);
  });

  it('assertCatalogUnlocked should succeed when catalog is unlocked', async () => {
    vi.spyOn(redis, 'get').mockResolvedValue('false' as any);

    await expect(CatalogLockGuard.assertCatalogUnlocked('TEST_SAFE_OPERATION'))
      .resolves
      .not.toThrow();
  });

  it('unlockCatalog should require a valid reason', async () => {
    await expect(CatalogLockGuard.unlockCatalog('admin@test.com', ''))
      .rejects
      .toThrow(/A detailed reason/);
  });
});
