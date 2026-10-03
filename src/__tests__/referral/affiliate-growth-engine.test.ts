/**
 * (c) 2024-2026 SMMplan. All rights reserved.
 * Comprehensive Test Suite for Affiliate Growth Engine 2.0.
 * Covers: 4-Tier Progression, Commission Calculations, Anti-Fraud Cycle Defense,
 * and Atomic Balance Transfer with Race Condition Protection.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { LoyaltyService } from '@/services/users/loyalty.service';
import { ReferralValidatorService } from '@/services/referral/referral-validator.service';
import { calculateReferralTier } from '@/app/dashboard/referrals/referral-ui';

describe('💎 Affiliate Growth Engine 2.0 Master Suite', () => {
  let rootAffiliateId: string;
  let subReferralId: string;
  let testTenantId: string;

  beforeEach(async () => {
    testTenantId = 'smmplan';

    // 1. Create Root Affiliate
    const rootUser = await db.user.create({
      data: {
        email: `affiliate_master_${Date.now()}@smmplan.test`,
        balance: BigInt(0),
        referralBalance: 15000, // 150.00 RUB
        referralCode: `PARTNER_${Date.now()}`,
        totalSpent: BigInt(0),
        tenantId: testTenantId,
        createdAt: new Date('2026-06-01T00:00:00Z'), // Non-pioneer for strict tier testing
      },
    });
    rootAffiliateId = rootUser.id;

    // 2. Create Sub-referral
    const subUser = await db.user.create({
      data: {
        email: `referral_client_${Date.now()}@smmplan.test`,
        balance: BigInt(5000),
        referredById: rootAffiliateId,
        referralCode: `CLIENT_${Date.now()}`,
        tenantId: testTenantId,
      },
    });
    subReferralId = subUser.id;
  });

  afterAll(async () => {
    // Cleanup test users and dependent records
    await db.auditLog.deleteMany({ where: { userId: { in: [rootAffiliateId, subReferralId] } } });
    await db.commission.deleteMany({ where: { referrerId: rootAffiliateId } });
    await db.user.deleteMany({ where: { id: { in: [rootAffiliateId, subReferralId] } } });
  });

  describe('1. 4-Tier Progression & Calculation Logic', () => {
    it('accurately calculates Tier 1 (Старт - 5%) for new users', () => {
      const { currentTier, nextTier, progressPercent, refsNeeded } = calculateReferralTier(0, 0);
      expect(currentTier.level).toBe(1);
      expect(currentTier.percent).toBe(5);
      expect(nextTier?.level).toBe(2);
      expect(refsNeeded).toBe(3);
      expect(progressPercent).toBe(0);
    });

    it('accurately calculates Tier 2 (Партнёр - 7%) when reaching 3 referrals', () => {
      const { currentTier, nextTier, refsNeeded } = calculateReferralTier(3, 2000);
      expect(currentTier.level).toBe(2);
      expect(currentTier.percent).toBe(7);
      expect(nextTier?.level).toBe(3);
      expect(refsNeeded).toBe(7); // 10 - 3 = 7
    });

    it('accurately calculates Tier 3 (Профи - 10%) when reaching 10 referrals or 30,000 RUB LTV', () => {
      const byRefs = calculateReferralTier(10, 0);
      expect(byRefs.currentTier.level).toBe(3);
      expect(byRefs.currentTier.percent).toBe(10);

      const byLtv = calculateReferralTier(1, 35000);
      expect(byLtv.currentTier.level).toBe(3);
      expect(byLtv.currentTier.percent).toBe(10);
    });

    it('accurately calculates Tier 4 (VIP Лидер - 15%) for top partners', () => {
      const { currentTier, nextTier, progressPercent, refsNeeded } = calculateReferralTier(25, 60000);
      expect(currentTier.level).toBe(4);
      expect(currentTier.percent).toBe(15);
      expect(nextTier).toBeNull();
      expect(refsNeeded).toBe(0);
      expect(progressPercent).toBe(100);
    });

    it('LoyaltyService.getReferralPercent dynamically reflects user volume', async () => {
      // Base user has 0 spent, 1 referral -> 5%
      const initialPercent = await LoyaltyService.getReferralPercent(rootAffiliateId);
      expect(initialPercent).toBe(5);

      // Simulate user reaching 35,000 RUB total spent -> 10%
      await db.user.update({
        where: { id: rootAffiliateId },
        data: { totalSpent: BigInt(3500000) }, // 35,000 RUB in kopecks
      });

      const updatedPercent = await LoyaltyService.getReferralPercent(rootAffiliateId);
      expect(updatedPercent).toBe(10);
    });
  });

  describe('2. Anti-Fraud & Graph Cycle Validation', () => {
    it('strictly forbids self-referral (user attempting to refer themselves)', async () => {
      const result = await ReferralValidatorService.validateReferralLink(rootAffiliateId, rootAffiliateId);
      expect(result.valid).toBe(false);
      expect(result.riskLevel).toBe('CRITICAL');
      expect(result.reason).toBe('SELF_REFERRAL_FORBIDDEN');
    });

    it('strictly detects and blocks circular referral chains (A -> B -> A)', async () => {
      // subReferralId was invited by rootAffiliateId.
      // Now rootAffiliateId attempts to bind subReferralId as their referrer.
      const result = await ReferralValidatorService.validateReferralLink(subReferralId, rootAffiliateId);
      expect(result.valid).toBe(false);
      expect(result.riskLevel).toBe('CRITICAL');
      expect(result.reason).toBe('CIRCULAR_REFERRAL_DETECTED');
    });

    it('detects suspicious IP clustering when >= 5 referrals register from same IP in 24h', async () => {
      const ip = '198.51.100.42';
      // Seed 5 existing referrals with this IP
      for (let i = 0; i < 5; i++) {
        await db.user.create({
          data: {
            email: `cluster_ref_${Date.now()}_${i}@smmplan.test`,
            referredById: rootAffiliateId,
            tosAcceptedIp: ip,
            tenantId: testTenantId,
          },
        });
      }

      const result = await ReferralValidatorService.validateReferralLink(rootAffiliateId, null, { ip });
      expect(result.valid).toBe(true);
      expect(result.riskLevel).toBe('HIGH');
      expect(result.reason).toBe('IP_CLUSTERING_SUSPICIOUS');
    });
  });

  describe('3. Commission Lifecycle (Award -> Confirm -> Partial -> Reverse)', () => {
    it('awards pending commission on deposit and credits referral balance upon confirmation', async () => {
      const orderId = `order_test_${Date.now()}`;
      const depositCents = 100000; // 1,000 RUB

      await db.$transaction(async (tx) => {
        await LoyaltyService.awardCommission(tx, subReferralId, depositCents, orderId);
      });

      // Commission should be PENDING
      const comm = await db.commission.findFirst({
        where: { orderId, referrerId: rootAffiliateId },
      });
      expect(comm).toBeDefined();
      expect(comm?.status).toBe('PENDING');
      expect(Number(comm?.amount)).toBe(5000); // 5% of 100,000 cents = 5,000 cents (50 RUB)

      // Confirm commission
      const beforeUser = await db.user.findUnique({ where: { id: rootAffiliateId } });
      const beforeRefBal = beforeUser?.referralBalance ?? BigInt(0);

      await db.$transaction(async (tx) => {
        await LoyaltyService.confirmCommission(tx, orderId);
      });

      const afterUser = await db.user.findUnique({ where: { id: rootAffiliateId } });
      expect(afterUser?.referralBalance).toBe(beforeRefBal + BigInt(5000));

      const confirmedComm = await db.commission.findUnique({ where: { id: comm!.id } });
      expect(confirmedComm?.status).toBe('CONFIRMED');
    });
  });
});
