import 'server-only';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { runSerializableTransaction } from '@/lib/transactions';
import { ExactMath } from '@/lib/financial/exact-math';
import type { LedgerTransactionType } from '@/lib/financial/ledger-types';

export { ExactMath };

type PrismaTx = Omit<Prisma.TransactionClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export class WalletInsufficientFundsError extends Error {
  readonly code = 'INSUFFICIENT_FUNDS';
  constructor(needed: number | bigint, got: number | bigint) {
    super(`Insufficient funds: needed ${needed.toString()}, got ${got.toString()}`);
    this.name = 'WalletInsufficientFundsError';
  }
}

export class WalletUserNotFoundError extends Error {
  readonly code = 'USER_NOT_FOUND';
  constructor(userId: string) {
    super(`User ${userId} not found or tenant access forbidden.`);
    this.name = 'WalletUserNotFoundError';
  }
}

export class WalletInvalidAmountError extends Error {
  readonly code = 'INVALID_AMOUNT';
  constructor(action: 'Charge' | 'Credit' | 'Adjustment' | 'Refund' | 'Debit') {
    super(`${action} amount must be a strictly positive finite number.`);
    this.name = 'WalletInvalidAmountError';
  }
}

export class ImmutableLedgerError extends Error {
  readonly code = 'IMMUTABLE_LEDGER_VIOLATION';
  constructor(message = 'Financial Ledger is immutable. Modifying or deleting ledger records is strictly forbidden.') {
    super(message);
    this.name = 'ImmutableLedgerError';
  }
}

export class IdempotencyKeyReuseError extends Error {
  readonly code = 'IDEMPOTENCY_KEY_REUSE';
  constructor(key: string) {
    super(`Idempotency key reused with a different payload: ${key}`);
    this.name = 'IdempotencyKeyReuseError';
  }
}

/**
 * SPEC-REDTEAM-FIN-CORE-2026 / INV-IDEM-02:
 * An idempotency hit is only a valid replay when it is the SAME operation
 * (same user, same signed amount). Otherwise a foreign/forged key would be
 * reported as "success" without moving money.
 */
function assertSameIdempotentPayload(
  existing: { userId: string; amount: bigint },
  userId: string,
  signedAmount: bigint,
  key: string
): void {
  if (existing.userId !== userId || existing.amount !== signedAmount) {
    throw new IdempotencyKeyReuseError(key);
  }
}

/**
 * Inbound-money variant (credit/refund): a replay never moves money, so an amount
 * drift (e.g. FX re-computation on a webhook retry) is logged, not rejected —
 * rejecting would turn gateway retries into an infinite 500 loop. A different
 * OWNER is never legitimate (it would silently "swallow" another user's deposit).
 */
function assertSameIdempotentOwner(
  existing: { userId: string; amount: bigint },
  userId: string,
  signedAmount: bigint,
  key: string
): void {
  if (existing.userId !== userId) {
    throw new IdempotencyKeyReuseError(key);
  }
  if (existing.amount !== signedAmount) {
    console.warn(`[WalletOps] Idempotent replay amount drift for key ${key}: ledger=${existing.amount} requested=${signedAmount}`);
  }
}


export interface WalletOpsOptions {
  idempotencyKey?: string;
  adminId?: string;
  tenantId?: string;
  /** Явный тип транзакции. Если не задан — метод использует свой дефолт. */
  transactionType?: LedgerTransactionType;
  /** Разрешить повышенный лимит корректировки баланса (до 10 млн ₽ для OWNER) */
  allowElevatedCap?: boolean;
  /**
   * referralDebit only: clawback mode (commission reversal). The uncollectable remainder
   * becomes referral debt (negative referralBalance). Default false = strict withdrawal.
   */
  allowDebt?: boolean;
}

