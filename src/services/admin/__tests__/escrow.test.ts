import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { EscrowService } from '../escrow.service';

describe('EscrowService manual credit limits for OWNER and ADMIN', () => {
  let escrowService: EscrowService;
  let testUser: any;

  beforeEach(async () => {
    escrowService = new EscrowService();

    // Create unique test user
    testUser = await db.user.create({
      data: {
        email: `test-escrow-${Date.now()}@smmplan.test`,
        passwordHash: 'dummy-hash',
        balance: BigInt(0),
        quarantineBalance: BigInt(0),
      },
    });
  });

  it('should auto-approve balance adjustment below 100k RUB for OWNER', async () => {
    const admin = {
      id: 'admin-owner-id',
      email: 'owner@smmplan.test',
      role: 'OWNER',
      supportLimitCents: 1000000,
    };

    const amount = 5000000; // 50,000 RUB in cents
    const result = await escrowService.evaluateBalanceAdjustment(
      testUser.id,
      amount,
      'Test adjustment below limit',
      admin
    );

    expect(result.status).toBe('APPROVED');

    // Verify main balance is updated, quarantine balance remains 0
    const updatedUser = await db.user.findUnique({ where: { id: testUser.id } });
    expect(Number(updatedUser!.balance)).toBe(5000000);
    expect(Number(updatedUser!.quarantineBalance)).toBe(0);
  });

  // Policy (escrow.service.ts): anomaly threshold is 100k RUB for ADMIN, 10M RUB for OWNER
  it('should redirect balance adjustment above 100k RUB to QUARANTINE for ADMIN', async () => {
    const admin = {
      id: 'admin-admin-id',
      email: 'admin@smmplan.test',
      role: 'ADMIN',
      supportLimitCents: 1000000,
    };

    const amount = 15000000; // 150,000 RUB in cents (above 100k limit)
    const result = await escrowService.evaluateBalanceAdjustment(
      testUser.id,
      amount,
      'Test adjustment above limit',
      admin
    );

    expect(result.status).toBe('QUARANTINE');

    // Verify main balance remains 0, quarantine balance is updated
    const updatedUser = await db.user.findUnique({ where: { id: testUser.id } });
    expect(Number(updatedUser!.balance)).toBe(0);
    expect(Number(updatedUser!.quarantineBalance)).toBe(15000000);

    // Verify ledger entry is created with QUARANTINE status
    const ledger = await db.ledgerEntry.findFirst({
      where: { userId: testUser.id },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.status).toBe('QUARANTINE');
    expect(Number(ledger!.amount)).toBe(15000000);
  });
});
