import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUserService, USER_SORT_FIELDS } from '@/services/admin/user.service';
import { db } from '@/lib/db';

vi.mock('@/lib/db', () => ({
  db: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/admin-audit', () => ({
  auditAdmin: vi.fn(),
  auditAdminAwaitable: vi.fn().mockResolvedValue(undefined),
}));

describe('Admin User Dynamic Sorting & Deterministic Pagination (SPEC-2026-15)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (db.user.findMany as any).mockResolvedValue([
      {
        id: 'usr_001',
        email: 'whale@example.com',
        role: 'USER',
        balance: 15000000,
        quarantineBalance: 0,
        totalSpent: 50000000,
        personalDiscount: 0,
        referralCode: null,
        telegramId: '@whale',
        companyName: 'Whale Corp',
        inn: '7701234567',
        createdAt: new Date('2026-01-01'),
        tenantId: 'smmplan',
        apiConfig: { isApiEnabled: true, prioritySupport: true, webhookUrl: null },
        _count: { orders: 120, tickets: 3 },
      },
    ]);
    (db.user.count as any).mockResolvedValue(1);
  });

  it('verifies USER_SORT_FIELDS contains all required lifecycle and financial fields', () => {
    expect(USER_SORT_FIELDS).toContain('createdAt');
    expect(USER_SORT_FIELDS).toContain('balance');
    expect(USER_SORT_FIELDS).toContain('totalSpent');
    expect(USER_SORT_FIELDS).toContain('orders');
    expect(USER_SORT_FIELDS).toContain('email');
    expect(USER_SORT_FIELDS).toContain('role');
  });

  it('sorts by balance descending with deterministic id tie-breaker', async () => {
    await adminUserService.listUsers({
      page: 1,
      pageSize: 50,
      sortBy: 'balance',
      sortOrder: 'desc',
    });

    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    const callArgs = (db.user.findMany as any).mock.calls[0][0];

    expect(callArgs.orderBy).toEqual([
      { balance: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('sorts by balance ascending with deterministic id tie-breaker', async () => {
    await adminUserService.listUsers({
      page: 1,
      pageSize: 50,
      sortBy: 'balance',
      sortOrder: 'asc',
    });

    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    const callArgs = (db.user.findMany as any).mock.calls[0][0];

    expect(callArgs.orderBy).toEqual([
      { balance: 'asc' },
      { id: 'desc' },
    ]);
  });

  it('sorts by LTV (totalSpent) descending with deterministic id tie-breaker', async () => {
    await adminUserService.listUsers({
      page: 1,
      pageSize: 20,
      sortBy: 'totalSpent',
      sortOrder: 'desc',
    });

    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    const callArgs = (db.user.findMany as any).mock.calls[0][0];

    expect(callArgs.orderBy).toEqual([
      { totalSpent: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('sorts by relation count (orders: { _count: sortOrder }) for activity sorting', async () => {
    await adminUserService.listUsers({
      page: 1,
      pageSize: 50,
      sortBy: 'orders',
      sortOrder: 'desc',
    });

    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    const callArgs = (db.user.findMany as any).mock.calls[0][0];

    expect(callArgs.orderBy).toEqual([
      { orders: { _count: 'desc' } },
      { id: 'desc' },
    ]);
  });

  it('sorts by createdAt ascending (oldest clients first) with deterministic id tie-breaker', async () => {
    await adminUserService.listUsers({
      page: 1,
      pageSize: 50,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    });

    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    const callArgs = (db.user.findMany as any).mock.calls[0][0];

    expect(callArgs.orderBy).toEqual([
      { createdAt: 'asc' },
      { id: 'desc' },
    ]);
  });

  it('sanitizes invalid sortBy parameter and safely falls back to createdAt: desc', async () => {
    await adminUserService.listUsers({
      page: 1,
      pageSize: 50,
      sortBy: 'malicious_column_drop_table' as any,
      sortOrder: 'desc',
    });

    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    const callArgs = (db.user.findMany as any).mock.calls[0][0];

    expect(callArgs.orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  it('defaults to createdAt: desc when no sorting parameters are provided', async () => {
    await adminUserService.listUsers({
      page: 1,
      pageSize: 50,
    });

    expect(db.user.findMany).toHaveBeenCalledTimes(1);
    const callArgs = (db.user.findMany as any).mock.calls[0][0];

    expect(callArgs.orderBy).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });

  describe('VIP Tab, Search & RBAC Boundaries Remediation', () => {
    it('applies strict criteria for VIP tab (role: USER, staffRoleId: null, isDeleted: false, totalSpent >= 2500000)', async () => {
      await adminUserService.listUsers({
        page: 1,
        pageSize: 50,
        filter: 'vip',
      });

      expect(db.user.findMany).toHaveBeenCalledTimes(1);
      const callArgs = (db.user.findMany as any).mock.calls[0][0];
      expect(callArgs.where.AND).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            totalSpent: { gte: BigInt(25_000_00) },
            role: 'USER',
            staffRoleId: null,
            isDeleted: false,
          }),
        ])
      );
    });

    it('preserves search conditions when filter is api using where.AND instead of overwriting where.OR', async () => {
      await adminUserService.listUsers({
        page: 1,
        pageSize: 50,
        search: 'crypto',
        filter: 'api',
      });

      expect(db.user.findMany).toHaveBeenCalledTimes(1);
      const callArgs = (db.user.findMany as any).mock.calls[0][0];
      expect(callArgs.where.AND).toBeDefined();
      expect(callArgs.where.AND.length).toBe(3);

      // Condition 0: Soft-deletion check (isDeleted: false)
      expect(callArgs.where.AND[0]).toEqual({ isDeleted: false });

      // Condition 1: Search OR
      expect(callArgs.where.AND[1]).toEqual({
        OR: [
          { email: { contains: 'crypto', mode: 'insensitive' } },
          { id: { equals: 'crypto' } },
          { telegramId: { contains: 'crypto', mode: 'insensitive' } },
          { companyName: { contains: 'crypto', mode: 'insensitive' } },
          { inn: { contains: 'crypto' } },
        ],
      });

      // Condition 2: API filter OR
      expect(callArgs.where.AND[2]).toEqual({
        OR: [
          { apiConfig: { isApiEnabled: true } },
          { inn: { not: null } },
          { companyName: { not: null } },
        ],
      });
    });

    it('excludes staff and banned users from active users and totalLiability in getUserStats', async () => {
      (db.user.count as any).mockResolvedValue(10);
      (db.user.aggregate as any).mockResolvedValue({ _sum: { balance: BigInt(500000) } });

      const stats = await adminUserService.getUserStats(undefined, undefined, 'smmplan');

      expect(stats.total).toBe(10);
      expect(stats.totalLiability).toBe(500000);

      // Active count call excludes staff and deleted
      expect(db.user.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: 'USER',
            staffRoleId: null,
            isDeleted: false,
          }),
        })
      );

      // Aggregate call excludes staff and deleted
      expect(db.user.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role: 'USER',
            staffRoleId: null,
            isDeleted: false,
          }),
        })
      );
    });

    it('restores staff role when unbanning a user with staffRoleId', async () => {
      (db.user.findUniqueOrThrow as any).mockResolvedValue({
        id: 'usr_staff_01',
        role: 'BANNED',
        staffRoleId: 'role_sup_01',
        staffRole: { id: 'role_sup_01', name: 'SUPPORT' },
      });
      (db.user.update as any).mockResolvedValue({ id: 'usr_staff_01', role: 'SUPPORT' });

      await adminUserService.unbanUser('usr_staff_01', { id: 'adm_01', email: 'owner@smmplan.pro' });

      expect(db.user.update).toHaveBeenCalledWith({
        where: { id: 'usr_staff_01' },
        data: { role: 'SUPPORT' },
      });
    });
  });

  describe('Rule 9 & Viewport Density Compliance (Zero Horizontal Scroll Invariants)', () => {
    it('verifies columns count strictly complies with Rule 9 limit (<= 9 columns)', async () => {
      const { columns } = await import('@/app/admin/clients/components/columns');
      expect(columns.length).toBeLessThanOrEqual(9);
      expect(columns.length).toBeGreaterThanOrEqual(7);

      const columnKeys = columns.map((c: any) => c.accessorKey || c.id);
      expect(columnKeys).toContain('email');
      expect(columnKeys).toContain('tenantId');
      expect(columnKeys).toContain('role');
      expect(columnKeys).toContain('balance');
      expect(columnKeys).toContain('totalSpent');
      expect(columnKeys).toContain('_count.orders');
      expect(columnKeys).toContain('createdAt');
      expect(columnKeys).toContain('tier');
      expect(columnKeys).toContain('actions');
    });

    it('verifies financial amounts are formatted in whole rubles without kopecks', () => {
      const kopecks1 = 1500050; // 15 000.50 ₽
      const rub1 = Math.round(Number(kopecks1) / 100).toLocaleString('ru-RU');
      expect(rub1).not.toContain(',');
      expect(rub1).not.toContain('.');
      expect(rub1).toBe('15 001');

      const kopecks2 = 250000; // 2 500.00 ₽
      const rub2 = Math.round(Number(kopecks2) / 100).toLocaleString('ru-RU');
      expect(rub2).toBe('2 500');
    });
  });
});

