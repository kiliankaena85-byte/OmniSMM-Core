import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import Link from 'next/link';
import { ClientDetailClient } from './client-detail-client';
import { banUserAction, unbanUserAction, loginAsAction, adminDeleteUserAction } from '@/actions/admin/users';
import { SubmitButton } from '@/components/admin/submit-button';
import { ActionForm } from '@/components/admin/action-form';
import { ClientOrdersTable } from './client-orders-table';
import { formatBalance } from '@/lib/utils';
import { verifySession } from '@/lib/session';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const STATUS_COLORS: Record<string, string> = {
  PENDING:    'bg-warning/20  text-amber-700',
  PROCESSING: 'bg-blue-100   text-blue-700',
  COMPLETED:  'bg-success/20 text-emerald-700',
  FAILED:     'bg-destructive/20   text-rose-700',
  CANCELLED:  'bg-muted  text-muted-foreground',
  PARTIAL:    'bg-orange-100 text-orange-700',
};

const ROLE_BADGE: Record<string, string> = {
  OWNER:   'bg-primary/10 text-primary border border-primary/20 shadow-xs tracking-tight',
  ADMIN:   'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shadow-xs tracking-tight',
  MANAGER: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shadow-xs tracking-tight',
  SUPPORT: 'bg-muted text-muted-foreground border border-border shadow-xs tracking-tight',
  USER:    'bg-muted text-foreground border border-border shadow-xs tracking-tight',
  BANNED:  'bg-destructive/10 text-destructive border border-destructive/20 shadow-xs tracking-tight',
};

type Props = { params: Promise<{ id: string }> };

import { enforceSectionAccess } from '@/lib/server/rbac';

