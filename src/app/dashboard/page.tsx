import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { getBaseUrlAsync } from '@/utils/get-base-url';

import { headers } from 'next/headers';

import { getPublicCatalogAction } from '@/actions/order/catalog';
import { getTenantDashboardViews } from '@/tenants/factory';

export const dynamic = 'force-dynamic';

import { resolveTenantFromRequest } from '@/lib/tenant-resolver-edge';

export default async function DashboardPage(props: { searchParams?: Promise<{ tenant?: string }> }) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const searchParams = await props.searchParams;
  const reqHeaders = await headers();
  const tenantId = resolveTenantFromRequest(reqHeaders);

  const session = await verifySession(tenantId);
  if (!session) redirect('/login');

  const [
    user,
    orders,
    referralCount,
    activeOrders,
    pendingPaymentsCount,
    catalogResult,
    origin,
    tenantViews,
  ] = await Promise.all([
    db.user.findFirst({
      where: { id: session.userId, tenantId },
      select: {
        email: true,
        balance: true,
        totalSpent: true,
        referralCode: true,
        createdAt: true,
        tenantId: true,
      },
    }),
    db.order.findMany({
      where: { userId: session.userId, tenantId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        numericId: true,
        status: true,
        charge: true,
        quantity: true,
        link: true,
        serviceId: true,
        createdAt: true,
        service: { select: { name: true, categoryId: true } },
      },
    }),
    db.user.count({ where: { referredById: session.userId, tenantId } }),
    db.order.count({
      where: { userId: session.userId, tenantId, status: { in: ['IN_PROGRESS', 'PENDING', 'PROVISIONING'] } },
    }),
    db.payment.count({
      where: { userId: session.userId, tenantId, status: 'PENDING', gateway: 'yookassa' },
    }),
    getPublicCatalogAction(tenantId),
    getBaseUrlAsync(),
    getTenantDashboardViews(tenantId),
  ]);

  if (!user) redirect('/login');

  const hasPendingPayments = pendingPaymentsCount > 0;
  const { HomeView } = tenantViews;
  const catalog = catalogResult.success && catalogResult.data ? catalogResult.data : [];

  const userForClient = {
    email: user.email,
    balance: user.balance ?? BigInt(0),
    balanceCents: Number(user.balance ?? 0),
    totalSpent: Number(user.totalSpent ?? 0),
    referralCode: user.referralCode,
    createdAt: user.createdAt,
    tenantId: user.tenantId,
  };

  const serializedOrders = orders.map(order => ({
    id: order.id,
    numericId: order.numericId,
    status: order.status,
    charge: Number(order.charge ?? 0),
    chargeCents: Number(order.charge ?? 0),
    quantity: order.quantity,
    createdAt: order.createdAt,
    service: order.service,
    // FIX(REPEAT): данные для кнопки «Повторить» (контракт reorder*)
    serviceId: order.serviceId,
    link: order.link,
  }));

  return (
    <HomeView
      user={userForClient}
      orders={serializedOrders}
      referralCount={referralCount}
      activeOrders={activeOrders}
      hasPendingPayments={hasPendingPayments}
      origin={origin}
      initialCatalog={catalog}
    />
  );
}
