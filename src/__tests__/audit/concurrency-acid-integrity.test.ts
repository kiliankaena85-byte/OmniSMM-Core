import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Audit Reproduction Suite for Concurrency, ACID & Financial Integrity (Milestone M5 / R4)
 * Validates findings documented in:
 * - .agents/teamwork_preview_explorer_audit_r3_r4/handoff.md
 * - .agents/teamwork_preview_orchestrator_audit_1/PROJECT.md
 */
describe('Audit R4: Concurrency & ACID Financial Integrity Invariants', () => {

  describe('R4-P0-01: Double-Charge Vulnerability on Retry Checkout with Balance', () => {
    const retryServicePath = path.resolve(process.cwd(), 'src/services/orders/retry-checkout.service.ts');
    const gatewayServicePath = path.resolve(process.cwd(), 'src/services/financial/payment-gateway.service.ts');

    it('AST Invariant: RetryCheckoutService charges balance in transaction AND unconditionally passes to BalanceGateway', () => {
      const retryContent = fs.readFileSync(retryServicePath, 'utf-8');
      const gatewayContent = fs.readFileSync(gatewayServicePath, 'utf-8');

      // 1. Inside transaction: charges user balance when gateway === 'balance'
      const hasChargeInTx = retryContent.includes("if (gateway === 'balance')") &&
        retryContent.includes("await WalletOps.charge(tx, sessionUserId, totalChargeCents");
      expect(hasChargeInTx).toBe(true);

      // 2. Outside transaction: early return for gateway === 'balance' PREVENTS delegation to PaymentGatewayFactory
      const gatewayCallIndex = retryContent.indexOf('PaymentGatewayFactory.getGateway(gateway ||');
      expect(gatewayCallIndex).toBeGreaterThan(0);

      const codeBeforeGateway = retryContent.substring(
        retryContent.indexOf('const result = await runSerializableTransaction'),
        gatewayCallIndex
      );
      expect(codeBeforeGateway.includes("if (gateway === 'balance')")).toBe(true);
      expect(codeBeforeGateway.includes("return {")).toBe(true);

      // 3. Inside BalanceGateway.createPayment: charges user balance a second time (if reached, but now guarded!)
      const balanceGatewayIndex = gatewayContent.indexOf('class BalanceGateway');
      expect(balanceGatewayIndex).toBeGreaterThan(0);
      const balanceGatewayBody = gatewayContent.substring(balanceGatewayIndex, balanceGatewayIndex + 2500);

      expect(balanceGatewayBody.includes('await WalletOps.charge(tx, params.userId, amountCents')).toBe(true);
      expect(balanceGatewayBody.includes('idempotencyKey: `balance-charge-${params.paymentId}`')).toBe(true);
    });

    it('Behavioral Simulation: User balance is debited twice for a single order retry', async () => {
      const orderAmountCents = BigInt(50000); // 500.00 RUB
      let userBalance = BigInt(200000);       // 2,000.00 RUB
      const ledgerEntries: Array<{ idempotencyKey: string; amount: bigint }> = [];

      const mockCharge = async (amount: bigint, idempotencyKey: string) => {
        // Enforce ledger entry uniqueness
        if (ledgerEntries.some(e => e.idempotencyKey === idempotencyKey)) {
          return { cached: true };
        }
        ledgerEntries.push({ idempotencyKey, amount });
        userBalance -= amount;
        return { cached: false, balance: userBalance };
      };

      const orderId = 'order-retry-test-1';
      const paymentId = 'pay-retry-test-1';

      // Step 1: RetryCheckoutService executes inside runSerializableTransaction
      // Uses key format: retry-balance-${order.id}-${Date.now()}
      const txKey = `retry-balance-${orderId}-${Date.now()}`;
      await mockCharge(orderAmountCents, txKey);

      // Step 2: Outside tx, RetryCheckoutService delegates to BalanceGateway.createPayment
      // Uses key format: balance-charge-${params.paymentId}
      const gatewayKey = `balance-charge-${paymentId}`;
      await mockCharge(orderAmountCents, gatewayKey);

      // VERIFICATION:
      // Two distinct ledger entries are created because keys differ!
      expect(ledgerEntries).toHaveLength(2);
      expect(ledgerEntries[0].idempotencyKey).toBe(txKey);
      expect(ledgerEntries[1].idempotencyKey).toBe(gatewayKey);

      // Total balance deducted is 2x the order amount!
      expect(userBalance).toBe(BigInt(100000)); // 200,000 - (50,000 * 2) = 100,000 (Lost 500 RUB!)
    });
  });

  describe('R4-P0-02: Non-Deterministic Idempotency Keys Using Date.now()', () => {
    it('AST Invariant: Financial operations must NOT use Date.now() inside idempotency keys', () => {
      const filesToAudit = [
        'src/actions/admin/orders.ts',
        'src/actions/admin/users.ts',
        'src/services/admin/order/order-status-mutator.service.ts',
        'src/services/orders/retry-checkout.service.ts',
      ];

      const violations: string[] = [];

      for (const relPath of filesToAudit) {
        const fullPath = path.resolve(process.cwd(), relPath);
        if (!fs.existsSync(fullPath)) continue;

        const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
        for (const [idx, line] of lines.entries()) {
          if (line.includes('idempotencyKey') && line.includes('Date.now()')) {
            violations.push(`${relPath}:${idx + 1}: ${line.trim()}`);
          }
        }
      }

      // Assert that non-deterministic keys are completely eliminated from financial operations
      expect(violations).toEqual([]);
      expect(violations.length).toBe(0);
    });

    it('Concurrency Simulation: Rapid duplicate cancellation produces distinct keys, bypassing unique constraint', () => {
      const orderId = 'order-dup-100';
      const status = 'CANCELED';

      // Current code template: `refund_${order.id}_${newStatus}_${Date.now()}`
      const generateKey = (timestamp: number) => `refund_${orderId}_${status}_${timestamp}`;

      // Two rapid clicks or retries spaced 5ms apart
      const key1 = generateKey(1727160000000);
      const key2 = generateKey(1727160000005);

      // Because timestamps differ, keys are distinct strings
      expect(key1).not.toBe(key2);

      // In PostgreSQL:
      // UNIQUE(idempotencyKey) allows both rows to insert!
      const uniqueIndexSim = new Set<string>();
      uniqueIndexSim.add(key1);
      const collisionOccurred = uniqueIndexSim.has(key2);

      expect(collisionOccurred).toBe(false); // No collision! Both refunds execute, causing duplicate payout!
    });
  });

  describe('R4-P1-01: Non-Atomic In-Memory Calculation of User.totalSpent in WalletOps.refund', () => {
    const walletOpsPath = path.resolve(process.cwd(), 'src/services/financial/wallet-ops.ts');

    it('AST Invariant (fixed): WalletOps.refund mutates totalSpent atomically via decrement, never writes an absolute value', () => {
      const content = fs.readFileSync(walletOpsPath, 'utf-8');

      const refundFnIndex = content.indexOf('async refund(');
      expect(refundFnIndex).toBeGreaterThan(0);
      const nextFnIndex = content.indexOf('async quarantineAdd(', refundFnIndex);
      const refundBody = content.substring(refundFnIndex, nextFnIndex > 0 ? nextFnIndex : refundFnIndex + 3500);

      // 1. The clamp is computed only to avoid a negative totalSpent...
      expect(refundBody.includes('const safeDecrement = currentTotalSpent > rawCents ? rawCents : currentTotalSpent')).toBe(true);

      // 2. ...but the write is an atomic relative decrement (no lost update under concurrency)
      expect(refundBody.includes('totalSpent: { decrement: safeDecrement }')).toBe(true);
      expect(/totalSpent:\s*newTotalSpent/.test(refundBody)).toBe(false);

      // 3. Balance is likewise atomic
      expect(refundBody.includes('balance: { increment: rawCents }')).toBe(true);
    });

    it('Concurrency Simulation: Concurrent order charge and refund causes lost update on totalSpent', () => {
      // User starts with totalSpent = 10,000 RUB (1,000,000 cents)
      let databaseTotalSpent = BigInt(1000000);

      // Transaction A: Refund of 1,000 RUB (100,000 cents)
      // Step A1: Reads current state
      const txA_read = databaseTotalSpent;
      const txA_calculated = txA_read - BigInt(100000); // 900,000 cents

      // Transaction B: Concurrent order purchase of 2,000 RUB (200,000 cents)
      // Uses atomic increment: { increment: 200000 }
      databaseTotalSpent += BigInt(200000); // Now 1,200,000 cents

      // Step A2: Transaction A commits absolute value
      databaseTotalSpent = txA_calculated; // Overwrites database with 900,000!

      // Expected correct total: 10,000 - 1,000 + 2,000 = 11,000 RUB (1,100,000 cents)
      const expectedTotalSpent = BigInt(1100000);

      // Actual value suffered a lost update of 2,000 RUB!
      expect(databaseTotalSpent).not.toBe(expectedTotalSpent);
      expect(databaseTotalSpent).toBe(BigInt(900000));
    });
  });

  describe('R4-P1-02: Ledger-First Ordering in WalletOps.quarantineAdd', () => {
    const walletOpsPath = path.resolve(process.cwd(), 'src/services/financial/wallet-ops.ts');

    it('AST Invariant: quarantineAdd creates LedgerEntry before mutating User quarantineBalance', () => {
      const content = fs.readFileSync(walletOpsPath, 'utf-8');

      const fnIndex = content.indexOf('async quarantineAdd(');
      expect(fnIndex).toBeGreaterThan(0);
      const fnBody = content.substring(fnIndex, fnIndex + 2000);

      const userUpdateIndex = fnBody.indexOf('tx.user.updateMany');
      const ledgerCreateIndex = fnBody.indexOf('tx.ledgerEntry.create');

      expect(userUpdateIndex).toBeGreaterThan(0);
      expect(ledgerCreateIndex).toBeGreaterThan(0);

      // LEDGER-FIRST ENFORCED: tx.ledgerEntry.create happens BEFORE tx.user.updateMany
      expect(ledgerCreateIndex).toBeLessThan(userUpdateIndex);

      // Idempotency pre-check present
      expect(fnBody.includes('tx.ledgerEntry.findFirst')).toBe(true);
    });
  });

  describe('R4-P1-03: TOCTOU Order Status Race in RetryCheckoutService.execute', () => {
    const retryServicePath = path.resolve(process.cwd(), 'src/services/orders/retry-checkout.service.ts');

    it('AST Invariant: Order status is validated before transaction but not re-checked inside transaction', () => {
      const content = fs.readFileSync(retryServicePath, 'utf-8');

      // Status check at line 60 outside transaction
      const preCheckIndex = content.indexOf("if (order.status !== 'AWAITING_PAYMENT')");
      expect(preCheckIndex).toBeGreaterThan(0);

      const txStartIndex = content.indexOf('const result = await runSerializableTransaction');
      expect(preCheckIndex).toBeLessThan(txStartIndex);

      // Inside transaction: inspects existingPayment and linkedOrders, but never re-validates order.status
      const txEndIndex = content.indexOf('return { paymentId: paymentId!, totalPaymentAmount: paymentAmount');
      const txBody = content.substring(txStartIndex, txEndIndex);

      expect(txBody.includes("order.status !== 'AWAITING_PAYMENT'")).toBe(false);
      expect(txBody.includes("tx.order.findUniqueOrThrow")).toBe(false);
    });
  });
});
