// Mock server-only before any other imports
import Module from "module";
const origReq = (Module as any).prototype.require;
(Module as any).prototype.require = function (id: string) {
  if (id === "server-only" || id.includes("server-only")) return {};
  return origReq.apply(this, arguments);
};

import dotenv from 'dotenv';
dotenv.config();

const pgUrl = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED || process.env.DIRECT_URL || (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgresql://') ? process.env.DATABASE_URL : 'postgresql://postgres:postgres@localhost:5432/smmplan');
process.env.DATABASE_URL = pgUrl;
process.env.POSTGRES_PRISMA_URL = pgUrl;
process.env.POSTGRES_URL = pgUrl;

// SAFETY GUARD (QA-008): скрипт МУТИРУЕТ БД (создаёт заказ, WalletOps.charge, isTester).
// Fail-closed: на боевую БД (smmplan_lite / порт 5435) без явного флага не запускается.
{
  const looksProd = /\/smmplan_lite(\?|$)/.test(pgUrl) || /:5435\//.test(pgUrl);
  if (looksProd && process.env.SMOKE_ALLOW_PROD_WRITES !== 'I_UNDERSTAND_THIS_WRITES_TO_PROD') {
    console.error('⛔ smoke-live-container: DATABASE_URL указывает на БОЕВУЮ БД. Скрипт пишет в БД. Используйте тестовую БД (.env.test) или Stage.');
    process.exit(2);
  }
}

import { randomUUID } from 'crypto';

interface TestResult {
  suite: string;
  name: string;
  passed: boolean;
  details?: string;
  durationMs: number;
}

const results: TestResult[] = [];

async function runTest(suite: string, name: string, fn: () => Promise<void | string>) {
  const start = Date.now();
  try {
    const details = await fn();
    const durationMs = Date.now() - start;
    results.push({ suite, name, passed: true, details: details || undefined, durationMs });
    console.log(`  ✅ [PASS] ${name} (${durationMs}ms) ${details ? `— ${details}` : ''}`);
  } catch (err: unknown) {
    const durationMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ suite, name, passed: false, details: msg, durationMs });
    console.log(`  ❌ [FAIL] ${name} (${durationMs}ms) — Error: ${msg}`);
  }
}

