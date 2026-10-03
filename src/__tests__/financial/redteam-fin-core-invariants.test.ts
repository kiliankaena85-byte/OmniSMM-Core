/**
 * SPEC-REDTEAM-FIN-CORE-2026 — WalletOps idempotency binding & escrow guards.
 * Pure unit tests with an in-memory transaction client (no DB).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ db: {} }));
vi.mock('@/lib/transactions', () => ({ runSerializableTransaction: vi.fn() }));

import {
  WalletOps,
  IdempotencyKeyReuseError,
  WalletInsufficientFundsError,
  WalletInvalidAmountError,
  ELEVATED_ADJUSTMENT_CAP_KOPECKS,
  QUARANTINE_HARD_CEILING_KOPECKS,
} from '@/services/financial/wallet-ops';

interface FakeUser { id: string; tenantId: string; balance: bigint; totalSpent: bigint; quarantineBalance: bigint; referralBalance?: bigint }
interface FakeLedger { id: string; userId: string; tenantId: string; amount: bigint; idempotencyKey?: string | null; status: string }

type Where = Record<string, unknown>;

function matchesUser(u: FakeUser, where: Where): boolean {
  if (where.id !== undefined && where.id !== u.id) return false;
  if (where.tenantId !== undefined && where.tenantId !== u.tenantId) return false;
  for (const field of ['balance', 'quarantineBalance', 'referralBalance'] as const) {
    const cond = where[field] as { gte?: bigint } | undefined;
    if (cond?.gte !== undefined && (u[field] ?? BigInt(0)) < cond.gte) return false;
  }
  return true;
}

function applyUserData(u: FakeUser, data: Record<string, { increment?: bigint; decrement?: bigint }>) {
  for (const [k, op] of Object.entries(data)) {
    const key = k as keyof FakeUser;
    const cur = u[key] as bigint;
    if (op.increment !== undefined) (u[key] as bigint) = cur + op.increment;
    if (op.decrement !== undefined) (u[key] as bigint) = cur - op.decrement;
  }
}

function makeTx(users: FakeUser[], ledger: FakeLedger[]) {
  let seq = 0;
  return {
    user: {
      findUnique: async ({ where }: { where: Where }) => users.find(u => matchesUser(u, where)) ?? null,
      findUniqueOrThrow: async ({ where }: { where: Where }) => {
        const u = users.find(x => matchesUser(x, where));
        if (!u) throw new Error('not found');
        return u;
      },
      updateMany: async ({ where, data }: { where: Where; data: Record<string, { increment?: bigint; decrement?: bigint }> }) => {
        const hit = users.filter(u => matchesUser(u, where));
        hit.forEach(u => applyUserData(u, data));
        return { count: hit.length };
      },
      update: async ({ where, data }: { where: Where; data: Record<string, { increment?: bigint; decrement?: bigint }> }) => {
        const u = users.find(x => matchesUser(x, where));
        if (!u) throw new Error('not found');
        applyUserData(u, data);
        return u;
      },
    },
    ledgerEntry: {
      findFirst: async ({ where }: { where: Where }) =>
        ledger.find(l => l.idempotencyKey === where.idempotencyKey && l.tenantId === where.tenantId) ?? null,
      create: async ({ data }: { data: Omit<FakeLedger, 'id'> }) => {
        if (data.idempotencyKey && ledger.some(l => l.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
        }
        const row = { ...data, id: `le_${++seq}` };
        ledger.push(row);
        return row;
      },
    },
  } as unknown as Parameters<typeof WalletOps.charge>[0];
}

describe('SPEC-REDTEAM-FIN-CORE-2026 · WalletOps idempotency binding', () => {
  let users: FakeUser[];
  let ledger: FakeLedger[];

  beforeEach(() => {
    users = [
      { id: 'u_a', tenantId: 'smmplan', balance: BigInt(1000), totalSpent: BigInt(0), quarantineBalance: BigInt(0) },
      { id: 'u_b', tenantId: 'smmplan', balance: BigInt(1000), totalSpent: BigInt(0), quarantineBalance: BigInt(0) },
    ];
    ledger = [];
  });

  it('INV-IDEM-02: charge replay by another user with the same key is rejected and does not move money', async () => {
    const tx = makeTx(users, ledger);
    await WalletOps.charge(tx, 'u_a', 500, 'order', { idempotencyKey: 'order-charge:o1', tenantId: 'smmplan' });

    await expect(
      WalletOps.charge(tx, 'u_b', 500, 'order', { idempotencyKey: 'order-charge:o1', tenantId: 'smmplan' })
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
    expect(users[1].balance).toBe(BigInt(1000));
  });

  it('INV-IDEM-02: charge replay with a different amount is rejected', async () => {
    const tx = makeTx(users, ledger);
    await WalletOps.charge(tx, 'u_a', 100, 'order', { idempotencyKey: 'k-amount', tenantId: 'smmplan' });
    await expect(
      WalletOps.charge(tx, 'u_a', 900, 'order', { idempotencyKey: 'k-amount', tenantId: 'smmplan' })
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
    expect(users[0].balance).toBe(BigInt(900));
  });

  it('INV-IDEM-03: legitimate replay after balance was spent returns cached instead of INSUFFICIENT_FUNDS', async () => {
    const tx = makeTx(users, ledger);
    await WalletOps.charge(tx, 'u_a', 800, 'order', { idempotencyKey: 'k-replay', tenantId: 'smmplan' });
    const res = await WalletOps.charge(tx, 'u_a', 800, 'order', { idempotencyKey: 'k-replay', tenantId: 'smmplan' });
    expect(res.cached).toBe(true);
    expect(users[0].balance).toBe(BigInt(200));
  });

  it('INV-IDEM-02: credit replay for another user is rejected (deposit swallowing)', async () => {
    const tx = makeTx(users, ledger);
    await WalletOps.credit(tx, 'u_a', 100, 'topup', { idempotencyKey: 'deposit:p1', tenantId: 'smmplan' });
    await expect(
      WalletOps.credit(tx, 'u_b', 100, 'topup', { idempotencyKey: 'deposit:p1', tenantId: 'smmplan' })
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
    expect(users[1].balance).toBe(BigInt(1000));
  });

  it('INV-IDEM-02: credit replay with drifted amount (FX retry) is cached and never moves money twice', async () => {
    const tx = makeTx(users, ledger);
    await WalletOps.credit(tx, 'u_a', 100, 'topup', { idempotencyKey: 'deposit:p2', tenantId: 'smmplan' });
    const res = await WalletOps.credit(tx, 'u_a', 100000, 'topup', { idempotencyKey: 'deposit:p2', tenantId: 'smmplan' });
    expect(res.cached).toBe(true);
    expect(users[0].balance).toBe(BigInt(1100));
  });

  it('INV-IDEM-02: refund replay to another user is rejected', async () => {
    const tx = makeTx(users, ledger);
    await WalletOps.refund(tx, 'u_a', 100, 'refund', { idempotencyKey: 'refund:o1:full', tenantId: 'smmplan' });
    await expect(
      WalletOps.refund(tx, 'u_b', 100, 'refund', { idempotencyKey: 'refund:o1:full', tenantId: 'smmplan' })
    ).rejects.toBeInstanceOf(IdempotencyKeyReuseError);
    expect(users[1].balance).toBe(BigInt(1000));
  });
});

describe('SPEC-REDTEAM-FIN-CORE-2026 · Escrow quarantine guards', () => {
  let users: FakeUser[];

  beforeEach(() => {
    users = [{ id: 'u_a', tenantId: 'smmplan', balance: BigInt(1000), totalSpent: BigInt(0), quarantineBalance: BigInt(0) }];
  });

  it('INV-ESC-01: negative quarantineApprove cannot drive balance below zero', async () => {
    const tx = makeTx(users, []);
    await expect(
      WalletOps.quarantineApprove(tx, 'u_a', BigInt(-5000), { tenantId: 'smmplan' })
    ).rejects.toBeInstanceOf(WalletInsufficientFundsError);
    expect(users[0].balance).toBe(BigInt(1000));
  });

  it('INV-ESC-01: negative quarantineApprove within balance is applied', async () => {
    const tx = makeTx(users, []);
    const res = await WalletOps.quarantineApprove(tx, 'u_a', BigInt(-400), { tenantId: 'smmplan' });
    expect(res.balance).toBe(BigInt(600));
  });

  it('INV-ESC-01: zero quarantineApprove is rejected', async () => {
    const tx = makeTx(users, []);
    await expect(WalletOps.quarantineApprove(tx, 'u_a', 0)).rejects.toBeInstanceOf(WalletInvalidAmountError);
  });

  it('INV-ESC-02: quarantineAdd rejects zero and amounts above the quarantine hard ceiling', async () => {
    const tx = makeTx(users, []);
    await expect(WalletOps.quarantineAdd(tx, 'u_a', 0, 'x')).rejects.toBeInstanceOf(WalletInvalidAmountError);
    await expect(
      WalletOps.quarantineAdd(tx, 'u_a', QUARANTINE_HARD_CEILING_KOPECKS + BigInt(1), 'x')
    ).rejects.toBeInstanceOf(WalletInvalidAmountError);
    expect(users[0].quarantineBalance).toBe(BigInt(0));
  });

  it('INV-ESC-02: OWNER anomaly range (> elevated cap) is accepted into quarantine, not rejected', async () => {
    const ledger: FakeLedger[] = [];
    const tx = makeTx(users, ledger);
    const anomaly = ELEVATED_ADJUSTMENT_CAP_KOPECKS + BigInt(1);
    await WalletOps.quarantineAdd(tx, 'u_a', anomaly, 'owner anomaly', { tenantId: 'smmplan' });
    expect(users[0].quarantineBalance).toBe(anomaly);
    expect(users[0].balance).toBe(BigInt(1000));
    expect(ledger[0]?.status).toBe('QUARANTINE');
  });
});

describe('SPEC-REDTEAM-FIN-CORE-2026 · INV-REF-01/02 referralDebit', () => {
  let users: FakeUser[];
  let ledger: FakeLedger[];

  beforeEach(() => {
    users = [{ id: 'u_r', tenantId: 'smmplan', balance: BigInt(0), totalSpent: BigInt(0), quarantineBalance: BigInt(0), referralBalance: BigInt(0) }];
    ledger = [];
  });

  it('INV-REF-01: clawback (allowDebt) with empty balances records referral DEBT equal to the ledger amount; main balance untouched', async () => {
    users[0].balance = BigInt(700);
    const tx = makeTx(users, ledger);
    await WalletOps.referralDebit(tx, 'u_r', 500, 'reversal', { idempotencyKey: 'ref_reversal_c1', tenantId: 'smmplan', allowDebt: true });

    expect(users[0].referralBalance).toBe(BigInt(-500));
    expect(users[0].balance).toBe(BigInt(700));
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(BigInt(-500));
  });

  it('INV-REF-01: clawback with partial referral balance leaves exact debt', async () => {
    users[0].referralBalance = BigInt(200);
    const tx = makeTx(users, ledger);
    await WalletOps.referralDebit(tx, 'u_r', 500, 'reversal', { idempotencyKey: 'ref_reversal_c2', tenantId: 'smmplan', allowDebt: true });
    expect(users[0].referralBalance).toBe(BigInt(-300));
  });

  it('INV-REF-02: withdrawal (default) never creates debt and writes no ledger row when funds are insufficient', async () => {
    users[0].referralBalance = BigInt(100);
    const tx = makeTx(users, ledger);
    await expect(
      WalletOps.referralDebit(tx, 'u_r', 500, 'payout', { idempotencyKey: 'referral-debit-x', tenantId: 'smmplan' })
    ).rejects.toBeInstanceOf(WalletInsufficientFundsError);
    expect(users[0].referralBalance).toBe(BigInt(100));
    expect(ledger).toHaveLength(0);
  });

  it('INV-REF-02: withdrawal within balance debits exactly', async () => {
    users[0].referralBalance = BigInt(500);
    const tx = makeTx(users, ledger);
    await WalletOps.referralDebit(tx, 'u_r', 500, 'payout', { idempotencyKey: 'referral-debit-y', tenantId: 'smmplan' });
    expect(users[0].referralBalance).toBe(BigInt(0));
    expect(ledger[0].amount).toBe(BigInt(-500));
  });
});