export const MAX_ADJUSTMENT_CAP_KOPECKS = BigInt(10_000_000); // 100,000.00 RUB safety cap
export const ELEVATED_ADJUSTMENT_CAP_KOPECKS = BigInt(1_000_000_000); // 10,000,000.00 RUB safety cap (Owner elevated)
// Quarantine is the escalation sink for anomalies ABOVE the elevated cap (EscrowService OWNER path),
// so its ceiling must be strictly higher; it only guards against absurd/overflow inputs.
export const QUARANTINE_HARD_CEILING_KOPECKS = BigInt(100_000_000_000); // 1,000,000,000.00 RUB

export const WalletOps = {
  /**
   * Safe charge mechanism without creating a new transaction.
   * Modifying balances using this guarantees no double-spending.
   * Strictly enforces Ledger-First Principle (LedgerEntry created BEFORE balance mutation).
   */
  async charge(
    tx: PrismaTx,
    userId: string,
    amountCents: number | bigint,
    reason: string,
    opts?: WalletOpsOptions
  ) {
    const rawCents = typeof amountCents === 'bigint' ? amountCents : BigInt(amountCents);
    const MAX_SINGLE_CHARGE_CENTS = BigInt(100_000_000); // 1M RUB safety cap
    if (rawCents <= BigInt(0) || rawCents > MAX_SINGLE_CHARGE_CENTS) {
      throw new WalletInvalidAmountError('Charge');
    }

    const { idempotencyKey, adminId, tenantId, transactionType: txTypeOverride } = opts || {};

    // 1. Validate User existence and tenant isolation
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, balance: true, tenantId: true }
    });

    if (!user) {
      throw new WalletUserNotFoundError(userId);
    }

    if (tenantId && user.tenantId !== tenantId) {
      throw new WalletUserNotFoundError(userId);
    }

    const resolvedTenantId = tenantId || user.tenantId || 'smmplan';

    // 2. Idempotency pre-check (INV-IDEM-03: BEFORE balance check, so a replay of an
    //    already-paid charge returns cached instead of INSUFFICIENT_FUNDS)
    if (idempotencyKey) {
      const existing = await tx.ledgerEntry.findFirst({
        where: { idempotencyKey, tenantId: resolvedTenantId },
      });
      
      if (existing) {
        assertSameIdempotentPayload(existing, userId, -rawCents, idempotencyKey);
        return { success: true, balance: user.balance, cached: true, entry: existing };
      }
    }

    if (user.balance < rawCents) {
      throw new WalletInsufficientFundsError(rawCents, user.balance);
    }

    // 3. LEDGER-FIRST INVARIANT: Create LedgerEntry FIRST before updating User.balance
    try {
      const entry = await tx.ledgerEntry.create({
        data: {
          userId,
          tenantId: resolvedTenantId,
          adminId,
          amount: -rawCents,
          reason,
          status: 'APPROVED',
          idempotencyKey,
          transactionType: txTypeOverride ?? 'ORDER_CHARGE',
        }
      });

      // 4. Atomically mutate balance with concurrency check
      const updatedUserBatch = await tx.user.updateMany({
        where: { 
          id: userId,
          balance: { gte: rawCents },
          ...(tenantId ? { tenantId } : {})
        },
        data: {
          balance: { decrement: rawCents },
          totalSpent: { increment: rawCents }
        }
      });

      if (updatedUserBatch.count === 0) {
        const checkUser = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, balance: true },
        });
        throw new WalletInsufficientFundsError(rawCents, checkUser?.balance ?? BigInt(0));
      }

      const finalUser = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { balance: true }
      });

      return { success: true, balance: finalUser.balance, cached: false, entry };
    } catch (error: unknown) {
      if (
        idempotencyKey &&
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        const existing = await tx.ledgerEntry.findFirst({
          where: { idempotencyKey, tenantId: resolvedTenantId },
        });
        if (existing) {
          assertSameIdempotentPayload(existing, userId, -rawCents, idempotencyKey);
          const userCurrent = await tx.user.findUnique({ where: { id: userId }, select: { balance: true } });
          return { success: true, balance: userCurrent?.balance ?? null, cached: true, entry: existing };
        }
      }
      throw error;
    }
  },

  /**
   * Refill user balance (e.g., from Yookassa top-up) without creating a new transaction.
   */
  async credit(
    tx: PrismaTx,
    userId: string,
    amountCents: number | bigint,
    reason: string,
    opts?: WalletOpsOptions
  ) {
    const rawCents = typeof amountCents === 'bigint' ? amountCents : BigInt(amountCents);
    const MAX_SINGLE_CREDIT_CENTS = BigInt(100_000_000); // 1M RUB safety cap
    if (rawCents <= BigInt(0) || rawCents > MAX_SINGLE_CREDIT_CENTS) {
      throw new WalletInvalidAmountError('Credit');
    }

    const { idempotencyKey, adminId, tenantId, transactionType: txTypeOverride } = opts || {};

    // Fetch user once for both tenant-check and tenantId fallback
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true }
    });

    if (tenantId) {
      if (!user || user.tenantId !== tenantId) {
        throw new WalletUserNotFoundError(userId);
      }
    } else if (!user) {
      throw new WalletUserNotFoundError(userId);
    }

    const resolvedTenantId = tenantId || user?.tenantId || 'smmplan';

    if (idempotencyKey) {
      const existing = await tx.ledgerEntry.findFirst({
        where: { idempotencyKey, tenantId: resolvedTenantId },
      });
      if (existing) {
        assertSameIdempotentOwner(existing, userId, rawCents, idempotencyKey);
        return { success: true, balance: null, cached: true, entry: existing };
      }
    }

    try {
      const entry = await tx.ledgerEntry.create({
        data: {
          userId,
          tenantId: resolvedTenantId,  // Bug #3 fixed: was tenantId || 'smmplan', missing user.tenantId fallback
          adminId,
          amount: rawCents,
          reason,
          status: 'APPROVED',
          idempotencyKey,
          transactionType: txTypeOverride ?? 'TOPUP',
        }
      });

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: rawCents } },
        select: { balance: true }
      });

      return { success: true, balance: updatedUser.balance, cached: false, entry };
    } catch (error: unknown) {
      if (
        idempotencyKey && 
        typeof error === 'object' && 
        error !== null && 
        'code' in error && 
        (error as { code: string }).code === 'P2002'
      ) {
        // Bug #1 fixed: use tx.* instead of db.* to stay within transaction isolation boundary
        const existing = await tx.ledgerEntry.findFirst({
          where: { idempotencyKey, tenantId: resolvedTenantId },
        });
        if (existing) {
          assertSameIdempotentOwner(existing, userId, rawCents, idempotencyKey);
          const updatedUser = await tx.user.findUnique({ where: { id: userId }, select: { balance: true } });
          return { success: true, balance: updatedUser?.balance ?? null, cached: true, entry: existing };
        }
      }
      throw error;
    }
  },

  /**
   * Universal adjustment for admin operations (can be positive or negative)
   * Does NOT affect totalSpent.
   */
  async adminAdjust(
    tx: PrismaTx,
    userId: string,
    amountCents: number | bigint,
    reason: string,
    opts?: WalletOpsOptions
  ) {
    const rawCents = typeof amountCents === 'bigint' ? amountCents : BigInt(amountCents);
    if (rawCents === BigInt(0)) {
      throw new WalletInvalidAmountError('Adjustment');
    }

    const { idempotencyKey, adminId, tenantId, transactionType: txTypeOverride, allowElevatedCap } = opts || {};
    const effectiveCap = allowElevatedCap ? ELEVATED_ADJUSTMENT_CAP_KOPECKS : MAX_ADJUSTMENT_CAP_KOPECKS;

    // Safety cap check: prevent unbounded negative/positive adjustments (P2-14)
    if (rawCents < -effectiveCap) {
      throw new Error(`🚨 [WALLET-OPS] Negative adjustment exceeds safety cap limit (-${effectiveCap / BigInt(100)} ₽)!`);
    }
    if (rawCents > effectiveCap) {
      throw new Error(`🚨 [WALLET-OPS] Positive adjustment exceeds safety cap limit (+${effectiveCap / BigInt(100)} ₽)!`);
    }

    // Fetch user tenantId for ledger entry (also validates user existence)
    const userRecord = await tx.user.findUnique({
      where: { id: userId },
      select: { tenantId: true }
    });
    if (!userRecord) throw new WalletUserNotFoundError(userId);

    if (tenantId && userRecord.tenantId !== tenantId) {
      throw new WalletUserNotFoundError(userId);
    }

    const resolvedTenantId = tenantId || userRecord.tenantId || 'smmplan';

    if (idempotencyKey) {
      const existing = await tx.ledgerEntry.findFirst({
        where: { idempotencyKey, tenantId: resolvedTenantId },
      });
      if (existing) {
        if (rawCents < BigInt(0)) {
          assertSameIdempotentPayload(existing, userId, rawCents, idempotencyKey);
        } else {
          assertSameIdempotentOwner(existing, userId, rawCents, idempotencyKey);
        }
        return { success: true, balance: null, cached: true, entry: existing };
      }
    }

    // Bug fixed: create ledger entry FIRST, then update balance
    // (matches immutable ledger pattern — if ledger.create fails, balance stays unchanged)
    const entry = await tx.ledgerEntry.create({
      data: {
        userId,
        tenantId: resolvedTenantId,
        adminId,
        amount: rawCents,
        reason,
        status: 'APPROVED',
        idempotencyKey,
        transactionType: txTypeOverride ?? 'ADJUSTMENT',
      }
    });

    // 4. Atomically mutate balance with non-negative guard for debit adjustments
    if (rawCents < BigInt(0)) {
      const absCents = -rawCents;
      const updatedUserBatch = await tx.user.updateMany({
        where: {
          id: userId,
          balance: { gte: absCents },
          ...(tenantId ? { tenantId } : {})
        },
        data: { balance: { increment: rawCents } }
      });

      if (updatedUserBatch.count === 0) {
        const checkUser = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, balance: true },
        });
        throw new WalletInsufficientFundsError(absCents, checkUser?.balance ?? BigInt(0));
      }
    } else {
      await tx.user.updateMany({
        where: {
          id: userId,
          ...(tenantId ? { tenantId } : {})
        },
        data: { balance: { increment: rawCents } }
      });
    }

    const updatedUser = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true }
    });

    return { success: true, balance: updatedUser.balance, cached: false, entry };
  },

  /**
   * Refund user balance: increments balance, decrements totalSpent, creates ledger entry.
   */
  async refund(
    tx: PrismaTx,
    userId: string,
    amountCents: number | bigint,
    reason: string,
    opts?: WalletOpsOptions
  ) {
    const rawCents = typeof amountCents === 'bigint' ? amountCents : BigInt(amountCents);
    if (rawCents <= BigInt(0)) {
      throw new WalletInvalidAmountError('Refund');
    }

    const { idempotencyKey, adminId, tenantId, transactionType: txTypeOverride } = opts || {};

    // Fetch user for tenant and totalSpent calculation
    const existingUser = await tx.user.findUnique({
      where: { id: userId },
      select: { balance: true, totalSpent: true, tenantId: true }
    });
    if (!existingUser) throw new WalletUserNotFoundError(userId);

    if (tenantId && existingUser.tenantId !== tenantId) {
      throw new WalletUserNotFoundError(userId);
    }

    const resolvedTenantId = tenantId || existingUser.tenantId || 'smmplan';

    if (idempotencyKey) {
      const existing = await tx.ledgerEntry.findFirst({
        where: { idempotencyKey, tenantId: resolvedTenantId },
      });
      if (existing) {
        assertSameIdempotentOwner(existing, userId, rawCents, idempotencyKey);
        return { success: true, balance: null, cached: true, entry: existing };
      }
    }

    // Calculate safe decrement to prevent negative totalSpent while avoiding Lost Update
    const currentTotalSpent = existingUser.totalSpent ?? BigInt(0);
    const safeDecrement = currentTotalSpent > rawCents ? rawCents : currentTotalSpent;

    // LEDGER-FIRST INVARIANT: Create LedgerEntry BEFORE updating User.balance.
    // If ledger.create fails, the balance is never touched — preserving financial integrity.
    const entry = await tx.ledgerEntry.create({
      data: {
        userId,
        tenantId: resolvedTenantId,
        adminId,
        amount: rawCents,
        reason,
        status: 'APPROVED',
        idempotencyKey,
        // adminId present → ручная отмена заказа (ORDER_CANCEL), иначе авто-возврат (REFUND)
        transactionType: txTypeOverride ?? (adminId ? 'ORDER_CANCEL' : 'REFUND'),
      }
    });

    const updatedUser = await tx.user.update({
      where: { id: userId },
      data: {
        balance: { increment: rawCents },
        totalSpent: { decrement: safeDecrement }
      },
      select: { balance: true, totalSpent: true }
    });

    return { success: true, balance: updatedUser.balance, cached: false, entry };
  },

  /**
   * Add funds to user quarantine balance bubble instead of main balance.
   * Strictly enforces Ledger-First Principle (LedgerEntry created BEFORE balance mutation).
   */
  async quarantineAdd(
    tx: PrismaTx,
    userId: string,
    amountCents: number | bigint,
    reason: string,
    opts?: WalletOpsOptions
  ) {
    const { idempotencyKey, adminId, tenantId } = opts || {};
    const rawCents = typeof amountCents === 'bigint' ? amountCents : BigInt(amountCents);
    const absAmount = rawCents < BigInt(0) ? -rawCents : rawCents;
    // INV-ESC-02: no empty ledger rows; ceiling is above the elevated cap so OWNER anomalies can escalate
    if (absAmount === BigInt(0) || absAmount > QUARANTINE_HARD_CEILING_KOPECKS) {
      throw new WalletInvalidAmountError('Adjustment');
    }

    // 1. Validate User existence and tenant isolation
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true }
    });

    if (!user) {
      throw new WalletUserNotFoundError(userId);
    }

    if (tenantId && user.tenantId !== tenantId) {
      throw new WalletUserNotFoundError(userId);
    }

    const resolvedTenantId = tenantId || user.tenantId || 'smmplan';

    // 2. Idempotency pre-check
    if (idempotencyKey) {
      const existing = await tx.ledgerEntry.findFirst({
        where: { idempotencyKey, tenantId: resolvedTenantId }
      });
      if (existing) {
        return existing;
      }
    }

    // 3. LEDGER-FIRST INVARIANT: Create LedgerEntry FIRST before updating User.quarantineBalance
    const entry = await tx.ledgerEntry.create({
      data: {
        userId,
        tenantId: resolvedTenantId,
        adminId,
        amount: rawCents,
        reason,
        status: 'QUARANTINE',
        idempotencyKey,
        transactionType: 'COMPENSATION'
      }
    });

    // 4. Atomically mutate quarantine balance
    await tx.user.updateMany({
      where: { 
        id: userId,
        ...(tenantId ? { tenantId } : {})
      },
      data: { quarantineBalance: { increment: absAmount } }
    });

    return entry;
  },

  /**
   * Approve funds from quarantine into user main balance.
   * Encapsulates the balance transition without creating a duplicate LedgerEntry.
   * Strictly enforces Trust Boundary and tenant isolation.
   */
  async quarantineApprove(
    tx: PrismaTx,
    userId: string,
    amountCents: number | bigint,
    opts?: { tenantId?: string; adminId?: string }
  ) {
    const rawCents = typeof amountCents === 'bigint' ? amountCents : BigInt(amountCents);
    if (rawCents === BigInt(0)) {
      throw new WalletInvalidAmountError('Adjustment');
    }
    const { tenantId } = opts || {};
    const absCents = rawCents < BigInt(0) ? -rawCents : rawCents;

    // INV-ESC-01: a quarantined DEBIT keeps the same non-negative guard as adminAdjust
    const updatedUserBatch = await tx.user.updateMany({
      where: {
        id: userId,
        ...(rawCents < BigInt(0) ? { balance: { gte: absCents } } : {}),
        ...(tenantId ? { tenantId } : {})
      },
      data: { balance: { increment: rawCents } }
    });

    if (updatedUserBatch.count === 0) {
      const checkUser = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, balance: true },
      });
      if (!checkUser || rawCents > BigInt(0)) {
        throw new WalletUserNotFoundError(userId);
      }
      throw new WalletInsufficientFundsError(absCents, checkUser.balance);
    }

    const updatedUser = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { balance: true }
    });

    return { success: true, balance: updatedUser.balance };
  },

  /**
   * Release or clear quarantine balance for a user.
   *
   * CONTRACT: quarantineRelease ONLY decrements quarantineBalance.
   * It does NOT create a new LedgerEntry — the original QUARANTINE entry
   * in the journal (now APPROVED or REJECTED) IS the audit record.
   * Creating another entry here would produce duplicates in financial reports.
   */
  async quarantineRelease(
    tx: PrismaTx,
    userId: string,
    amountCents: number | bigint,
    opts?: WalletOpsOptions & { reason?: string }
  ) {
    const rawCents = typeof amountCents === 'bigint' ? amountCents : BigInt(amountCents);
    const absAmount = rawCents < BigInt(0) ? -rawCents : rawCents;

    const updated = await tx.user.updateMany({
      where: { 
        id: userId, 
        quarantineBalance: { gte: absAmount },
        ...(opts?.tenantId ? { tenantId: opts.tenantId } : {})
      },
      data: { quarantineBalance: { decrement: absAmount } }
    });

    if (updated.count === 0) {
      // Insufficient quarantine balance — data integrity violation.
      console.error(`[WalletOps.quarantineRelease] CRITICAL: Cannot release ${absAmount} kopecks from quarantine for user ${userId} — insufficient quarantine balance.`);
      throw new Error(`Quarantine release failed: insufficient quarantine balance (requested: ${absAmount}, user: ${userId}). Manual review required.`);
    }

    // No ledgerEntry.create here intentionally.
    // The caller (escrow.service resolveQuarantine) already updated the original
    // QUARANTINE entry to APPROVED/REJECTED via updateMany before calling this method.
  },

  /**
   * Safe referral credit mechanism (e.g., from partner purchases).
   * Modifies referralBalance instead of main balance.
   */
  async referralCredit(
    tx: PrismaTx,
    userId: string,
    amountCents: number | bigint,
    reason: string,
    opts?: WalletOpsOptions
  ) {
    const rawCents = typeof amountCents === 'bigint' ? amountCents : BigInt(amountCents);
    if (rawCents <= BigInt(0)) {
      throw new WalletInvalidAmountError('Credit');
    }

    const { idempotencyKey, adminId, tenantId, transactionType } = opts || {};

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true }
    });

    if (!user || (tenantId && user.tenantId !== tenantId)) {
      throw new WalletUserNotFoundError(userId);
    }
    const resolvedTenantId = tenantId || user.tenantId || 'smmplan';

    if (idempotencyKey) {
      const existing = await tx.ledgerEntry.findFirst({
        where: { idempotencyKey, tenantId: resolvedTenantId },
      });
      if (existing) return { success: true, entry: existing, cached: true };
    }

    const entry = await tx.ledgerEntry.create({
      data: {
        userId,
        tenantId: resolvedTenantId,
        amount: rawCents,
        reason,
        status: 'APPROVED',
        transactionType: transactionType || 'REFERRAL_COMMISSION',
        idempotencyKey,
        adminId,
      }
    });

    await tx.user.update({
      where: { id: userId },
      data: { referralBalance: { increment: rawCents } }
    });

    return { success: true, entry, cached: false };
  },

  /**
   * Safe referral debit mechanism (e.g., from order cancellations).
   * Modifies referralBalance instead of main balance.
   */
  async referralDebit(
    tx: PrismaTx,
    userId: string,
    amountCents: number | bigint,
    reason: string,
    opts?: WalletOpsOptions
  ) {
    const rawCents = typeof amountCents === 'bigint' ? amountCents : BigInt(amountCents);
    if (rawCents <= BigInt(0)) {
      throw new WalletInvalidAmountError('Debit');
    }

    const { idempotencyKey, adminId, tenantId, transactionType, allowDebt } = opts || {};

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, tenantId: true, referralBalance: true }
    });

    if (!user || (tenantId && user.tenantId !== tenantId)) {
      throw new WalletUserNotFoundError(userId);
    }
    const resolvedTenantId = tenantId || user.tenantId || 'smmplan';

    if (idempotencyKey) {
      const existing = await tx.ledgerEntry.findFirst({
        where: { idempotencyKey, tenantId: resolvedTenantId },
      });
      if (existing) {
        assertSameIdempotentPayload(existing, userId, -rawCents, idempotencyKey);
        return { success: true, entry: existing, cached: true };
      }
    }

    // INV-REF-02: withdrawals (transfer to main / admin payout) never create debt.
    const currentRefBalance = user.referralBalance ?? BigInt(0);
    if (!allowDebt && currentRefBalance < rawCents) {
      throw new WalletInsufficientFundsError(rawCents, currentRefBalance);
    }

    // LEDGER-FIRST: the entry is written before the balance moves; any failure below
    // rolls the whole transaction back together with this row.
    const entry = await tx.ledgerEntry.create({
      data: {
        userId,
        tenantId: resolvedTenantId,
        amount: -rawCents,
        reason,
        status: 'APPROVED',
        transactionType: transactionType || 'REFERRAL_REVERSAL',
        idempotencyKey,
        adminId,
      }
    });

    // INV-REF-01: referralBalance moves by EXACTLY the ledger amount. In clawback mode
    // (allowDebt) an uncollectable remainder becomes referral debt (negative balance)
    // that future commissions repay; the client's own main balance is never touched.
    const updated = await tx.user.updateMany({
      where: {
        id: userId,
        ...(allowDebt ? {} : { referralBalance: { gte: rawCents } }),
        ...(tenantId ? { tenantId } : {})
      },
      data: { referralBalance: { decrement: rawCents } }
    });

    if (updated.count !== 1) {
      if (allowDebt) throw new WalletUserNotFoundError(userId);
      throw new WalletInsufficientFundsError(rawCents, currentRefBalance);
    }

    if (allowDebt && currentRefBalance < rawCents) {
      console.warn(`[WalletOps.referralDebit] User ${userId}: clawback ${rawCents} exceeds referralBalance ${currentRefBalance}; referral debt ${rawCents - currentRefBalance} recorded.`);
    }

    return { success: true, entry, cached: false };
  },
};