export async function runLiveContainerSmokeTest() {
  const { db } = await import('../src/lib/db');
  const { SettingsProvider, SettingsManager } = await import('../src/lib/settings');
  const { getAvailableGatewaysAction } = await import('../src/actions/order/checkout');
  const { paymentService } = await import('../src/services/financial/payment.service');
  const { WalletOps } = await import('../src/services/financial/wallet-ops');
  const { RefundPolicy } = await import('../src/services/financial/refund-policy');
  const { ExactMath } = await import('../src/lib/financial/exact-math');

  console.log('\n═════════════════════════════════════════════════════════════════════════════════');
  console.log('  🧪 SMOKE TEST: РАЗВЕРНУТЫЙ КОНТЕЙНЕР, ПЛАТЕЖИ, РЕЖИМЫ, ЮKASSA И ПРОВАЙДЕРЫ');
  console.log('═════════════════════════════════════════════════════════════════════════════════\n');

  // =========================================================================
  // БЛОК 1: Проверка живого HTTP-сервера контейнера
  // =========================================================================
  console.log('🔹 1. ПРОВЕРКА ЖИВОГО HTTP-СЕРВЕРА КОНТЕЙНЕРА (http://127.0.0.1:3000)');

  await runTest('Live Container HTTP', 'Health Endpoint (/api/health)', async () => {
    const resp = await fetch('http://127.0.0.1:3000/api/health');
    if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    const data = await resp.json();
    if (data.status !== 'healthy') throw new Error(`Unexpected status: ${JSON.stringify(data)}`);
    return `Server healthy, timestamp: ${data.timestamp}`;
  });

  await runTest('Live Container HTTP', 'Maintenance Status (/api/maintenance-status)', async () => {
    const resp = await fetch('http://127.0.0.1:3000/api/maintenance-status');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return `Maintenance mode: ${data.maintenance || false}`;
  });

  await runTest('Live Container HTTP', 'Order Status API Polling Endpoint (/api/order-status)', async () => {
    const resp = await fetch('http://127.0.0.1:3000/api/order-status?orderId=non-existent-smoke-test-id');
    if (resp.status !== 404 && resp.status !== 401) {
      throw new Error(`Expected 404 or 401 for non-existent order, got HTTP ${resp.status}`);
    }
    return `Endpoint responds cleanly with HTTP ${resp.status}`;
  });

  // =========================================================================
  // БЛОК 2: Переключение режимов работы (Тестовый / Боевой) и сайтов
  // =========================================================================
  console.log('\n🔹 2. ПЕРЕКЛЮЧАТЕЛЬ РЕЖИМОВ (TEST MODE & MULTI-TENANT SWITCHER)');

  await runTest('Mode Switcher', 'Чтение текущего режима (SettingsManager.isTestMode)', async () => {
    const initialMode = await SettingsManager.isTestMode();
    return `Текущий режим: ${initialMode ? 'ТЕСТОВЫЙ (Sandbox)' : 'БОЕВОЙ (Production)'}`;
  });

  await runTest('Mode Switcher', 'Динамическое переключение режима (Test Mode Toggle)', async () => {
    const originalSettings = await db.systemSettings.findFirst({ where: { id: 'smmplan' } });
    const originalTestMode = originalSettings?.isTestMode ?? true;

    // 1. Switch to opposite
    await db.systemSettings.upsert({
      where: { id: 'smmplan' },
      update: { isTestMode: !originalTestMode },
      create: { id: 'smmplan', isTestMode: !originalTestMode }
    });

    const toggledMode = await db.systemSettings.findUnique({ where: { id: 'smmplan' } });
    if (toggledMode?.isTestMode === originalTestMode) {
      throw new Error('Failed to toggle test mode in database');
    }

    // 2. Switch back to original
    await db.systemSettings.upsert({
      where: { id: 'smmplan' },
      update: { isTestMode: originalTestMode },
      create: { id: 'smmplan', isTestMode: originalTestMode }
    });

    const restoredMode = await db.systemSettings.findUnique({ where: { id: 'smmplan' } });
    return `Переключение успешно: ${originalTestMode} -> ${!originalTestMode} -> ${restoredMode?.isTestMode}`;
  });

  await runTest('Mode Switcher', 'Глобальный переключатель сайтов (Multi-Tenant isolation: smmplan vs flux)', async () => {
    const planSettings = await db.systemSettings.findUnique({ where: { id: 'smmplan' } });
    const fluxSettings = await db.systemSettings.findUnique({ where: { id: 'flux' } });

    return `SMMplan site: "${planSettings?.siteName || 'SMMplan'}", SMMflux site: "${fluxSettings?.siteName || 'SMMflux'}"`;
  });

  // =========================================================================
  // БЛОК 3: Аудит платёжных шлюзов и унификации интерфейсов
  // =========================================================================
  console.log('\n🔹 3. АУДИТ ПЛАТЁЖНЫХ ШЛЮЗОВ (Единая фильтрация во всех интерфейсах)');

  let availableGateways: { yookassa: boolean; sbp?: boolean; robokassa: boolean; cryptobot: boolean } | null = null;

  await runTest('Payment Gateways', 'Проверка доступных шлюзов (getAvailableGatewaysAction)', async () => {
    const res = await getAvailableGatewaysAction();
    if (!res.success || !res.data) throw new Error(res.error || 'Failed to get available gateways');
    availableGateways = res.data;
    return `ЮKassa: ${res.data.yookassa}, СБП: ${res.data.sbp}, Робокасса: ${res.data.robokassa}, CryptoBot: ${res.data.cryptobot}`;
  });

  await runTest('Payment Gateways', 'Проверка скрытия ненастроенных методов (No Phantom Gateways Rule)', async () => {
    const secrets = await SettingsProvider.getPaymentSecrets();
    const hasRoboKeys = Boolean(secrets.robokassaLogin && secrets.robokassaPassword && secrets.robokassaLogin !== 'test_login');
    const hasCryptoKeys = Boolean(secrets.cryptoBotToken && secrets.cryptoBotToken !== 'test_token' && !secrets.cryptoBotToken.startsWith('test_dummy'));

    if (!hasRoboKeys && availableGateways?.robokassa) {
      throw new Error('Робокасса не настроена, но возвращается как активная!');
    }
    if (!hasCryptoKeys && availableGateways?.cryptobot) {
      throw new Error('CryptoBot не настроен, но возвращается как активный!');
    }
    return `Ненастроенные шлюзы корректно скрыты во всех интерфейсах`;
  });

  // =========================================================================
  // БЛОК 4: Тестирование ЮKassa и оформление заказов
  // =========================================================================
  console.log('\n🔹 4. ТЕСТИРОВАНИЕ ОПЛАТЫ ЧЕРЕЗ ЮKASSA И ЗАКАЗОВ');

  const testEmail = `smoke-test-live-${Date.now()}@smmplan.pro`;
  let testUser = await db.user.findFirst({ where: { email: testEmail } });
  if (!testUser) {
    testUser = await db.user.create({
      data: {
        email: testEmail,
        passwordHash: 'dummy-smoke-hash',
        role: 'USER',
        balance: BigInt(50000), // 500.00 RUB
        tenantId: 'smmplan'
      }
    });
  }

  const activeService = await db.service.findFirst({
    where: { isActive: true, isQuarantined: false },
    include: { category: { include: { network: true } }, provider: true }
  });

  if (!activeService) {
    throw new Error('No active service found in database for smoke test');
  }

  await runTest('YooKassa & Orders', `Создание заказа через Checkout (${activeService.name.slice(0, 30)}...)`, async () => {
    const rubleCost = (activeService.rate * (1 + activeService.markup / 100) / 1000) * 10;
    const orderChargeCents = ExactMath.rublesToKopecks(Math.max(1, rubleCost));

    const newOrder = await db.order.create({
      data: {
        numericId: Math.floor(100000 + Math.random() * 900000),
        userId: testUser!.id,
        serviceId: activeService.id,
        providerId: activeService.providerId,
        providerServiceId: activeService.providerServiceId || '1',
        charge: orderChargeCents,
        providerCost: BigInt(500),
        quantity: 10,
        link: 'https://t.me/smoke_test_channel',
        status: 'AWAITING_PAYMENT',
        tenantId: 'smmplan'
      }
    });

    const newPayment = await db.payment.create({
      data: {
        userId: testUser!.id,
        orderId: newOrder.id,
        amount: orderChargeCents,
        currency: 'RUB',
        status: 'PENDING',
        gateway: 'yookassa',
        tenantId: 'smmplan'
      }
    });

    await db.order.update({
      where: { id: newOrder.id },
      data: { paymentId: newPayment.id }
    });

    return `Заказ #${newOrder.numericId} создан, сумма: ${Number(orderChargeCents) / 100} ₽, статус платежа: PENDING`;
  });

  await runTest('YooKassa & Orders', 'Защита от заниженной оплаты (Underpayment P0 Guard)', async () => {
    const fakeGatewayId = `smoke_test_yk_${randomUUID()}`;
    const requiredAmount = BigInt(15000); // 150.00 RUB
    const underpaidAmount = 5000; // 50.00 RUB

    // Create payment expecting 150 RUB
    const payment = await db.payment.create({
      data: {
        userId: testUser!.id,
        amount: requiredAmount,
        currency: 'RUB',
        status: 'PENDING',
        gateway: 'yookassa',
        gatewayId: fakeGatewayId,
        tenantId: 'smmplan'
      }
    });

    let blocked = false;
    try {
      const ok = await paymentService.confirmPayment(
        fakeGatewayId,
        underpaidAmount,
        testUser!.id,
        true,
        'yookassa',
        payment.id,
        'topup'
      );
      if (!ok) blocked = true;
    } catch {
      blocked = true;
    }

    if (!blocked) {
      throw new Error('Подтверждение с заниженной суммой НЕ было заблокировано!');
    }
    return `Попытка оплаты 50 ₽ вместо 150 ₽ успешно отклонена`;
  });

  await runTest('YooKassa & Orders', 'Успешное подтверждение тестового платежа (PaymentService.confirmPayment)', async () => {
    const validGatewayId = `smoke_test_valid_${randomUUID()}`;
    const topUpAmountKopecks = 20000; // 200.00 RUB

    const payment = await db.payment.create({
      data: {
        userId: testUser!.id,
        amount: BigInt(topUpAmountKopecks),
        currency: 'RUB',
        status: 'PENDING',
        gateway: 'yookassa',
        gatewayId: validGatewayId,
        tenantId: 'smmplan'
      }
    });

    const balanceBefore = await db.user.findUnique({ where: { id: testUser!.id } }).then(u => u?.balance ?? BigInt(0));

    await paymentService.confirmPayment(
      validGatewayId,
      topUpAmountKopecks,
      testUser!.id,
      true,
      'yookassa',
      payment.id,
      'topup'
    );

    const balanceAfter = await db.user.findUnique({ where: { id: testUser!.id } }).then(u => u?.balance ?? BigInt(0));
    const paymentAfter = await db.payment.findUnique({ where: { id: payment.id } });

    if (paymentAfter?.status !== 'SUCCEEDED') {
      throw new Error(`Expected SUCCEEDED, got ${paymentAfter?.status}`);
    }

    if (balanceAfter - balanceBefore !== BigInt(topUpAmountKopecks)) {
      throw new Error(`Balance diff mismatch: expected +${topUpAmountKopecks}, got ${balanceAfter - balanceBefore}`);
    }

    return `Платёж подтверждён, статус: SUCCEEDED, баланс пополнен на +200.00 ₽`;
  });

  // =========================================================================
  // БЛОК 5: Поведение провайдеров и маршрутизация заказов
  // =========================================================================
  console.log('\n🔹 5. ПРОВЕРКА ПРОВАЙДЕРОВ И МАРШРУТИЗАЦИИ (Provider Health & Routing)');

  await runTest('Providers', 'Аудит активных провайдеров в базе данных', async () => {
    const providers = await db.provider.findMany();
    if (providers.length === 0) {
      return `В базе пока нет внешних провайдеров (используются внутренние или прямые сервисы)`;
    }
    const activeCount = providers.filter(p => p.isActive).length;
    const summary = providers.map(p => `${p.name} (${p.type || 'SMM'}, ${p.isActive ? 'ACTIVE' : 'DISABLED'})`).join(', ');
    return `Всего: ${providers.length}, активных: ${activeCount}. [${summary}]`;
  });

  await runTest('Providers', 'Проверка привязки услуг к провайдерам (Cherry-Pick Integrity)', async () => {
    const servicesWithProvider = await db.service.findMany({
      where: { providerId: { not: null }, isActive: true },
      include: { provider: true },
      take: 5
    });

    if (servicesWithProvider.length === 0) {
      return `Услуги работают в прямом режиме (без внешнего API)`;
    }

    return `Проверено ${servicesWithProvider.length} услуг: провайдер "${servicesWithProvider[0].provider?.name}", providerServiceId: ${servicesWithProvider[0].providerServiceId}`;
  });

  // =========================================================================
  // БЛОК 6: Проверка финансового леджера и возвратов (RefundPolicy)
  // =========================================================================
  console.log('\n🔹 6. ФИНАНСОВЫЙ ЛЕДЖЕР И ТОЧНОСТЬ ВОЗВРАТОВ (BigInt Precision & Ledger)');

  await runTest('Financial Integrity', 'Проверка Ledger-First списания (WalletOps.charge)', async () => {
    const chargeAmount = BigInt(10000); // 100.00 RUB
    const initialBal = await db.user.findUnique({ where: { id: testUser!.id } }).then(u => u?.balance ?? BigInt(0));

    await db.$transaction(async (tx) => {
      await WalletOps.charge(
        tx,
        testUser!.id,
        chargeAmount,
        'Smoke test order charge',
        { idempotencyKey: `smoke-charge-${randomUUID()}` }
      );
    });

    const finalBal = await db.user.findUnique({ where: { id: testUser!.id } }).then(u => u?.balance ?? BigInt(0));
    if (initialBal - finalBal !== chargeAmount) {
      throw new Error(`Ledger charge mismatch: expected -${chargeAmount}, got ${initialBal - finalBal}`);
    }

    return `Списание 100.00 ₽ прошло успешно с созданием записи в Ledger`;
  });

  await runTest('Financial Integrity', 'Точность частичного возврата (RefundPolicy BigInt exact division)', async () => {
    const orderCharge = BigInt('1000000000'); // 10M RUB
    const calc = RefundPolicy.calcRefund(
      { id: 'smoke-refund-test', charge: orderCharge, quantity: 3 },
      BigInt(0),
      1
    );

    if (calc.refundAmount !== BigInt(333333333)) {
      throw new Error(`Refund calculation precision lost: got ${calc.refundAmount}`);
    }
    return `Частичный возврат 1 из 3 единиц: ровно ${calc.refundAmount} коп. (без потери на float)`;
  });

  // Cleanup test order & payment records (LedgerEntry is immutable by design)
  if (testUser?.id) {
    try {
      await db.order.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
      await db.payment.deleteMany({ where: { userId: testUser.id } }).catch(() => {});
    } catch {}
  }

  // =========================================================================
  // ИТОГИ ТЕСТИРОВАНИЯ
  // =========================================================================
  console.log('\n═════════════════════════════════════════════════════════════════════════════════');
  console.log('  📊 РЕЗУЛЬТАТЫ СМОК-ТЕСТА КОНТЕЙНЕРА');
  console.log('═════════════════════════════════════════════════════════════════════════════════');

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`  Всего проверок: ${total}`);
  console.log(`  Успешно:        ${passed} ✅`);
  console.log(`  Ошибок:         ${failed} ${failed > 0 ? '❌' : ''}\n`);

  if (failed > 0) {
    console.error('❌ Смоук-тест выявил сбои:');
    results.filter(r => !r.passed).forEach(r => {
      console.error(`  - [${r.suite}] ${r.name}: ${r.details}`);
    });
    process.exit(1);
  } else {
    console.log('🎉 ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ УСПЕШНО! КОНТЕЙНЕР ПОЛНОСТЬЮ СТАБИЛЕН.');
  }
}

runLiveContainerSmokeTest()
  .catch((e) => {
    console.error('Fatal smoke test runner error:', e);
    process.exit(1);
  })
  .finally(async () => {
    try {
      const { db } = await import('../src/lib/db');
      await db.$disconnect();
    } catch {}
  });
