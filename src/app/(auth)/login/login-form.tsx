'use client';

import { useState, useTransition, useActionState } from 'react';
import { requestMagicLink } from '@/actions/auth/request-magic-link';
import { loginWithPasswordAction } from '@/actions/auth/password-login';
import { registerWithPasswordAction } from '@/actions/auth/password-register';
import { Mail, Loader2, CheckCircle2, ArrowRight, Eye, EyeOff, Lock } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { SmartCaptchaWidget } from '@/components/auth/SmartCaptchaWidget';

const inputCls =
  'w-full rounded-2xl border border-border bg-card text-foreground px-4 py-3.5 ' +
  'text-base md:text-sm font-semibold outline-none placeholder:text-muted-foreground ' +
  'focus:border-primary focus:ring-4 focus:ring-primary/20 transition-all duration-200 shadow-sm';

export function LoginForm({ isFlux = false }: { isFlux?: boolean }) {
  const [activeTab, setActiveTab] = useState<'magic' | 'password' | 'register'>('password'); // Password by default
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [shakeKey, setShakeKey] = useState(0);
  const [captchaToken, setCaptchaToken] = useState<string>('');

  const submitBtnCls = isFlux
    ? 'w-full flex items-center justify-center gap-2.5 h-12 py-3 px-5 rounded-full text-sm font-black bg-gradient-to-r from-purple-600 via-fuchsia-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white shadow-[0_4px_18px_rgba(168,85,247,0.35)] hover:shadow-[0_6px_24px_rgba(236,72,153,0.45)] hover:-translate-y-0.5 disabled:opacity-50 transition-all duration-200 cursor-pointer active:scale-[0.98]'
    : 'w-full flex items-center justify-center gap-2.5 h-12 py-3 px-5 rounded-2xl text-sm font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg hover:-translate-y-0.5 disabled:opacity-50 transition-all duration-200 cursor-pointer active:scale-[0.98]';

  const linkHoverCls = isFlux ? 'hover:text-pink-500' : 'hover:text-primary';

  // 1. Magic Link Action
  const [magicState, magicFormAction, magicPending] = useActionState(requestMagicLink, {
    error: null,
    success: false,
  });

  // 2. Password login states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 3. Password registration states
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerPending, setRegisterPending] = useState(false);

  const toggleShowPassword = () => setShowPassword(!showPassword);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append('email', email);
        formData.append('password', password);
        if (captchaToken) {
          formData.append('captchaToken', captchaToken);
        }
        if (typeof window !== 'undefined') {
          const redirect = new URLSearchParams(window.location.search).get('redirect');
          if (redirect) {
            formData.append('redirect', redirect);
          }
        }

        const res = await loginWithPasswordAction(null, formData);
        if (!res.success) {
          toast.error(res.error || 'Ошибка при входе');
          return;
        }

        toast.success('Успешный вход в аккаунт!');
        // Redirect to dashboard
        if (res.redirectTo) {
          window.location.href = res.redirectTo;
        }
      } catch {
        toast.error('Произошла непредвиденная ошибка. Пожалуйста, попробуйте позже.');
      }
    });
  };

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!registerEmail || !registerPassword) return;

    setRegisterPending(true);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.append('email', registerEmail);
        formData.append('password', registerPassword);
        if (captchaToken) {
          formData.append('captchaToken', captchaToken);
        }

        const res = await registerWithPasswordAction(null, formData);
        if (!res.success) {
          toast.error(res.error || 'Ошибка при регистрации');
          setRegisterPending(false);
          return;
        }

        toast.success(res.message || 'Регистрация успешна!');
        setActiveTab('password');
      } catch {
        toast.error('Произошла непредвиденная ошибка при регистрации.');
        setRegisterPending(false);
      }
    });
  };

  if (activeTab === 'magic' && magicState?.success) {
    return (
      <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-6 text-center space-y-3">
        <div className="flex justify-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500" />
        </div>
        <h3 className="font-bold text-foreground">Проверьте почту</h3>
        <p className="text-sm text-foreground/80 leading-relaxed">
          Мы отправили волшебную ссылку для входа.
          Письмо придёт в течение 1–2 минут.
        </p>
        <p className="text-xs text-muted-foreground font-medium">
          Не получили? Проверьте папку «Спам»
        </p>
        <button
          onClick={() => {
            // Reset success state to try again
            window.location.reload();
          }}
          className="text-xs font-bold text-primary underline mt-2 hover:opacity-80 transition-opacity"
        >
          Вернуться на страницу входа
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* High Contrast Tabs control */}
      <div className={`flex p-1 bg-muted/60 border border-border/80 ${isFlux ? 'rounded-full' : 'rounded-2xl'}`}>
        <button
          type="button"
          onClick={() => setActiveTab('password')}
          className={`flex-1 py-2.5 px-2 text-xs font-bold transition-all duration-200 cursor-pointer min-h-[40px] flex items-center justify-center ${
            isFlux ? 'rounded-full' : 'rounded-xl'
          } ${
            activeTab === 'password'
              ? isFlux ? 'bg-card text-foreground shadow-sm' : 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground font-semibold'
          }`}
        >
          Войти по паролю
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('magic')}
          className={`flex-1 py-2.5 px-2 text-xs font-bold transition-all duration-200 cursor-pointer min-h-[40px] flex items-center justify-center ${
            isFlux ? 'rounded-full' : 'rounded-xl'
          } ${
            activeTab === 'magic'
              ? isFlux ? 'bg-card text-foreground shadow-sm' : 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground font-semibold'
          }`}
        >
          Войти по ссылке
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('register')}
          className={`flex-1 py-2.5 px-2 text-xs font-bold transition-all duration-200 cursor-pointer min-h-[40px] flex items-center justify-center ${
            isFlux ? 'rounded-full' : 'rounded-xl'
          } ${
            activeTab === 'register'
              ? isFlux ? 'bg-card text-foreground shadow-sm' : 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground font-semibold'
          }`}
        >
          Регистрация
        </button>
      </div>

      {/* Tab 1: Password Login */}
      {activeTab === 'password' && (
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="login-email" className="block text-xs font-black uppercase tracking-wider text-muted-foreground">
              Email адрес
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                id="login-email"
                type="email"
                required
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${inputCls} pl-10`}
                aria-label="Email адрес для входа"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label htmlFor="login-password" className="block text-xs font-black uppercase tracking-wider text-muted-foreground">
                Пароль
              </label>
            </div>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputCls} pl-10 pr-10`}
                aria-label="Пароль для входа"
              />
              <button
                type="button"
                onClick={toggleShowPassword}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <SmartCaptchaWidget onTokenChange={setCaptchaToken} />

          <button
            type="submit"
            onClick={(e) => {
              if (!email || !password) {
                e.preventDefault();
                setShakeKey(Date.now());
                toast.error('Пожалуйста, заполните Email и пароль');
              }
            }}
            disabled={isPending}
            key={`btn-pass-${shakeKey}`}
            className={`${submitBtnCls} ${shakeKey ? 'animate-shake' : ''}`}
          >
            {isPending ? (
              <>
                <Loader2 className="animate-spin w-4 h-4" />
                Вход...
              </>
            ) : (
              <>
                Войти в кабинет
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="text-center text-[11px] font-medium text-muted-foreground leading-relaxed px-2 mt-3">
            Нажимая кнопку, вы соглашаетесь с{' '}
            <Link href="/legal/terms" className={`underline font-bold text-foreground ${linkHoverCls} transition-colors`}>
              Условиями сервиса
            </Link>{' '}
            и{' '}
            <Link href="/legal/privacy" className={`underline font-bold text-foreground ${linkHoverCls} transition-colors`}>
              Политикой конфиденциальности
            </Link>
          </p>
        </form>
      )}

      {/* Tab 2: Magic Link Login */}
      {activeTab === 'magic' && (
        <form action={magicFormAction} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="login-email-magic" className="block text-xs font-black uppercase tracking-wider text-muted-foreground">
              Email адрес
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                id="login-email-magic"
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="name@example.com"
                className={`${inputCls} pl-10`}
                aria-label="Email адрес для отправки ссылки"
              />
            </div>
          </div>

          {magicState?.error && (
            <div
              className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-xl px-4 py-2.5"
              role="alert"
            >
              {magicState.error}
            </div>
          )}

          <input type="hidden" name="captchaToken" value={captchaToken} />
          <SmartCaptchaWidget onTokenChange={setCaptchaToken} />

          <button
            type="submit"
            onClick={(e) => {
              const emailInput = document.getElementById('login-email-magic') as HTMLInputElement;
              if (!emailInput?.value) {
                e.preventDefault();
                setShakeKey(Date.now());
                toast.error('Пожалуйста, введите Email');
              }
            }}
            disabled={magicPending}
            key={`btn-magic-${shakeKey}`}
            className={`${submitBtnCls} ${shakeKey ? 'animate-shake' : ''}`}
          >
            {magicPending ? (
              <>
                <Loader2 className="animate-spin w-4 h-4" />
                Отправляем...
              </>
            ) : (
              <>
                Получить ссылку
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="text-center text-[11px] leading-tight text-muted-foreground px-2">
            Нажимая кнопку, вы принимаете условия{' '}
            <Link href="/legal/terms" className={`underline ${linkHoverCls} transition-colors`}>
              Публичной оферты
            </Link>{' '}
            и даете согласие на обработку данных согласно{' '}
            <Link href="/legal/privacy" className={`underline ${linkHoverCls} transition-colors`}>
              Политике конфиденциальности
            </Link>
          </p>
        </form>
      )}

      {/* Tab 3: Password Registration */}
      {activeTab === 'register' && (
        <form onSubmit={handleRegisterSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="register-email" className="block text-xs font-black uppercase tracking-wider text-muted-foreground">
              Email адрес
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                id="register-email"
                type="email"
                required
                placeholder="name@example.com"
                value={registerEmail}
                onChange={(e) => setRegisterEmail(e.target.value)}
                className={`${inputCls} pl-10`}
                aria-label="Email адрес для регистрации"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="register-password" className="block text-xs font-black uppercase tracking-wider text-muted-foreground">
              Пароль
            </label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <input
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="Создайте пароль (мин. 12 символов)"
                value={registerPassword}
                onChange={(e) => setRegisterPassword(e.target.value)}
                className={`${inputCls} pl-10 pr-10`}
                aria-label="Пароль для регистрации"
              />
              <button
                type="button"
                onClick={toggleShowPassword}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
                aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <SmartCaptchaWidget onTokenChange={setCaptchaToken} />

          <button
            type="submit"
            onClick={(e) => {
              if (!registerEmail || registerPassword.length < 12) {
                e.preventDefault();
                setShakeKey(Date.now());
                if (!registerEmail) toast.error('Пожалуйста, введите Email');
                else if (registerPassword.length < 12) toast.error('Пароль должен быть не менее 12 символов');
              }
            }}
            disabled={registerPending}
            key={`btn-reg-${shakeKey}`}
            className={`${submitBtnCls} ${shakeKey ? 'animate-shake' : ''}`}
          >
            {registerPending ? (
              <>
                <Loader2 className="animate-spin w-4 h-4" />
                Регистрация...
              </>
            ) : (
              <>
                Создать аккаунт
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
          <p className="text-center text-[11px] font-medium text-muted-foreground leading-relaxed px-2 mt-3">
            Создавая аккаунт, вы принимаете{' '}
            <Link href="/legal/terms" className={`underline font-bold text-foreground ${linkHoverCls} transition-colors`}>
              Условия сервиса
            </Link>{' '}
            и{' '}
            <Link href="/legal/privacy" className={`underline font-bold text-foreground ${linkHoverCls} transition-colors`}>
              Политику конфиденциальности
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