export default async function ClientDetailPage({ params }: Props) {
  await enforceSectionAccess('clients');
  const session = await verifySession();
  const currentUser = session ? await db.user.findUnique({ 
    where: { id: session.userId },
    select: { id: true, role: true, tenantId: true, allowedTenants: true }
  }) : null;

  const isOwner = currentUser?.role === 'OWNER';
  // SUPPORT can see client finances — they need balance/LTV to assist clients effectively
  const canSeeFinances = !!currentUser;

  const { id } = await params;

  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      tenantId: true,
      balance: true,
      quarantineBalance: true,
      totalSpent: true,
      personalDiscount: true,
      discountEndsAt: true,
      adminNote: true,
      adminNoteUpdatedAt: true,
      adminNoteUpdatedBy: true,
      telegramId: true,
      apiKeyHash: true,
      referralCode: true,
      referralBalance: true,
      companyName: true,
      inn: true,
      kpp: true,
      legalAddress: true,
      apiConfig: {
        select: {
          isApiEnabled: true,
          prioritySupport: true,
          webhookUrl: true,
        },
      },
      createdAt: true,
    },
  });

  if (!user) notFound();

  // Cross-tenant IDOR Protection: non-OWNER can only view clients from their authorized tenant(s)
  if (currentUser?.role !== 'OWNER') {
    const { isTenantAllowedForUser } = await import('@/utils/admin-tenant');
    const targetTenant = user.tenantId || 'smmplan';
    if (!isTenantAllowedForUser(currentUser, targetTenant)) {
      notFound();
    }
  }

  const [orders, payments, countResult, loginLogs, rawLedgerEntries, rawSummary, rawNotes] = await Promise.all([
    db.order.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true,
        numericId: true,
        status: true,
        quantity: true,
        charge: true,
        createdAt: true,
        service: { select: { name: true } },
      },
    }),
    db.payment.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        gateway: true,
        gatewayId: true,
        receiptId: true,
        refundReceiptId: true,
        createdAt: true,
      },
    }),
    db.user.findUnique({
      where: { id },
      select: {
        _count: { select: { orders: true, tickets: true, payments: true } },
      },
    }),
    db.loginLog.findMany({
      where: {
        OR: [
          { userId: user.id },
          {
            email: user.email,
            tenantId: user.tenantId || 'smmplan',
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        success: true,
        failReason: true,
        createdAt: true,
      },
    }),
    db.ledgerEntry.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        amount: true,
        reason: true,
        status: true,
        transactionType: true,
        adminId: true,
        createdAt: true,
      },
    }),
    db.ledgerEntry.groupBy({
      by: ['transactionType'],
      where: { userId: id },
      _sum: { amount: true },
    }),
    db.userNote.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        author: { select: { email: true } }
      }
    })
  ]);

  // Map admin emails for ledger
  const adminIds = Array.from(new Set(rawLedgerEntries.map(e => e.adminId).filter(Boolean))) as string[];
  const admins = adminIds.length > 0 ? await db.user.findMany({
    where: { id: { in: adminIds } },
    select: { id: true, email: true }
  }) : [];
  const adminMap = new Map(admins.map(a => [a.id, a.email]));

  let totalDepositedKopecks = BigInt(0);
  let totalSpentKopecks = BigInt(0);
  let totalRefundedKopecks = BigInt(0);
  let totalAdjustedKopecks = BigInt(0);

  for (const group of rawSummary) {
    const sum = group._sum.amount ?? BigInt(0);
    const type = group.transactionType;

    if (type === 'TOPUP' || (type === 'PAYMENT' && sum > BigInt(0))) {
      totalDepositedKopecks += sum;
    } else if (type === 'ORDER_CHARGE' || type === 'REROUTE') {
      totalSpentKopecks += (sum < BigInt(0) ? -sum : sum);
    } else if (type === 'REFUND' || type === 'ORDER_CANCEL') {
      totalRefundedKopecks += (sum > BigInt(0) ? sum : -sum);
    } else if (type === 'ADJUSTMENT' || type === 'COMPENSATION') {
      totalAdjustedKopecks += sum;
    } else if (sum > BigInt(0)) {
      totalDepositedKopecks += sum;
    } else if (sum < BigInt(0)) {
      totalSpentKopecks += -sum;
    }
  }

  const initialLedgerEntries = rawLedgerEntries.map(e => ({
    id: e.id,
    amountRub: Math.abs(Number(e.amount) / 100),
    amountCents: Number(e.amount),
    direction: e.amount >= BigInt(0) ? ('INCOME' as const) : ('EXPENSE' as const),
    reason: e.reason,
    status: e.status,
    transactionType: e.transactionType,
    adminEmail: e.adminId ? (adminMap.get(e.adminId) || 'Оператор') : null,
    createdAt: e.createdAt.toISOString(),
  }));

  const initialLedgerSummary = {
    totalDepositedRub: Number(totalDepositedKopecks) / 100,
    totalSpentRub: Number(totalSpentKopecks) / 100,
    totalRefundedRub: Number(totalRefundedKopecks) / 100,
    totalAdjustedRub: Number(totalAdjustedKopecks) / 100,
  };

  const initialNotes = rawNotes.map(n => ({
    id: n.id,
    userId: n.userId,
    content: n.content,
    authorEmail: n.author?.email || 'Оператор',
    createdAt: n.createdAt.toISOString(),
  }));

  // If user has a legacy adminNote but no UserNotes yet, include it
  if (initialNotes.length === 0 && user.adminNote) {
    initialNotes.push({
      id: 'legacy-note',
      userId: user.id,
      content: user.adminNote,
      authorEmail: user.adminNoteUpdatedBy || 'Оператор',
      createdAt: (user.adminNoteUpdatedAt || user.createdAt).toISOString(),
    });
  }

  const ordersCount = countResult?._count.orders ?? 0;
  const ticketsCount = countResult?._count.tickets ?? 0;
  const paymentsCount = countResult?._count.payments ?? 0;

  // Safe DTO — only send what the UI needs (no raw DB object)
  const dto = {
    id: user.id,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId || 'smmplan',
    personalDiscount: user.personalDiscount,
    discountEndsAt: user.discountEndsAt?.toISOString() ?? null,
    adminNote: user.adminNote ?? '',
    adminNoteUpdatedAt: user.adminNoteUpdatedAt?.toISOString() ?? null,
    adminNoteUpdatedBy: user.adminNoteUpdatedBy ?? null,
    telegramId: user.telegramId ?? null,
    referralCode: user.referralCode ?? null,
    companyName: user.companyName ?? '',
    inn: user.inn ?? '',
    kpp: user.kpp ?? '',
    legalAddress: user.legalAddress ?? '',
    apiConfig: user.apiConfig ? {
      isApiEnabled: user.apiConfig.isApiEnabled,
      prioritySupport: user.apiConfig.prioritySupport,
      webhookUrl: user.apiConfig.webhookUrl ?? '',
    } : null,
    createdAt: user.createdAt.toISOString(),
    ordersCount,
    ticketsCount,
    paymentsCount,
    ...(canSeeFinances ? {
      balance: Number(user.balance),
      quarantineBalance: Number(user.quarantineBalance),
      totalSpent: Number(user.totalSpent),
      referralBalance: Number(user.referralBalance),
    } : {}),
  };

  const ordersDto = orders.map(o => ({
    id: o.id,
    numericId: o.numericId,
    status: o.status,
    quantity: o.quantity,
    chargeRub: Number(o.charge) / 100,
    serviceName: o.service?.name || 'Услуга',
    createdAt: o.createdAt.toISOString(),
  }));

  const paymentsDto = payments.map(p => ({
    id: p.id,
    amountRub: (Number(p.amount) / 100),
    amountCents: Number(p.amount),
    currency: p.currency,
    status: p.status,
    gateway: p.gateway,
    gatewayId: p.gatewayId ?? null,
    receiptId: p.receiptId ?? null,
    refundReceiptId: p.refundReceiptId ?? null,
    createdAt: p.createdAt.toISOString(),
  }));

  const logsDto = loginLogs.map(log => ({
    id: log.id,
    ipAddress: log.ipAddress,
    userAgent: log.userAgent ?? 'Unknown',
    success: log.success,
    failReason: log.failReason,
    createdAt: log.createdAt.toISOString(),
  }));

  const roleBadge = ROLE_BADGE[user.role] ?? 'bg-muted text-foreground';

  return (
    <div className="space-y-6 pb-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin/clients" className="hover:text-foreground transition-colors">← Клиенты</Link>
        <span>/</span>
        <span className="text-foreground font-medium truncate max-w-[300px]">{user.email}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold text-foreground">{user.email}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${roleBadge}`}>
              {user.role}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-2 flex items-center gap-2 flex-wrap">
            <span>ID: <code className="font-mono tracking-tight text-xs bg-muted/50 border border-border/40 shadow-sm px-1.5 py-0.5 rounded">{user.id}</code></span>
            {user.telegramId && (
              <>
                <span className="text-border">·</span>
                <span>TG: <code className="font-mono tracking-tight text-xs bg-muted/50 border border-border/40 shadow-sm px-1.5 py-0.5 rounded">{user.telegramId}</code></span>
              </>
            )}
            {user.referralCode && (
              <>
                <span className="text-border">·</span>
                <span>Реф: <code className="font-mono tracking-tight text-xs bg-violet-100 text-violet-800 border border-violet-200 px-1.5 py-0.5 rounded">{user.referralCode}</code></span>
              </>
            )}
            <span className="text-border">·</span>
            <span className="tabular-nums tracking-tight">Зарегистрирован {new Date(user.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </p>
        </div>

        {/* Quick actions */}
        <div className="flex gap-2 flex-wrap">
          {(isOwner || currentUser?.role === 'ADMIN') && (
            <ActionForm action={loginAsAction}>
              <input type="hidden" name="userId" value={user.id} />
              <SubmitButton variant="outline" className="text-xs h-9 gap-1.5 shadow-sm active:scale-95 transition-all">
                🔑 Войти как клиент
              </SubmitButton>
            </ActionForm>
          )}
          {(isOwner || currentUser?.role === 'ADMIN' || currentUser?.role === 'SUPPORT') && (
            user.role === 'BANNED' ? (
              <ActionForm action={unbanUserAction}>
                <input type="hidden" name="userId" value={user.id} />
                <SubmitButton
                  variant="outline"
                  className="text-xs h-9 text-emerald-700 border-emerald-300 hover:bg-success/10 shadow-sm active:scale-95 transition-all"
                  confirmMessage="Снять блокировку?"
                >
                  ✅ Разбанить
                </SubmitButton>
              </ActionForm>
            ) : (
              <ActionForm action={banUserAction}>
                <input type="hidden" name="userId" value={user.id} />
                <SubmitButton
                  variant="outline"
                  className="text-xs h-9 text-destructive border-rose-300 hover:bg-destructive/10 shadow-sm active:scale-95 transition-all"
                  confirmMessage="Забанить клиента? Он потеряет доступ к сервису."
                >
                  🚫 Забанить
                </SubmitButton>
              </ActionForm>
            )
          )}
          {(isOwner || currentUser?.role === 'ADMIN') && (
            <ActionForm action={adminDeleteUserAction}>
              <input type="hidden" name="userId" value={user.id} />
              <SubmitButton
                variant="outline"
                className="text-xs h-9 text-destructive border-rose-300 hover:bg-destructive/10 shadow-sm active:scale-95 transition-all"
                confirmMessage="Удалить профиль пользователя? Это действие необратимо (Soft Delete)."
              >
                🗑️ Удалить профиль
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Баланс', value: canSeeFinances ? formatBalance(user.balance) : '🔒 *** ₽', accent: 'text-foreground', note: (canSeeFinances && user.quarantineBalance > 0) ? `🔒 ${formatBalance(user.quarantineBalance)} эскроу` : null },
          { label: 'LTV (Потрачено)', value: canSeeFinances ? formatBalance(user.totalSpent) : '🔒 *** ₽', accent: 'text-success', note: 'Заказы − Возвраты' },
          { label: 'Заказов', value: ordersCount.toString(), accent: 'text-foreground', note: `${ticketsCount} тикетов` },
          { label: user.referralBalance < BigInt(0) ? 'Реф. долг' : 'Реф. баланс', value: canSeeFinances ? formatBalance(user.referralBalance) : '🔒 *** ₽', accent: user.referralBalance < BigInt(0) ? 'text-amber-600' : 'text-violet-600', note: user.referralBalance < BigInt(0) ? 'Отзыв комиссии — гасится будущими начислениями' : (user.referralCode ? `Код: ${user.referralCode}` : 'Нет кода') },
        ].map(s => (
          <div key={s.label} className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm rounded-2xl p-5 transition-all hover:shadow-md hover:border-border flex flex-col justify-between">
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-1">{s.label}</div>
            <div className={`text-xl font-bold tabular-nums text-right tracking-tight font-mono ${s.accent}`}>{s.value}</div>
            {s.note && <div className="text-[10px] text-muted-foreground text-right mt-1.5 font-medium">{s.note}</div>}
          </div>
        ))}
      </div>

      {/* Interactive client panel */}
      <ClientDetailClient 
        user={dto} 
        loginLogs={logsDto} 
        payments={paymentsDto} 
        orders={ordersDto} 
        ledgerEntries={initialLedgerEntries}
        ledgerSummary={initialLedgerSummary}
        initialNotes={initialNotes}
        canSeeFinances={canSeeFinances} 
        operatorRole={currentUser?.role} 
      />

      {/* Recent orders */}
      <div className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm rounded-2xl overflow-hidden ring-1 ring-border/5 flex flex-col">
        <div className="px-5 py-4 border-b border-border/60 bg-muted/20">
          <h2 className="text-sm font-bold tracking-tight text-foreground">Последние заказы</h2>
        </div>
        <div className="w-full overflow-x-auto scrollbar-hide">
          <ClientOrdersTable orders={orders} />
        </div>
        {ordersCount > 15 && (
          <div className="px-5 py-3 border-t border-border/60 bg-muted/10">
            <Link href={`/admin/orders?userId=${user.id}`} className="text-xs font-semibold text-primary hover:underline transition-colors">
              Показать все {ordersCount} заказов →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
