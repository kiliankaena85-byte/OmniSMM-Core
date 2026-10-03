/**
 * SPEC-TESTER-INVITES-2026 — Tester Invites & YooKassa Test Mode Guard
 * Tests for INV-TESTER-01..06
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  testerInvite: {
    createMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  payment: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  contentItem: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
}));

vi.mock('@/lib/db', () => ({
  db: mockPrisma,
}));

vi.mock('@/lib/session', () => ({
  verifySession: vi.fn(async () => ({ userId: 'user-tester-1' })),
}));

vi.mock('@/lib/tenant-resolver-edge', () => ({
  resolveTenantFromRequest: vi.fn(() => 'smmplan'),
  normalizeTenantId: vi.fn((t?: string | null) => t || 'smmplan'),
}));

const mockSettings = vi.hoisted(() => ({
  isTestMode: vi.fn(async () => true),
  getPaymentSecrets: vi.fn(async () => ({
    yookassaShopId: 'test_shop_123',
    yookassaSecretKey: 'test_secret_123',
    robokassaLogin: 'robo_test',
    robokassaPassword: 'pwd',
    cryptoBotToken: '1234:AAtest'
  })),
  getContactAndLegalSettings: vi.fn(async () => ({
    COMPANY_INN: '7700000000',
    LEGAL_INN: '7700000000'
  })),
  getSupportEmailDomain: vi.fn(async () => 'smmplan.pro'),
}));

vi.mock('@/lib/settings', () => ({
  SettingsProvider: mockSettings,
  SettingsManager: mockSettings,
}));

vi.mock('@/services/core/rate-limit.service', () => ({
  RateLimitService: { check: vi.fn(async () => true) },
}));

vi.mock('@/utils/ip', () => ({
  getClientIp: vi.fn(async () => '185.71.76.5'),
}));

vi.mock('@/utils/get-base-url', () => ({
  getBaseUrlAsync: vi.fn(async () => 'https://smmplan.pro'),
}));

vi.mock('@/lib/admin-audit', () => ({
  auditAdminAwaitable: vi.fn(async () => undefined),
}));

vi.mock('@/services/financial/payment-gateway.service', () => ({
  PaymentGatewayFactory: {
    getGateway: vi.fn(() => ({
      createPayment: vi.fn(async () => ({
        paymentUrl: 'https://yookassa.ru/test-checkout',
        remoteGatewayId: 'yoo_test_mock_12345'
      }))
    }))
  }
}));

import { TesterInvitesService } from '@/services/security/tester-invites.service';
import { createTopUpPaymentAction } from '@/actions/user/top-up.action';
import { GatewaysAvailabilityService } from '@/services/orders/gateways-availability.service';

describe('SPEC-TESTER-INVITES-2026: Invariants & Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettings.isTestMode.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('INV-TESTER-02: generates batch of 14-day invite links with unique codes', async () => {
    mockPrisma.testerInvite.createMany.mockResolvedValue({ count: 10 });

    const result = await TesterInvitesService.generateInvites('smmplan', 10, 'admin-1', 'Для тесторов');
    expect(result.count).toBe(10);
    expect(result.invites).toHaveLength(10);
    expect(mockPrisma.testerInvite.createMany).toHaveBeenCalledTimes(1);

    const callArgs = mockPrisma.testerInvite.createMany.mock.calls[0][0];
    expect(callArgs.data).toHaveLength(10);

    const firstItem = callArgs.data[0];
    expect(firstItem.tenantId).toBe('smmplan');
    expect(firstItem.status).toBe('ACTIVE');
    expect(firstItem.code).toMatch(/^[a-f0-9]{32}$/);
    
    // Check 14-day expiry
    const now = Date.now();
    const expiresAtMs = new Date(firstItem.expiresAt).getTime();
    const diffDays = Math.round((expiresAtMs - now) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(14);
  });

  it('INV-TESTER-01 & 03: atomic redemption binds one invite to one user email and marks isTester=true', async () => {
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    mockPrisma.testerInvite.findUnique.mockResolvedValue({
      id: 'inv-1',
      code: 'valid_code_123',
      status: 'ACTIVE',
      expiresAt: futureDate,
      tenantId: 'smmplan'
    });
    mockPrisma.testerInvite.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.user.update.mockResolvedValue({ id: 'user-1', isTester: true });

    const result = await TesterInvitesService.redeemInvite('valid_code_123', 'user-1', 'tester@example.com', 'smmplan');
    expect(result.success).toBe(true);
    expect(mockPrisma.testerInvite.updateMany).toHaveBeenCalledWith({
      where: {
        code: 'valid_code_123',
        status: 'ACTIVE',
        expiresAt: { gt: expect.any(Date) },
        tenantId: 'smmplan'
      },
      data: {
        status: 'USED',
        usedById: 'user-1',
        usedEmail: 'tester@example.com',
        usedAt: expect.any(Date)
      }
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { isTester: true }
    });
  });

  it('INV-TESTER-01: fails if invite was already used (count === 0)', async () => {
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    mockPrisma.testerInvite.findUnique.mockResolvedValue({
      id: 'inv-1',
      code: 'used_code_123',
      status: 'USED',
      expiresAt: futureDate,
      tenantId: 'smmplan'
    });
    mockPrisma.testerInvite.updateMany.mockResolvedValue({ count: 0 });

    const result = await TesterInvitesService.redeemInvite('used_code_123', 'user-1', 'tester@example.com', 'smmplan');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/уже использована|недействительна/i);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('INV-TESTER-02: fails if invite has expired', async () => {
    const pastDate = new Date(Date.now() - 1000);
    mockPrisma.testerInvite.findUnique.mockResolvedValue({
      id: 'inv-1',
      code: 'expired_code_123',
      status: 'ACTIVE',
      expiresAt: pastDate,
      tenantId: 'smmplan'
    });

    const result = await TesterInvitesService.redeemInvite('expired_code_123', 'user-1', 'tester@example.com', 'smmplan');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/истёк/i);
    expect(mockPrisma.testerInvite.updateMany).not.toHaveBeenCalled();
  });

  it('INV-TESTER-04: top-up in test mode REJECTS regular user without isTester flag', async () => {
    mockSettings.isTestMode.mockResolvedValue(true);
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-tester-1',
      email: 'regular@example.com',
      role: 'USER',
      isTester: false,
      isActive: true,
      isDeleted: false,
    });

    const res = await createTopUpPaymentAction(100, 'yookassa');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/доступно только авторизованным тестировщикам/i);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it('INV-TESTER-04: top-up in test mode ACCEPTS user with isTester=true', async () => {
    mockSettings.isTestMode.mockResolvedValue(true);
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-tester-1',
      email: 'tester@example.com',
      role: 'USER',
      isTester: true,
      isActive: true,
      isDeleted: false,
    });
    mockPrisma.payment.create.mockResolvedValue({
      id: 'pay-123',
      amount: 10000,
    });
    mockPrisma.payment.update.mockResolvedValue({});

    const res = await createTopUpPaymentAction(100, 'yookassa');
    expect(res.success).toBe(true);
    expect(res.paymentUrl).toBeDefined();
    expect(mockPrisma.payment.create).toHaveBeenCalled();
  });

  it('INV-TESTER-04: top-up in test mode ACCEPTS staff user (ADMIN/OWNER) even if isTester=false', async () => {
    mockSettings.isTestMode.mockResolvedValue(true);
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-tester-1',
      email: 'admin@smmplan.pro',
      role: 'ADMIN',
      isTester: false,
      isActive: true,
      isDeleted: false,
    });
    mockPrisma.payment.create.mockResolvedValue({
      id: 'pay-456',
      amount: 10000,
    });
    mockPrisma.payment.update.mockResolvedValue({});

    const res = await createTopUpPaymentAction(100, 'yookassa');
    expect(res.success).toBe(true);
    expect(mockPrisma.payment.create).toHaveBeenCalled();
  });

  it('INV-TESTER-04: top-up in production mode (isTestMode=false) allows normal users', async () => {
    mockSettings.isTestMode.mockResolvedValue(false);
    mockPrisma.user.findFirst.mockResolvedValue({
      id: 'user-tester-1',
      email: 'realcustomer@example.com',
      role: 'USER',
      isTester: false,
      isActive: true,
      isDeleted: false,
    });
    mockPrisma.payment.create.mockResolvedValue({
      id: 'pay-789',
      amount: 10000,
    });
    mockPrisma.payment.update.mockResolvedValue({});

    const res = await createTopUpPaymentAction(100, 'yookassa');
    expect(res.success).toBe(true);
  });

  it('INV-TESTER-05: GatewaysAvailabilityService only exposes yookassa', async () => {
    const gateways = await GatewaysAvailabilityService.getAvailable('smmplan');
    expect(gateways.yookassa).toBe(true);
    expect(gateways.robokassa).toBe(false);
    expect(gateways.cryptobot).toBe(false);
    expect(gateways.sbp).toBe(false);
  });
});
