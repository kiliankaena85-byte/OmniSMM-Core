'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, CheckCircle2, AlertCircle, ArrowRight, Loader2, Sparkles, UserCheck } from 'lucide-react';
import { redeemTesterInviteAction } from '@/actions/user/tester-invite.action';

interface Props {
  code: string;
  validation: { valid: boolean; error?: string; invite?: any };
  user: { id: string; email: string; isTester: boolean; role?: string } | null;
}

export function InviteClientCard({ code, validation, user }: Props) {
  const [loading, setLoading] = useState(false);
  const [redeemed, setRedeemed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRedeem = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await redeemTesterInviteAction(code);
      if (res.success) {
        setRedeemed(true);
      } else {
        setError(res.error || 'Ошибка активации приглашения');
      }
    } catch (err: any) {
      setError(err?.message || 'Ошибка активации');
    } finally {
      setLoading(false);
    }
  };

  // 1. Invalid or expired link
  if (!validation.valid) {
    return (
      <div className="bg-card border border-destructive/30 rounded-3xl p-8 shadow-xl text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center">
          <AlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Приглашение недействительно</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {validation.error || 'Срок действия ссылки-приглашения истёк или она уже была активирована.'}
        </p>
        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 text-xs font-semibold text-foreground bg-muted hover:bg-muted/80 rounded-xl transition-all"
          >
            На главную
          </Link>
        </div>
      </div>
    );
  }

  // 2. Already redeemed or user already a tester
  if (redeemed || user?.isTester) {
    return (
      <div className="bg-card border border-success/30 rounded-3xl p-8 shadow-xl text-center space-y-5 animate-in fade-in zoom-in-95">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-success/15 text-success flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10" />
        </div>
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-success/15 text-success border border-success/20">
            <UserCheck className="w-3.5 h-3.5" /> Тестировщик активирован
          </span>
          <h2 className="text-xl font-bold text-foreground mt-2">Добро пожаловать в команду!</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Ваш аккаунт <strong>{user?.email}</strong> успешно подтверждён. Теперь вам доступно тестовое пополнение через ЮKassa и оформление заказов в закрытом режиме.
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/dashboard/add-funds"
            className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 text-sm font-bold text-primary-foreground bg-primary rounded-xl shadow-md hover:bg-primary/90 transition-all active:scale-95"
          >
            Перейти к пополнению баланса <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  // 3. User not authenticated
  if (!user) {
    return (
      <div className="bg-card border border-border/80 rounded-3xl p-8 shadow-xl text-center space-y-6">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-[11px] font-bold bg-primary/10 text-primary border border-primary/20">
            <Sparkles className="w-3 h-3" /> Закрытое тестирование
          </span>
          <h2 className="text-xl font-bold text-foreground">Приглашение тестировщика</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Вам предоставлен персональный доступ к закрытому тестированию платформы OmniSMM. Ссылка действует 14 дней на один email.
          </p>
        </div>

        <div className="space-y-2.5 pt-2">
          <Link
            href={`/login?redirect=/invite/${code}`}
            className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 text-xs font-bold text-primary-foreground bg-primary rounded-xl shadow-xs hover:bg-primary/90 transition-all active:scale-95"
          >
            Войти в аккаунт
          </Link>
          <Link
            href={`/register?redirect=/invite/${code}`}
            className="inline-flex items-center justify-center gap-2 w-full px-4 py-2.5 text-xs font-semibold text-foreground bg-muted hover:bg-muted/80 rounded-xl transition-all"
          >
            Зарегистрироваться
          </Link>
        </div>
      </div>
    );
  }

  // 4. Authenticated, ready to redeem
  return (
    <div className="bg-card border border-border/80 rounded-3xl p-8 shadow-xl text-center space-y-6">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
        <Sparkles className="w-8 h-8" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-xl font-bold text-foreground">Активация приглашения</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Вы вошли как <strong className="text-foreground">{user.email}</strong>. Нажмите кнопку ниже, чтобы закрепить статус тестировщика за этим аккаунтом.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl text-xs text-destructive">
          {error}
        </div>
      )}

      <button
        onClick={handleRedeem}
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 w-full px-5 py-3 text-sm font-bold text-primary-foreground bg-primary rounded-xl shadow-md hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-50"
      >
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        Активировать статус тестировщика
      </button>
    </div>
  );
}
