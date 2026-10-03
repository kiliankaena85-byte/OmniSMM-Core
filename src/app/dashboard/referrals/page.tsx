import { verifySession } from '@/lib/session';
import { getBaseUrlAsync } from '@/utils/get-base-url';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import { ReferralUi } from './referral-ui';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Партнёрская программа | SMMplan',
  description: 'Приглашайте клиентов и получайте до 15% пожизненных комиссионных от каждого их заказа.',
};

export default async function ReferralsPage() {
  const session = await verifySession();
  if (!session) redirect('/login');

  let user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      referralCode: true,
      referralBalance: true,
      totalSpent: true,
      _count: { select: { referrals: true } },
    },
  });

  if (!user) redirect('/login');

  // Auto-generate referral code if missing
  if (!user.referralCode) {
    const newCode = Array.from(
      Array(8),
      () => Math.floor(Math.random() * 36).toString(36)
    ).join('').toUpperCase();

    user = await db.user.update({
      where: { id: user.id },
      data: { referralCode: newCode },
      select: {
        id: true,
        referralCode: true,
        referralBalance: true,
        totalSpent: true,
        _count: { select: { referrals: true } },
      },
    });
  }

  // Fetch recent referrals and commissions
  const [commissions, referralsList] = await Promise.all([
    db.commission.findMany({
      where: { referrerId: session.userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
      },
    }),
    db.user.findMany({
      where: { referredById: session.userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        email: true,
        createdAt: true,
      },
    }),
  ]);

  // Build referral link server-side
  const origin = await getBaseUrlAsync();
  const referralLink = `${origin}/?ref=${user.referralCode}`;

  const earnedRub = Number(user.referralBalance ?? BigInt(0)) / 100;
  const referralsCount = user._count?.referrals ?? 0;
  const totalSpentRub = Number(user.totalSpent ?? 0) / 100;

  // Mask emails for privacy (e.g. us***@gmail.com)
  const maskedReferrals = referralsList.map((r) => {
    const parts = r.email.split('@');
    const name = parts[0] || 'user';
    const domain = parts[1] || 'mail.com';
    const maskedName = name.length > 3 ? `${name.slice(0, 2)}***${name.slice(-1)}` : `${name.slice(0, 1)}***`;
    return {
      id: r.id,
      emailMasked: `${maskedName}@${domain}`,
      createdAt: r.createdAt.toISOString(),
    };
  });

  const serializedCommissions = commissions.map((c) => ({
    id: c.id,
    amountRub: Number(c.amount) / 100,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-foreground tracking-tight">
          Партнёрская программа
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Приглашайте друзей, коллег и клиентов, получая до 15% с каждого пополнения и заказа
        </p>
      </div>

      <ReferralUi
        referralCode={user.referralCode || ''}
        referralLink={referralLink}
        referralsCount={referralsCount}
        earnedRub={earnedRub}
        totalSpentRub={totalSpentRub}
        recentReferrals={maskedReferrals}
        recentCommissions={serializedCommissions}
      />
    </div>
  );
}
