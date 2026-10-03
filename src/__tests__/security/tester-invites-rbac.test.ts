import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireStaffPermission, generateInvites, listInvites, revokeInvite, userFindFirst, userUpdate, auditAdminAwaitable } = vi.hoisted(() => ({
  requireStaffPermission: vi.fn(),
  generateInvites: vi.fn(),
  listInvites: vi.fn(),
  revokeInvite: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  auditAdminAwaitable: vi.fn(),
}));

vi.mock('@/lib/server/rbac', () => ({ requireStaffPermission }));
vi.mock('@/lib/db', () => ({ db: { user: { findFirst: userFindFirst, update: userUpdate } } }));
vi.mock('@/lib/admin-audit', () => ({ auditAdminAwaitable }));
vi.mock('@/services/security/tester-invites.service', () => ({
  TesterInvitesService: { generateInvites, listInvites, revokeInvite },
}));
vi.mock('@/utils/get-base-url', () => ({ getBaseUrlAsync: vi.fn().mockResolvedValue('https://smmplan.test') }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  generateTesterInvitesAction,
  listTesterInvitesAction,
  revokeTesterInviteAction,
  toggleUserTesterStatusAction,
} from '@/actions/admin/tester-invites';

const DENIED = { success: false as const, error: 'Forbidden: Cannot modify [clients]' };
const ADMIN = { id: 'admin-1', email: 'admin@smmplan.test', tenantId: 'smmplan' };

function allowAs(tenantId: string) {
  requireStaffPermission.mockImplementation(
    async (_section: string, _mode: string, cb: (u: typeof ADMIN, r: null, t: string) => Promise<unknown>) =>
      cb(ADMIN, null, tenantId)
  );
}

function expectNoSideEffects() {
  expect(generateInvites).not.toHaveBeenCalled();
  expect(listInvites).not.toHaveBeenCalled();
  expect(revokeInvite).not.toHaveBeenCalled();
  expect(userFindFirst).not.toHaveBeenCalled();
  expect(userUpdate).not.toHaveBeenCalled();
  expect(auditAdminAwaitable).not.toHaveBeenCalled();
}

describe('SPEC-TYPEFIX-TESTER-INVITES-AUTH-2026 · RBAC on tester-invite Server Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('INV-RBAC-01/02: denied RBAC → every action returns success:false with zero side effects', async () => {
    requireStaffPermission.mockResolvedValue(DENIED);

    const results = await Promise.all([
      generateTesterInvitesAction({ count: 5 }),
      listTesterInvitesAction({ page: 1 }),
      revokeTesterInviteAction('inv-1'),
      toggleUserTesterStatusAction('victim-user', true),
    ]);

    for (const res of results) {
      expect(res.success).toBe(false);
    }
    expectNoSideEffects();
  });

  it('INV-RBAC-01: every action goes through requireStaffPermission with a callback', async () => {
    requireStaffPermission.mockResolvedValue(DENIED);
    await generateTesterInvitesAction();
    await listTesterInvitesAction();
    await revokeTesterInviteAction('inv-1');
    await toggleUserTesterStatusAction('u1', true);

    expect(requireStaffPermission).toHaveBeenCalledTimes(4);
    for (const call of requireStaffPermission.mock.calls) {
      expect(typeof call[2]).toBe('function');
    }
  });

  it('INV-RBAC-03/04: allowed staff → actor and tenant come from the callback, audit has targetType', async () => {
    allowAs('smmplan');
    generateInvites.mockResolvedValue({ count: 2, invites: [{ code: 'abc' }, { code: 'def' }] });

    const res = await generateTesterInvitesAction({ count: 2, note: 'beta' });

    expect(res.success).toBe(true);
    expect(generateInvites).toHaveBeenCalledWith('smmplan', 2, 'admin-1', 'beta');
    expect(auditAdminAwaitable).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'admin-1',
        adminEmail: 'admin@smmplan.test',
        action: 'GENERATE_TESTER_INVITES',
        targetType: expect.any(String),
      })
    );
  });

  it('INV-RBAC-05: toggling isTester for a user of ANOTHER tenant is refused', async () => {
    allowAs('smmplan');
    userFindFirst.mockResolvedValue(null); // нет такого пользователя в активном tenant

    const res = await toggleUserTesterStatusAction('user-from-smmflux', true);

    expect(res.success).toBe(false);
    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'user-from-smmflux', tenantId: 'smmplan' }) })
    );
    expect(userUpdate).not.toHaveBeenCalled();
    expect(auditAdminAwaitable).not.toHaveBeenCalled();
  });

  it('INV-RBAC-05: toggling isTester for a same-tenant user succeeds and is audited', async () => {
    allowAs('smmplan');
    userFindFirst.mockResolvedValue({ id: 'u1', email: 'u1@x.test' });
    userUpdate.mockResolvedValue({ id: 'u1', email: 'u1@x.test', isTester: true });

    const res = await toggleUserTesterStatusAction('u1', true);

    expect(res.success).toBe(true);
    expect(userUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'u1' }, data: { isTester: true } }));
    expect(auditAdminAwaitable).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TOGGLE_USER_TESTER_STATUS', targetType: expect.any(String) })
    );
  });
});