/**
 * Direct balance adjustment with mandatory tenant context and serializable transaction.
 */
export async function adjustBalance(
  userId: string, 
  amountCents: bigint | number, 
  context: { actorId: string; tenantId: string; reason: string }
) {
  const user = await db.user.findFirst({
    where: {
      id: userId,
      tenantId: context.tenantId
    }
  });

  if (!user) {
    throw new Error(`User ${userId} not found in tenant ${context.tenantId} or access denied`);
  }

  const result = await runSerializableTransaction(async (tx) => {
    return await WalletOps.adminAdjust(
      tx,
      userId,
      amountCents,
      context.reason,
      { adminId: context.actorId, tenantId: context.tenantId }
    );
  });

  try {
    const { auditAdminAwaitable } = await import('@/lib/admin-audit');
    await auditAdminAwaitable({
      adminId: context.actorId,
      adminEmail: 'admin@' + (context.tenantId || 'smmplan') + '.internal',
      action: 'ADJUST_BALANCE',
      target: userId,
      targetType: 'USER_BALANCE',
      oldValue: { balance: user.balance ? String(user.balance) : '0' },
      newValue: {
        amountCents: String(amountCents),
        reason: context.reason,
        tenantId: context.tenantId,
        newBalance: result.balance ? String(result.balance) : undefined
      },
      tenantId: context.tenantId
    });
  } catch (auditErr) {
    console.error('[WalletOps] Failed to record admin audit log:', auditErr);
  }

  return result;
}
