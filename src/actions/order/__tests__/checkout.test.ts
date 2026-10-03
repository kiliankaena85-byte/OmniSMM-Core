import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { checkoutAction } from '../checkout';
import { RateLimitService } from '@/services/core/rate-limit.service';
import { verifySession, createSession } from '@/lib/session';
import { PaymentGatewayFactory } from '@/services/financial/payment-gateway.service';
import { WalletOps, WalletInsufficientFundsError } from '@/services/financial/wallet-ops';

vi.mock('@/services/financial/wallet-ops', () => ({
  WalletOps: {
    charge: vi.fn().mockResolvedValue({ success: true }),
  },
  WalletInsufficientFundsError: class extends Error {
    readonly code = 'INSUFFICIENT_FUNDS';
    constructor() {
      super('Недостаточно средств');
      this.name = 'WalletInsufficientFundsError';
    }
  },
  WalletUserNotFoundError: class extends Error {},
  WalletInvalidAmountError: class extends Error {},
}));

vi.mock('@/lib/db', () => {
  const mockDb = {
    $transaction: vi.fn((cb) => cb(mockDb)),
    // runSerializableTransaction sets `SET LOCAL ROLE app_user` + app.current_tenant (RLS)
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $executeRaw: vi.fn().mockResolvedValue(0),
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    service: {
      findUnique: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    payment: {
      create: vi.fn(),
      update: vi.fn(),
    },
    contentItem: {
      findUnique: vi.fn(),
    },
    promoCode: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    serviceSmartConfig: {
      findUnique: vi.fn(),
    },
    ledgerEntry: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'ledger-1' }),
    },
  };
  return {
    db: mockDb,
  };
});

