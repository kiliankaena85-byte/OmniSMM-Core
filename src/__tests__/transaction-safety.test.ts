import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { requireStaffPermission } from '@/lib/server/rbac';
import { runSerializableTransaction } from '@/lib/transactions';

// Mocking session to simulate an ADMIN user for requireStaffPermission
vi.mock('@/lib/session', () => ({
  verifySession: vi.fn().mockResolvedValue({ userId: 'admin-mock-id' }),
  getSessionUserId: vi.fn().mockResolvedValue('admin-mock-id')
}));

// We need to bypass tenant checks for testing internal functions easily
vi.mock('@/lib/tenant-context', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    runWithTenantBypass: vi.fn((reason, cb) => cb()),
  };
});

describe('ACID Transaction & Server Action Safety Proof', () => {
  let mockUserId: string;

  beforeEach(async () => {
    // 1. Create a dummy admin user so requireStaffPermission passes the role check
    await db.user.upsert({
      where: { id: 'admin-mock-id' },
      update: { role: 'ADMIN' },
      create: {
        id: 'admin-mock-id',
        email: 'admin-proof@smmplan.pro',
        role: 'ADMIN',
        tenantId: 'smmplan',
      }
    });

    // 2. Create a test user with 1000 kopecks (10 RUB) balance
    const user = await db.user.create({
      data: {
        email: `test-victim-${Date.now()}@test.com`,
        balance: BigInt(1000),
        tenantId: 'smmplan'
      }
    });
    mockUserId = user.id;
  });

  it('PROVES: throw new Error inside runSerializableTransaction rolls back DB and returns {success: false}', async () => {
    // Initial balance check
    const beforeUser = await db.user.findUniqueOrThrow({ where: { id: mockUserId } });
    expect(beforeUser.balance).toBe(BigInt(1000));

    // Simulate a Server Action call
    const actionResult = await requireStaffPermission('orders', 'edit', async () => {
      
      // A transaction that fails halfway
      await runSerializableTransaction(async (tx) => {
        // Step 1: Mutate the database (Deduct 500 kopecks)
        await tx.user.update({
          where: { id: mockUserId },
          data: { balance: { decrement: BigInt(500) } }
        });

        // Step 2: Oh no! A business rule violation occurred!
        // This is exactly what the linter complained about.
        throw new Error("Бизнес-логика: Нельзя списать средства");
      });

      return { success: true, data: "ok" };
    });

    // ASSERTION 1: Server Action didn't crash, it returned the safe typed error
    expect(actionResult).toEqual({
      success: false,
      error: "Бизнес-логика: Нельзя списать средства"
    });

    // ASSERTION 2: Database transaction ROLLED BACK successfully. 
    // The balance must still be 1000, not 500!
    const afterUser = await db.user.findUniqueOrThrow({ where: { id: mockUserId } });
    expect(afterUser.balance).toBe(BigInt(1000)); // DB state preserved!
  });
});
