'use client';

import { useState, useTransition, useMemo } from 'react';
import {
  Copy,
  Gift,
  Users,
  CreditCard,
  CheckCheck,
  QrCode,
  Send,
  Sparkles,
  TrendingUp,
  Award,
  ArrowRight,
  ShieldCheck,
  Share2,
  Download,
  ExternalLink,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { transferReferralBalanceAction } from '@/actions/user/referral.action';
import { useRouter } from 'next/navigation';

export interface ReferralTier {
  level: number;
  name: string;
  percent: number;
  minReferrals: number;
  minLtvRub: number;
  badge: string;
}

export const REFERRAL_TIERS: ReferralTier[] = [
  { level: 1, name: 'Старт', percent: 5, minReferrals: 0, minLtvRub: 0, badge: '5%' },
  { level: 2, name: 'Партнёр', percent: 7, minReferrals: 3, minLtvRub: 10000, badge: '7%' },
  { level: 3, name: 'Профи', percent: 10, minReferrals: 10, minLtvRub: 30000, badge: '10%' },
  { level: 4, name: 'VIP Лидер', percent: 15, minReferrals: 25, minLtvRub: 50000, badge: '15%' },
];

export function calculateReferralTier(referralsCount: number, totalSpentRub: number): {
  currentTier: ReferralTier;
  nextTier: ReferralTier | null;
  progressPercent: number;
  refsNeeded: number;
} {
  let currentTier = REFERRAL_TIERS[0];

  for (let i = REFERRAL_TIERS.length - 1; i >= 0; i--) {
    const tier = REFERRAL_TIERS[i];
    if (referralsCount >= tier.minReferrals || totalSpentRub >= tier.minLtvRub) {
      currentTier = tier;
      break;
    }
  }

  const nextTierIndex = REFERRAL_TIERS.findIndex((t) => t.level === currentTier.level + 1);
  const nextTier = nextTierIndex !== -1 ? REFERRAL_TIERS[nextTierIndex] : null;

  let progressPercent = 100;
  let refsNeeded = 0;

  if (nextTier) {
    const currentBase = currentTier.minReferrals;
    const target = nextTier.minReferrals;
    const countInTier = Math.max(0, referralsCount - currentBase);
    const range = target - currentBase;
    progressPercent = Math.min(100, Math.max(0, Math.round((countInTier / range) * 100)));
    refsNeeded = Math.max(0, target - referralsCount);
  }

  return { currentTier, nextTier, progressPercent, refsNeeded };
}

export function ReferralUi({
  referralCode,
  referralLink,
  referralsCount,
  earnedRub,
  totalSpentRub,
  recentReferrals = [],
  recentCommissions = [],
}: {
  referralCode: string;
  referralLink: string;
  referralsCount: number;
  earnedRub: number;
  totalSpentRub: number;
  recentReferrals?: Array<{ id: string; emailMasked: string; createdAt: string }>;
  recentCommissions?: Array<{ id: string; amountRub: number; status: string; createdAt: string }>;
}) {
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [isTransferring, startTransition] = useTransition();
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferSuccess, setTransferSuccess] = useState<string | null>(null);
  const router = useRouter();
  // INV-REF-01: negative referralBalance = clawback debt repaid from future commissions
  const isReferralDebt = earnedRub < 0;

  // Calculator state
  const [calcReferrals, setCalcReferrals] = useState(10);
  const [calcAvgCheck, setCalcAvgCheck] = useState(3000);

  const { currentTier, nextTier, progressPercent, refsNeeded } = useMemo(
    () => calculateReferralTier(referralsCount, totalSpentRub),
    [referralsCount, totalSpentRub]
  );

  const estimatedMonthlyEarnings = useMemo(() => {
    return Math.round(calcReferrals * calcAvgCheck * (currentTier.percent / 100));
  }, [calcReferrals, calcAvgCheck, currentTier.percent]);

  const handleTransfer = () => {
    if (earnedRub <= 0) return;
    setTransferError(null);
    setTransferSuccess(null);

    startTransition(async () => {
      try {
        const res = await transferReferralBalanceAction();
        if (res.success && res.amount !== undefined) {
          setTransferSuccess(`Успешно переведено ${(res.amount / 100).toFixed(2)} ₽ на основной баланс!`);
          router.refresh();
        } else {
          setTransferError(res.error || 'Ошибка перевода средств');
        }
      } catch (e: unknown) {
        setTransferError(e instanceof Error ? e.message : 'Ошибка перевода средств');
      }
    });
  };

  const copyToClipboard = async (text: string, type: 'link' | 'code') => {
    try {
      await navigator.clipboard.writeText(text);
      if (type === 'link') {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
      }
    } catch {}
  };

  const shareTelegram = () => {
    const text = `Продвигай каналы и соцсети по лучшим API-ценам на SMMplan: ${referralLink}`;
    window.open(`https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(text)}`, '_blank');
  };

  const shareVk = () => {
    window.open(`https://vk.com/share.php?url=${encodeURIComponent(referralLink)}`, '_blank');
  };

  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(referralLink)}`;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* 1. Hero Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[
          {
            icon: Users,
            label: 'Приглашено',
            value: referralsCount,
            suffix: 'чел.',
            color: 'text-primary bg-primary/10 border-primary/20',
          },
          {
            icon: Award,
            label: 'Ваш уровень',
            value: `${currentTier.percent}%`,
            suffix: currentTier.name,
            color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20',
          },
          {
            icon: CreditCard,
            label: isReferralDebt ? 'Задолженность' : 'Доступно к переводу',
            value: isReferralDebt
              ? `−${Math.abs(earnedRub).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}`
              : earnedRub.toLocaleString('ru-RU', { minimumFractionDigits: 2 }),
            suffix: '₽',
            color: isReferralDebt
              ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20'
              : 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
          },
          {
            icon: TrendingUp,
            label: 'Потенциал дохода',
            value: `${estimatedMonthlyEarnings.toLocaleString('ru-RU')}`,
            suffix: '₽/мес',
            color: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
          },
        ].map(({ icon: Icon, label, value, suffix, color }) => (
          <div
            key={label}
            className="bg-card border border-border/70 rounded-3xl p-5 flex flex-col justify-between shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                {label}
              </span>
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center border ${color}`}>
                <Icon className="w-4 h-4" />
              </div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-black text-foreground tabular-nums tracking-tight">
                {value}
                <span className="text-xs sm:text-sm font-bold text-muted-foreground ml-1.5">
                  {suffix}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 2. Referral Tier Progress Bar */}
      <div className="bg-card border border-border/70 rounded-3xl p-6 sm:p-7 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <h2 className="text-lg font-black text-foreground">Прогресс партнёрского уровня</h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Увеличивайте ставку комиссии от 5% до 15% за счёт приглашённых пользователей
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-muted-foreground">Текущий статус:</span>
            <span className="px-3 py-1 bg-primary/10 text-primary border border-primary/20 rounded-full text-xs font-black">
              Уровень {currentTier.level}: {currentTier.name} ({currentTier.percent}%)
            </span>
          </div>
        </div>

        {/* Multi-step Visual Bar */}
        <div className="space-y-4">
          <div className="relative pt-2 pb-6">
            {/* Background Line */}
            <div className="absolute top-6 left-0 right-0 h-2 bg-secondary rounded-full -translate-y-1/2" />
            {/* Active Progress Line */}
            <div
              className="absolute top-6 left-0 h-2 bg-gradient-to-r from-primary to-indigo-500 rounded-full -translate-y-1/2 transition-all duration-500"
              style={{
                width: `${Math.max(
                  5,
                  ((currentTier.level - 1) / (REFERRAL_TIERS.length - 1)) * 100 +
                    (nextTier ? (progressPercent / (REFERRAL_TIERS.length - 1)) : 0)
                )}%`,
              }}
            />

            {/* Checkpoints */}
            <div className="relative flex justify-between">
              {REFERRAL_TIERS.map((tier) => {
                const isReached = referralsCount >= tier.minReferrals || totalSpentRub >= tier.minLtvRub;
                const isCurrent = currentTier.level === tier.level;

                return (
                  <div key={tier.level} className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs border-2 transition-all ${
                        isCurrent
                          ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/30 scale-110'
                          : isReached
                          ? 'bg-primary/20 text-primary border-primary'
                          : 'bg-card text-muted-foreground border-border'
                      }`}
                    >
                      {tier.percent}%
                    </div>
                    <span className={`text-[11px] font-bold mt-2 ${isCurrent ? 'text-primary' : 'text-foreground'}`}>
                      {tier.name}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {tier.minReferrals === 0 ? 'Старт' : `от ${tier.minReferrals} чел.`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Upgrade Tip */}
          {nextTier ? (
            <div className="bg-secondary/60 border border-border/70 rounded-2xl p-4 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary shrink-0" />
                <span>
                  Пригласите ещё <strong className="text-foreground font-black">{refsNeeded} чел.</strong> для перехода на{' '}
                  <strong className="text-primary font-black">Уровень {nextTier.level} ({nextTier.percent}%)</strong>
                </span>
              </div>
              <span className="text-xs font-mono font-bold text-muted-foreground hidden sm:inline">
                {progressPercent}% пройдено
              </span>
            </div>
          ) : (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-400 rounded-2xl p-4 flex items-center gap-2 text-xs font-bold">
              <Award className="w-4 h-4 shrink-0" />
              <span>Поздравляем! Вы достигли максимального уровня VIP Лидер (15% пожизненно).</span>
            </div>
          )}
        </div>
      </div>

      {/* 3. Instant Transfer to Main Balance Card */}
      {earnedRub > 0 && (
        <div className="bg-gradient-to-r from-emerald-500/10 via-primary/10 to-indigo-500/10 border border-emerald-500/30 rounded-3xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h3 className="text-base font-black text-foreground">
                Доступно к моментальному выводу на баланс
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Зачисляет <strong className="text-foreground font-bold">{earnedRub.toFixed(2)} ₽</strong> на основной баланс для оплаты любых заказов платформы.
            </p>
            {transferError && <p className="text-xs font-bold text-destructive mt-1">{transferError}</p>}
            {transferSuccess && <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-1">{transferSuccess}</p>}
          </div>

          <button
            type="button"
            onClick={handleTransfer}
            disabled={isTransferring || earnedRub <= 0}
            className="shrink-0 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-primary-foreground font-bold text-sm rounded-2xl shadow-md shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
          >
            <CreditCard className="w-4 h-4" />
            <span>{isTransferring ? 'Перевод...' : `Перевести ${earnedRub.toFixed(2)} ₽`}</span>
          </button>
        </div>
      )}

      {/* 3b. Referral debt notice (INV-REF-01: clawback after a cancelled order) */}
      {isReferralDebt && (
        <div role="status" className="bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-300 rounded-3xl p-5 flex items-start gap-3 text-sm">
          <CreditCard className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <p>
            Задолженность <strong className="font-black tabular-nums">−{Math.abs(earnedRub).toFixed(2)} ₽</strong> возникла из-за отмены оплаченного заказа приглашённого клиента.
            Она погасится автоматически из ваших будущих начислений — основной баланс не затрагивается.
          </p>
        </div>
      )}

      {/* 4. Referral Link & Social Sharing Hub */}
      <div className="bg-card border border-border/70 rounded-3xl p-6 sm:p-7 shadow-sm space-y-5">
        <div>
          <h3 className="text-base font-black text-foreground">Ваша реферальная ссылка</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Делитесь ссылкой в соцсетях, блогах или отправляйте напрямую клиентам
          </p>
        </div>

        {/* Link Input & Copy */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1 min-w-0 bg-secondary/80 rounded-2xl px-4 py-3.5 text-xs sm:text-sm font-mono text-foreground truncate border border-border flex items-center justify-between gap-2">
            <span className="truncate">{referralLink}</span>
          </div>

          <button
            type="button"
            onClick={() => copyToClipboard(referralLink, 'link')}
            aria-label="Скопировать реферальную ссылку"
            className={`shrink-0 px-5 py-3.5 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer ${
              copiedLink
                ? 'bg-emerald-500 text-primary-foreground shadow-md shadow-emerald-500/20'
                : 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-md shadow-primary/20'
            }`}
          >
            {copiedLink ? (
              <>
                <CheckCheck className="w-4 h-4" />
                <span>Ссылка скопирована!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Скопировать ссылку</span>
              </>
            )}
          </button>
        </div>

        {/* Quick Actions / Sharing Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          {/* Copy Promo Code */}
          <button
            type="button"
            onClick={() => copyToClipboard(referralCode, 'code')}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-secondary/60 hover:bg-secondary border border-border text-xs font-bold text-foreground transition-all cursor-pointer"
          >
            {copiedCode ? <CheckCheck className="w-4 h-4 text-emerald-500" /> : <Gift className="w-4 h-4 text-primary" />}
            <span>{copiedCode ? 'Код скопирован!' : `Код: ${referralCode}`}</span>
          </button>

          {/* Telegram Share */}
          <button
            type="button"
            onClick={shareTelegram}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-600 dark:text-sky-400 text-xs font-bold transition-all cursor-pointer"
          >
            <Send className="w-4 h-4" />
            <span>В Telegram</span>
          </button>

          {/* VK Share */}
          <button
            type="button"
            onClick={shareVk}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-600 dark:text-blue-400 text-xs font-bold transition-all cursor-pointer"
          >
            <Share2 className="w-4 h-4" />
            <span>ВКонтакте</span>
          </button>

          {/* QR Code Trigger */}
          <button
            type="button"
            onClick={() => setShowQrModal(true)}
            className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 text-xs font-bold transition-all cursor-pointer"
          >
            <QrCode className="w-4 h-4" />
            <span>QR-код</span>
          </button>
        </div>
      </div>

      {/* 5. Interactive Partner Earnings Calculator */}
      <div className="bg-card border border-border/70 rounded-3xl p-6 sm:p-7 shadow-sm space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-foreground flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
              Калькулятор партнёрского дохода
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Рассчитайте потенциальную ежемесячную прибыль по вашей ставке {currentTier.percent}%
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <div className="space-y-4">
            {/* Slider 1: Referrals count */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-muted-foreground">Активных клиентов:</span>
                <span className="text-foreground font-mono">{calcReferrals} чел.</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={calcReferrals}
                onChange={(e) => setCalcReferrals(Number(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
            </div>

            {/* Slider 2: Average check */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-muted-foreground">Средний чек заказов в месяц:</span>
                <span className="text-foreground font-mono">{calcAvgCheck.toLocaleString('ru-RU')} ₽</span>
              </div>
              <input
                type="range"
                min={500}
                max={50000}
                step={500}
                value={calcAvgCheck}
                onChange={(e) => setCalcAvgCheck(Number(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
            </div>
          </div>

          {/* Earnings Result Box */}
          <div className="bg-secondary/50 border border-border/70 rounded-2xl p-5 flex flex-col justify-center items-center text-center space-y-1">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Ваш пассивный доход в месяц
            </span>
            <div className="text-3xl sm:text-4xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
              ~{estimatedMonthlyEarnings.toLocaleString('ru-RU')} ₽
            </div>
            <span className="text-[11px] text-muted-foreground">
              (Пожизненно с каждого пополнения привлечённых пользователей)
            </span>
          </div>
        </div>
      </div>

      {/* 6. Recent Referrals & Activity */}
      {recentReferrals.length > 0 && (
        <div className="bg-card border border-border/70 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-foreground">Приглашённые пользователи</h3>
            <span className="text-xs font-bold text-muted-foreground">Всего: {referralsCount} чел.</span>
          </div>

          <div className="divide-y divide-border/60">
            {recentReferrals.map((ref) => (
              <div key={ref.id} className="py-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold">
                    <Users className="w-3.5 h-3.5" />
                  </div>
                  <span className="font-mono font-semibold text-foreground">{ref.emailMasked}</span>
                </div>
                <span className="text-muted-foreground">
                  {new Date(ref.createdAt).toLocaleDateString('ru-RU')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 7. How it works guide */}
      <div className="bg-card border border-border/70 rounded-3xl p-6 sm:p-7 shadow-sm space-y-4">
        <h3 className="text-sm font-black text-muted-foreground uppercase tracking-wider">
          Как работает партнёрская программа
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              step: '1',
              title: 'Поделитесь ссылкой',
              desc: 'Отправьте вашу уникальную ссылку или промокод друзьям, коллегам или в соцсетях.',
            },
            {
              step: '2',
              title: 'Регистрация и заказы',
              desc: 'Пользователь навсегда закрепляется за вами сразу после перехода или регистрации.',
            },
            {
              step: '3',
              title: 'Пожизненный доход',
              desc: 'Получайте от 5% до 15% с каждого пополнения и моментально переводите средства на баланс.',
            },
          ].map(({ step, title, desc }) => (
            <div key={step} className="bg-secondary/40 border border-border/50 rounded-2xl p-4 space-y-2">
              <div className="w-7 h-7 rounded-xl bg-primary text-primary-foreground flex items-center justify-center text-xs font-black">
                {step}
              </div>
              <h4 className="text-sm font-bold text-foreground">{title}</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* QR Code Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between">
              <h4 className="text-base font-black text-foreground">Ваш партнёрский QR-код</h4>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-bold p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="bg-white p-4 rounded-2xl flex items-center justify-center border border-border/80">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrImageUrl}
                alt="Партнёрский QR-код"
                className="w-48 h-48 object-contain"
              />
            </div>

            <p className="text-xs text-center text-muted-foreground">
              Отсканируйте камерой смартфона для быстрого перехода на сайт с вашей реферальной меткой
            </p>

            <button
              type="button"
              onClick={() => copyToClipboard(referralLink, 'link')}
              className="w-full py-3 bg-primary text-primary-foreground font-bold text-xs rounded-2xl hover:bg-primary/90 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Copy className="w-4 h-4" />
              <span>{copiedLink ? 'Скопировано!' : 'Скопировать ссылку'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