vi.mock('@/services/core/rate-limit.service', () => ({
  RateLimitService: {
    check: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('@/lib/settings', () => ({
  SettingsManager: {
    isTestMode: vi.fn().mockResolvedValue(false),
    getPaymentSecrets: vi.fn().mockResolvedValue({}),
  },
  SettingsProvider: {
    getCached: vi.fn().mockResolvedValue({
      isTestMode: false,
      siteName: 'Smmplan',
      globalMarkup: 3.0,
      safetyFloor: 1.0,
      exchangeRateUSD: 90.0,
    }),
    getExchangeRateUSD: vi.fn().mockResolvedValue(90.0),
    getTenantId: vi.fn().mockResolvedValue('smmplan'),
    isTestEnvironment: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('@/lib/session', () => ({
  verifySession: vi.fn(),
  createSession: vi.fn(),
  getEncodedKey: vi.fn().mockReturnValue(new TextEncoder().encode('secretsecretsecretsecretsecretsecretsecret')),
}));

vi.mock('@/services/marketing.service', () => ({
  marketingService: {
    calculatePrice: vi.fn().mockResolvedValue({
      totalCents: 1000,
      originalTotalCents: 1000,
      discountCents: 0,
      providerCostCents: 500,
    }),
    consumePromoCode: vi.fn(),
  },
  logPromoCodeUsageIfNeeded: vi.fn(),
}));

vi.mock('@/validators/link-mutators', () => ({
  mutateLink: vi.fn((link) => link),
  getLinkValidator: vi.fn(() => ({
    safeParse: vi.fn().mockReturnValue({ success: true }),
  })),
}));

vi.mock('@/utils/target-type', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/target-type')>();
  return {
    ...actual,
    inferTargetTypeFromCategory: vi.fn().mockReturnValue('POST'),
    isCompatible: vi.fn().mockReturnValue(true),
  };
});

vi.mock('@/services/financial/payment-gateway.service', () => ({
  PaymentGatewayFactory: {
    getGateway: vi.fn(),
  },
}));

vi.mock('@/utils/ip', () => ({
  getClientIp: vi.fn().mockResolvedValue('127.0.0.1'),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn((key) => {
      if (key === 'host') return 'localhost:3000';
      if (key === 'x-forwarded-proto') return 'http';
      if (key === 'user-agent') return 'test-agent';
      return null;
    }),
  }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/smtp', () => ({
  sendOrderPaidMail: vi.fn().mockResolvedValue(true),
  sendOrderBalanceDebitMail: vi.fn().mockResolvedValue(true),
}));

describe('checkoutAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.user.findFirst).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      balance: 5000,
      telegramId: '12345678',
      isActive: true,
      isDeleted: false,
    } as any);
  });

  const validData = {
    serviceId: 'service-1',
    link: 'https://t.me/durov/123',
    quantity: 100,
    email: 'test@test.com',
    idempotencyKey: 'idemp-test-checkout-123',
  };

  it('1. Successful balance payment', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'user-1' } as any);
    
    // Auth check lookup and then generic user lookup (mocking sequence if needed or just simple return)
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      balance: 5000,
      isActive: true,
      isDeleted: false,
    } as any);
    
    vi.mocked(db.service.findUnique).mockResolvedValue({
      id: 'service-1',
      isActive: true,
      externalId: 'ext-1',
      minQty: 10,
      maxQty: 1000,
      targetType: 'POST',
      category: { network: { slug: 'tg' } },
    } as any);

    vi.mocked(db.contentItem.findUnique).mockResolvedValue({
      updatedAt: new Date(),
    } as any);

    vi.mocked(db.order.create).mockResolvedValue({ id: 'order-1', numericId: 1001 } as any);
    vi.mocked(db.payment.create).mockResolvedValue({ id: 'payment-1' } as any);
    
    const mockGateway = {
      createPayment: vi.fn().mockResolvedValue({ paymentUrl: 'balance-success' }),
    };
    vi.mocked(PaymentGatewayFactory.getGateway).mockReturnValue(mockGateway as any);

    const result = await checkoutAction({
      ...validData,
      gateway: 'balance',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orderId).toBe('order-1');
      expect(result.data.paymentId).toBe('payment-1');
      expect(db.$transaction).toHaveBeenCalled();
      expect(db.order.create).toHaveBeenCalled();
      expect(mockGateway.createPayment).not.toHaveBeenCalled();
    }
  });

  it('2. Insufficient funds rejection', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'user-1' } as any);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      balance: 0, // 0 balance
      isActive: true,
      isDeleted: false,
    } as any);
    vi.mocked(db.user.findFirst).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      balance: 0,
      isActive: true,
      isDeleted: false,
    } as any);
    
    vi.mocked(WalletOps.charge).mockRejectedValue(new WalletInsufficientFundsError(100, 0));
    
    vi.mocked(db.service.findUnique).mockResolvedValue({
      id: 'service-1',
      isActive: true,
      externalId: 'ext-1',
      minQty: 10,
      maxQty: 1000,
      targetType: 'POST',
      category: { network: { slug: 'tg' } },
    } as any);

    const result = await checkoutAction({
      ...validData,
      gateway: 'balance',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatch(/Недостаточно средств/);
    }
  });

  it('3. Successful gateway payment redirect', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'user-1' } as any);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      balance: 0,
      isActive: true,
      isDeleted: false,
    } as any);
    
    vi.mocked(db.service.findUnique).mockResolvedValue({
      id: 'service-1',
      isActive: true,
      externalId: 'ext-1',
      minQty: 10,
      maxQty: 1000,
      targetType: 'POST',
      category: { network: { slug: 'tg' } },
    } as any);

    vi.mocked(db.order.create).mockResolvedValue({ id: 'order-2', numericId: 1002 } as any);
    vi.mocked(db.payment.create).mockResolvedValue({ id: 'payment-2' } as any);

    const mockGateway = {
      createPayment: vi.fn().mockResolvedValue({
        paymentUrl: 'https://yookassa.ru/checkout',
        remoteGatewayId: 'yoo-123',
      }),
    };
    vi.mocked(PaymentGatewayFactory.getGateway).mockReturnValue(mockGateway as any);

    const result = await checkoutAction({
      ...validData,
      gateway: 'yookassa',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(mockGateway.createPayment).toHaveBeenCalled();
      expect(result.data.paymentUrl).toBe('https://yookassa.ru/checkout');
      expect(db.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-2' },
        data: expect.objectContaining({
          checkoutUrl: 'https://yookassa.ru/checkout',
          gatewayId: 'yoo-123',
        }),
      });
    }
  });

  it('4. Idempotency key deduplication', async () => {
    vi.mocked(db.service.findUnique).mockResolvedValue({
      id: 'service-1',
      isActive: true,
      externalId: 'ext-1',
      minQty: 10,
      maxQty: 1000,
      targetType: 'POST',
      category: { network: { slug: 'tg' } },
    } as any);

    vi.mocked(db.contentItem.findUnique).mockResolvedValue({
      updatedAt: new Date(),
    } as any);

    vi.mocked(verifySession).mockResolvedValue({ userId: 'user-1' } as any);
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: 'existing-order-1',
      paymentId: 'existing-payment-1',
      status: 'PENDING',
      // INV-BOLA-01: a replay is only honoured for the same owner within the same tenant
      userId: 'user-1',
      tenantId: 'smmplan',
      payment: { checkoutUrl: 'https://existing-url' },
    } as any);

    const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0'
    });
    vi.mocked(db.order.create).mockRejectedValue(prismaError);

    const result = await checkoutAction({
      ...validData,
      gateway: 'yookassa',
      idempotencyKey: 'idemp-123456',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orderId).toBe('existing-order-1');
      expect(result.data.paymentId).toBe('existing-payment-1');
      expect(result.data.paymentUrl).toBe('https://existing-url');
      expect(db.order.create).not.toHaveBeenCalled();
    }
  });

  it('5. INV-BOLA-01: foreign idempotency key is rejected without leaking the order', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'user-1' } as any);
    vi.mocked(db.service.findUnique).mockResolvedValue({
      id: 'service-1',
      isActive: true,
      externalId: 'ext-1',
      minQty: 10,
      maxQty: 1000,
      targetType: 'POST',
      category: { network: { slug: 'tg' } },
    } as any);
    vi.mocked(db.order.findUnique).mockResolvedValue({
      id: 'victim-order-1',
      paymentId: 'victim-payment-1',
      status: 'PENDING',
      userId: 'victim-user',
      tenantId: 'smmflux',
      payment: { checkoutUrl: 'https://victim-checkout-url' },
    } as any);

    const result = await checkoutAction({
      ...validData,
      gateway: 'yookassa',
      idempotencyKey: 'idemp-victim-key',
    });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain('victim');
    expect(db.order.create).not.toHaveBeenCalled();
  });

  it('6. INV-IDEM-03: balance charge is bound to the created order id', async () => {
    vi.mocked(verifySession).mockResolvedValue({ userId: 'user-1' } as any);
    vi.mocked(WalletOps.charge).mockResolvedValue({ success: true } as any);
    vi.mocked(db.order.findUnique).mockResolvedValue(null);
    vi.mocked(db.user.findUnique).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      balance: 5000,
      isActive: true,
      isDeleted: false,
    } as any);
    vi.mocked(db.service.findUnique).mockResolvedValue({
      id: 'service-1',
      isActive: true,
      externalId: 'ext-1',
      minQty: 10,
      maxQty: 1000,
      targetType: 'POST',
      category: { network: { slug: 'tg' } },
    } as any);
    vi.mocked(db.order.create).mockResolvedValue({ id: 'order-77', numericId: 1077 } as any);
    vi.mocked(db.payment.create).mockResolvedValue({ id: 'payment-77' } as any);

    const result = await checkoutAction({ ...validData, gateway: 'balance' });

    expect(result.success).toBe(true);
    expect(WalletOps.charge).toHaveBeenCalledTimes(1);
    const chargeArgs = vi.mocked(WalletOps.charge).mock.calls[0];
    expect(JSON.stringify(chargeArgs, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).toContain('order-77');
    expect(vi.mocked(db.order.create).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(WalletOps.charge).mock.invocationCallOrder[0]);
  });
});
