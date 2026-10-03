/**
 * (c) 2024-2026 SMMplan. All rights reserved.
 * Created by Artem (http://artmspektr.ru)
 * Unauthorized copying of this file is strictly prohibited.
 *
 * MIGRATED TO SMMPLAN LITE CORE (April 2026)
 * Removed: BullMQ queues, @/workers, @/lib/prisma, multi-project bots,
 *          startWebhookServer, SessionService, BotRegistry, CryptoService,
 *          RedisSessionStore, projectMiddleware, moderationMiddleware
 * Uses: db from @/lib/db, single-bot mode via TELEGRAM_BOT_TOKEN
 */
import * as dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Fix node-fetch isAbortSignal prototype check in esbuild bundles (Node 20)
const origGetProto = Object.getPrototypeOf;
Object.getPrototypeOf = function (obj: any) {
  const p = origGetProto.call(Object, obj);
  if (obj && typeof obj === 'object' && 'aborted' in obj && p && p.constructor && p.constructor.name !== 'AbortSignal') {
    try {
      Object.defineProperty(p.constructor, 'name', { value: 'AbortSignal', configurable: true });
    } catch { /* ignore */ }
  }
  return p;
};

import { Scenes, session, Telegraf, Markup } from 'telegraf';
import { db } from '@/lib/db';
import { WalletOps } from '@/services/financial/wallet-ops';
import { auditAdminAwaitable } from '@/lib/admin-audit';
import type { BotContext } from './types/bot-context';

function sanitizeTelegramTemplate(template: string): string {
  if (!template) return '';
  return template
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
}

// Scenes — only import wizards that have been migrated to Lite core
import { orderWizard, ORDER_WIZARD } from './scenes/order.wizard';
import { depositWizard, DEPOSIT_WIZARD } from './scenes/deposit.wizard';
import { referralWizard, REFERRAL_WIZARD } from './scenes/referral.wizard';
import { ownerHubWizard, isOwnerOrAdmin } from './scenes/owner-hub.wizard';
import { BotCatalogService } from './services/bot-catalog.service';
import { BotSettingsService } from './services/bot-settings.service';

// ── BOT INSTANCE ──
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN || TOKEN === 'dummy_token') {
  console.warn('[Bot] TELEGRAM_BOT_TOKEN not set. Telegram bot will NOT start.');
}

import { getTelegramProxyAgent, resolveActiveTelegramProxyUrl, reportTelegramProxyFailure } from '@/lib/telegram-agent';
import { getTenantSiteName, getTenantHost } from '@/config/tenants';
const agent = getTelegramProxyAgent();

export const bot = new Telegraf<BotContext>(TOKEN || 'dummy_token', {
  telegram: {
    agent,
  },
});

const botTenantId = process.env.BOT_TENANT_ID || 'smmplan';
const botSiteName = getTenantSiteName(botTenantId);

export function getBotDepinUrl(): string {
  if (process.env.DEPIN_TMA_URL) {
    return process.env.DEPIN_TMA_URL;
  }
  const resolvedHost = getTenantHost(botTenantId);
  const host = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || (resolvedHost.startsWith('http') ? resolvedHost : `https://${resolvedHost}`);
  const cleanHost = host.replace(/\/+$/, '');
  if (!cleanHost.startsWith('https://') || cleanHost.includes('localhost') || cleanHost.includes('127.0.0.1')) {
    return 'https://depin.smmplan-tma.workers.dev/depin';
  }
  return `${cleanHost}/depin`;
}

// ── STAGE ──
const stage = new Scenes.Stage<BotContext>([
  orderWizard,
  depositWizard,
  referralWizard,
  ownerHubWizard,
]);

// ── MIDDLEWARE ──
bot.use(session());
bot.use(stage.middleware());

// Security & Maintenance policy middleware
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  const isOwner = await isOwnerOrAdmin(ctx.from.id);

  // 1. Maintenance mode check
  if (!isOwner) {
    const isMaint = await BotSettingsService.isMaintenanceActive(botTenantId);
    if (isMaint) {
      return ctx.reply('🛠 <b>Бот находится на техническом обслуживании.</b>\n\nМы проводим плановое обновление инфраструктуры. Пожалуйста, попробуйте позже.', { parse_mode: 'HTML' }).catch(() => {});
    }
  }

  // 2. Message length limit
  const msg = ctx.message as Record<string, unknown> | undefined;
  const text = (msg && 'text' in msg && typeof msg.text === 'string') ? msg.text : '';
  if (text && !isOwner) {
    const sec = await BotSettingsService.getSecurityConfig(botTenantId);
    if (text.length > sec.maxMessageLength) {
      return ctx.reply(`⚠️ Ваше сообщение слишком длинное (максимум ${sec.maxMessageLength} символов). Пожалуйста, сократите его.`).catch(() => {});
    }
  }

  return next();
});

// ── OWASP A03 / XSS DEFENSE HELPER ──
function escapeHtml(text: string): string {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── ERROR HANDLER ──
bot.catch(async (err: unknown, ctx: unknown) => {
  try {
    const errorObj = err as { response?: { description?: string; error_code?: number }; message?: string; stack?: string };
    const description = errorObj?.response?.description || errorObj?.message || '';
    const errorCode = errorObj?.response?.error_code ? String(errorObj.response.error_code) : undefined;
    // Ignore common non-critical Telegram errors
    if (
      description.includes('query is too old') ||
      description.includes('message to edit not found') ||
      description.includes('bot was blocked by the user') ||
      description.includes('user is deactivated') ||
      description.includes('chat not found') ||
      description.includes('message is not modified')
    ) {
      return;
    }

    const contextObj = ctx as { 
      updateType?: string; 
      reply?: (text: string) => Promise<unknown>;
      from?: { id?: number };
      chat?: { id?: number };
    };
    console.error(`[Bot] ERROR [${contextObj?.updateType || 'unknown'}]:`, err);

    // Asynchronously log to TelegramErrorLog in database
    try {
      await (db as any).telegramErrorLog?.create({
        data: {
          level: 'ERROR',
          source: (contextObj?.updateType as 'command' | 'callback_query' | 'webhook' | 'polling') || 'polling',
          errorCode,
          errorMessage: description || 'Unknown bot error',
          stackTrace: errorObj?.stack?.slice(0, 1000),
          userId: contextObj?.from?.id ? String(contextObj.from.id) : undefined,
          chatId: contextObj?.chat?.id ? String(contextObj.chat.id) : undefined,
        }
      });
    } catch { /* error logging must never crash the bot */ }

    // Instant alert to Admin Channel for any user-facing crash
    try {
      const { sendAdminAlert } = await import('@/lib/notifications');
      sendAdminAlert(
        `🤖 <b>[BOT ERROR: Необработанная ошибка бота]</b>\n\n` +
        `👤 <b>TG ID:</b> <code>${contextObj?.from?.id || '—'}</code>\n` +
        `📍 <b>Тип события:</b> <code>${contextObj?.updateType || 'unknown'}</code>\n` +
        `⚠️ <b>Ошибка:</b> <code>${escapeHtml(description || 'Unknown error')}</code>\n` +
        (errorObj?.stack ? `<pre>${escapeHtml(errorObj.stack.slice(0, 300))}</pre>` : ''),
        'CRITICAL',
        botTenantId
      );
    } catch { /* alert failure must never crash */ }

    if (contextObj && typeof contextObj.reply === 'function') {
      await contextObj.reply('⚠️ Произошла техническая ошибка. Мы уже исправляем её.').catch(() => {});
    }
  } catch (e) {
    console.error('[Bot] Error in catch handler:', e);
  }
});

// ── KYC & SYBIL PROTECTION ──
bot.command('bind', async (ctx: BotContext) => {
  await ctx.reply(
    `🔗 <b>Привязка аккаунта ${botSiteName}</b>\n\n` +
    'Для безопасной привязки Telegram к вашему аккаунту без передачи телефонных номеров:\n\n' +
    `1. Авторизуйтесь на нашем сайте ${botSiteName}.\n` +
    '2. Перейдите в личный кабинет.\n' +
    '3. Нажмите кнопку <b>«Привязать Telegram»</b> и следуйте инструкции.', 
    { parse_mode: 'HTML' }
  );
});

// ── COMMANDS ──
bot.start(async (ctx: BotContext) => {
  if (!ctx.from) return;
  const tgId = String(ctx.from.id);
  const payload = ctx.payload;

  // Level 1: Smart Bind Protocol
  if (payload && payload.startsWith('tg_bind_')) {
    const bindToken = await db.authToken.findFirst({
      where: { token: payload }
    });

    if (bindToken && !bindToken.used && bindToken.expiresAt > new Date()) {
      const webUserId = bindToken.userId;
      const webUser = await db.user.findUnique({
        where: { id: webUserId },
        select: { id: true, email: true }
      });
      if (!webUser) {
        return ctx.reply('❌ Ошибка: целевой аккаунт на сайте не найден.');
      }

      const tempUser = await db.user.findFirst({ where: { telegramId: tgId, tenantId: botTenantId } });

      // If already linked to the same account
      if (tempUser && tempUser.id === webUserId) {
        return ctx.reply('✅ Этот Telegram уже привязан к вашему аккаунту.', {
          parse_mode: 'HTML',
          ...Markup.keyboard([
            ['🛍 Каталог услуг', '📦 Мои заказы'],
            ['💰 Пополнить', '👤 Профиль'],
            ['🆘 Поддержка', '👥 Рефералы']
          ]).resize()
        });
      }

      // [VULN-TG-01 Protection 1] Reject hijacking of established non-bot web accounts
      if (tempUser && !tempUser.isBotOnly && tempUser.id !== webUserId) {
        return ctx.reply(
          '❌ <b>Привязка невозможна</b>\n────────────────────\n' +
          'К этому Telegram уже привязан полноценный профиль на сайте.\n' +
          'Чтобы привязать другой аккаунт, сначала отвяжите Telegram в настройках профиля на сайте.',
          { parse_mode: 'HTML' }
        );
      }

      // [VULN-TG-01 Protection 2] Interactive Confirmation Prompt (CSRF & Deep-Link Balance Drain Immunity)
      const emailMasked = webUser.email 
        ? webUser.email.replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => `${a}${'*'.repeat(Math.min(b.length, 4))}${c}`) 
        : 'профиль на сайте';
      const balanceTransferNotice = (tempUser && tempUser.balance > BigInt(0))
        ? `\n\n⚠️ <b>Баланс:</b> Баланс этого Telegram (${(Number(tempUser.balance) / 100).toFixed(2)} ₽) будет объединён с аккаунтом на сайте.`
        : '';

      return ctx.reply(
        `🔐 <b>Подтверждение привязки аккаунта</b>\n────────────────────\n` +
        `Вы собираетесь связать этот Telegram с аккаунтом: <b>${emailMasked}</b>.${balanceTransferNotice}\n\n` +
        `Вы подтверждаете объединение профилей?`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Да, привязать аккаунт', `confirm_bind:${payload}`)],
            [Markup.button.callback('❌ Отмена', 'cancel_bind')]
          ])
        }
      );
    } else {
      return ctx.reply(
        '⚠️ <b>Ссылка недействительна</b>\n\n' +
        'Срок действия ссылки истек или она уже была использована. Получите новую ссылку на сайте.',
        { parse_mode: 'HTML' }
      );
    }
  }

  // Level 2: Referral start parameter (?start=ref_CODE) with Rate Limiting (P2-12)
  let referredByUserId: string | undefined;
  if (payload && payload.startsWith('ref_')) {
    const refCode = payload.replace('ref_', '');
    const rateLimitKey = `bot:ref_rate:${tgId}`;
    let isRateLimited = false;
    try {
      const { redis } = await import('@/lib/redis');
      const existing = await redis.get(rateLimitKey);
      if (existing) {
        isRateLimited = true;
      } else {
        await redis.set(rateLimitKey, '1', 'EX', 3600); // 1 hour rate limit
      }
    } catch {}

    if (!isRateLimited) {
      const referrer = await db.user.findFirst({
        where: { referralCode: refCode, tenantId: botTenantId }
      });
      if (referrer) {
        referredByUserId = referrer.id;
      }
    }
  }

  // Auto-register or fetch user (mark unlinked Telegram accounts as isBotOnly) (P2-11)
  const emailStub = `tg_${tgId}@${botTenantId}.bot`;
  let user = await db.user.findFirst({ where: { telegramId: tgId, tenantId: botTenantId } });

  const tgName = ctx.from?.first_name || (ctx.from?.username ? `@${ctx.from.username}` : 'Пользователь');

  if (!user) {
    user = await db.user.upsert({
      where: { email_tenantId: { email: emailStub, tenantId: botTenantId } },
      update: { telegramId: tgId },
      create: {
        email: emailStub,
        telegramId: tgId,
        referredById: referredByUserId,
        tenantId: botTenantId,
        isBotOnly: true,
      }
    });

    // Notify referrer (Note: commission bonus credited only upon qualifying deposit action)
    if (referredByUserId) {
      const refUser = await db.user.findUnique({ where: { id: referredByUserId } });
      if (refUser?.telegramId) {
        bot.telegram.sendMessage(
          refUser.telegramId,
          `🎉 <b>Новый реферал!</b>\n\nПо вашей ссылке зарегистрировался ${escapeHtml(tgName)}. Бонус будет начислен после первого пополнения счета.`,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    }
  }

  // Level 3: Return from payment gateway (YooKassa/CryptoBot) via ?start=pay_ok_PAYMENT_ID
  if (payload && (payload.startsWith('pay_ok_') || payload.startsWith('pay_'))) {
    const paymentId = payload.replace(/^pay_ok_/, '').replace(/^pay_/, '');
    try {
      let payment = await db.payment.findUnique({ where: { id: paymentId } });
      if (payment && payment.userId === user.id && (!botTenantId || payment.tenantId === botTenantId)) {
        if (payment.status !== 'SUCCEEDED' && payment.gateway === 'yookassa' && payment.gatewayId) {
          // Fast sync-check with YooKassa if webhook has slight latency
          try {
            const { PaymentGatewayFactory } = await import('@/services/financial/payment-gateway.service');
            const gatewaySvc = PaymentGatewayFactory.getGateway('yookassa');
            const isPaid = await gatewaySvc.checkStatusSync?.(payment.gatewayId);
            if (isPaid) {
              const { paymentService } = await import('@/services/financial/payment.service');
              await paymentService.confirmPayment(
                payment.gatewayId,
                BigInt(payment.amount),
                payment.userId,
                false,
                'yookassa',
                payment.id
              );
              payment = await db.payment.findUnique({ where: { id: paymentId } });
            }
          } catch (syncErr) {
            console.warn('[Bot /start] YooKassa sync check warning:', syncErr);
          }
        }

        if (!payment) return;
        const freshUser = await db.user.findUnique({ where: { id: user.id } });
        const currentBal = freshUser ? (Number(freshUser.balance) / 100).toFixed(2) : '0.00';
        const formattedAmount = (Number(payment.amount) / 100).toLocaleString('ru-RU');

        if (payment.status === 'SUCCEEDED') {
          await ctx.reply(
            `🎉 <b>ОПЛАТА УСПЕШНО ПОДТВЕРЖДЕНА!</b>\n────────────────────\n` +
            `Сумма: <b>${formattedAmount} ₽</b>\n` +
            `Текущий баланс: <b>${currentBal} ₽</b> ✅\n\n` +
            `<i>Средства зачислены на ваш счёт. Приятного использования!</i>`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        } else {
          await ctx.reply(
            `⏳ <b>ПЛАТЕЖ В ОБРАБОТКЕ</b>\n────────────────────\n` +
            `Сумма: <b>${formattedAmount} ₽</b>\n\n` +
            `<i>Банк обрабатывает транзакцию. Средства поступят на баланс в течение 1-2 минут, бот сразу пришлет вам уведомление.</i>`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
      }
    } catch (payCheckErr) {
      console.warn('[Bot /start] Error verifying returning payment:', payCheckErr);
    }
  }

  return sendMainMenu(ctx, false);
});

export async function sendMainMenu(ctx: BotContext, isEdit = false) {
  if (!ctx.from) return;
  const tgId = String(ctx.from.id);
  const tgName = ctx.from.first_name || (ctx.from.username ? `@${ctx.from.username}` : 'Пользователь');
  const user = await db.user.findFirst({ where: { telegramId: tgId, tenantId: botTenantId } });
  const balanceStr = user ? (Number(user.balance) / 100).toFixed(2) : '0.00';

  let welcomeTpl =
    `👋 <b>{userName}, добро пожаловать в {siteName}!</b>\n\n` +
    `Платформа автоматического продвижения в социальных сетях.\n\n` +
    `💰 Ваш баланс: <b>{balance} ₽</b>\n\n` +
    `⚡ <b>Как сделать заказ за 2 простых шага:</b>\n` +
    `1️⃣ Нажмите <b>«🚀 Быстрый заказ по ссылке»</b> или просто <b>отправьте ссылку в этот чат</b>.\n` +
    `2️⃣ Выберите подходящий тариф и укажите количество.\n\n` +
    `<i>Либо выберите нужный раздел в меню ниже:</i>`;

  try {
    const templates = await BotSettingsService.getTemplates(botTenantId);
    if (templates?.welcome && templates.welcome.trim().length > 0) {
      welcomeTpl = sanitizeTelegramTemplate(templates.welcome);
    }
  } catch { /* use default */ }

  const formattedWelcome = welcomeTpl
    .replace(/{siteName}/g, escapeHtml(botSiteName))
    .replace(/{userName}/g, escapeHtml(tgName))
    .replace(/{balance}/g, balanceStr);

  const startInline = await getDynamicInlineKeyboard(tgId);

  if (isEdit) {
    try {
      await ctx.editMessageText(formattedWelcome, {
        parse_mode: 'HTML',
        ...startInline
      });
      return;
    } catch {
      // Fall back to reply if message cannot be edited
    }
  }

  const depinUrl = getBotDepinUrl();
  const isHttps = depinUrl.startsWith('https://');

  // Clean up old bottom reply keyboards and set new persistent one with Mini App launcher
  const persistentRows: any[][] = [
    isHttps
      ? [Markup.button.webApp('⚡ DePIN Задания (Mini App)', depinUrl), '📦 Мои заказы']
      : ['⚡ DePIN Задания', '📦 Мои заказы'],
    ['📱 Главное меню', '💰 Баланс'],
    ['🆘 Поддержка', '🚀 Быстрый заказ'],
  ];

  const persistentKeyboard = Markup.keyboard(persistentRows).resize().persistent();

  await ctx.reply('🧹 <i>Обновление меню...</i>', {
    parse_mode: 'HTML',
    ...persistentKeyboard
  }).then(m => {
    // Optionally delete the cleanup message
    setTimeout(() => {
      ctx.telegram?.deleteMessage(ctx.chat!.id, m.message_id).catch(() => {});
    }, 1000);
  }).catch(() => {});

  return ctx.reply(formattedWelcome, {
    parse_mode: 'HTML',
    ...startInline
  });
}

export async function getDynamicInlineKeyboard(tgId?: string | number) {
  const isOwner = tgId ? await isOwnerOrAdmin(tgId) : false;
  const depinUrl = getBotDepinUrl();
  const isHttps = depinUrl.startsWith('https://');

  const depinBtn = isHttps
    ? Markup.button.webApp('⚡ DePIN Биржа & Задания (TMA)', depinUrl)
    : Markup.button.callback('⚡ DePIN Биржа & Задания', 'nav_depin');

  let baseRows: any[][] = [
    [depinBtn],
    [Markup.button.callback('🚀 Быстрый заказ по ссылке', 'start_fast_order')],
    [Markup.button.callback('🛍 Каталог услуг', 'shop'), Markup.button.callback('💰 Пополнить баланс', 'deposit')],
    [Markup.button.callback('👤 Личный кабинет', 'profile'), Markup.button.callback('📦 Мои заказы', 'my_orders')],
    [Markup.button.callback('🔗 Привязать аккаунт', 'bind_account'), Markup.button.callback('🆘 Поддержка', 'support')]
  ];

  try {
    const buttons = await BotSettingsService.getMenuButtons(botTenantId);
    if (Array.isArray(buttons) && buttons.length > 0) {
      const active = buttons.filter(b => b.isActive !== false);
      if (active.length > 0) {
        const rowMap = new Map<number, typeof buttons>();
        for (const btn of active) {
          const r = btn.row ?? 0;
          if (!rowMap.has(r)) rowMap.set(r, []);
          rowMap.get(r)!.push(btn);
        }
        const sortedRows = Array.from(rowMap.keys()).sort((a, b) => a - b);
        const grid: any[][] = [];
        for (const r of sortedRows) {
          const rowBtns = rowMap.get(r)!.sort((a, b) => (a.col ?? 0) - (b.col ?? 0));
          grid.push(rowBtns.map(b => {
            if (b.action === 'WEB_APP' && b.value) {
              const url = b.value.startsWith('http') ? b.value : `${getBotDepinUrl().replace(/\/depin$/, '')}${b.value}`;
              return Markup.button.webApp(b.label, url);
            }
            if (b.action === 'DEPIN') {
              return isHttps ? Markup.button.webApp(b.label, depinUrl) : Markup.button.callback(b.label, 'nav_depin');
            }
            return Markup.button.callback(b.label, `menu_action_${b.id}`);
          }));
        }
        if (grid.length > 0) {
          const hasDepin = active.some(b => b.action === 'DEPIN' || (b.action === 'WEB_APP' && (b.value || '').includes('depin')));
          if (!hasDepin) {
            grid.unshift([depinBtn]);
          }
          baseRows = grid;
        }
      }
    }
  } catch { /* use default fallback */ }

  if (isOwner) {
    baseRows.unshift([Markup.button.callback('👑 Пульт Овнера / DevOps Hub', 'nav_owner_hub')]);
  }

  return Markup.inlineKeyboard(baseRows);
}


bot.action(/^menu_action_(.+)$/, async (ctx: BotContext) => {
  if (!ctx.match) return;
  const btnId = ctx.match[1];
  
  const buttons = await BotSettingsService.getMenuButtons(botTenantId);
  const btn = buttons.find(b => b.id === btnId);
  
  if (!btn) {
    return ctx.answerCbQuery('Кнопка не найдена').catch(() => {});
  }
  
  await ctx.answerCbQuery().catch(() => {});

  if (ctx.scene) {
    await ctx.scene.leave().catch(() => {});
  }

  return executeDynamicAction(ctx, btn);
});

async function executeDynamicAction(ctx: BotContext, btn: any) {
  switch (btn.action) {
    case 'FAST_ORDER':
      await sendFastOrderPrompt(ctx);
      return true;
    case 'CATALOG':
      await sendNetworkCatalogMenu(ctx, false);
      return true;
    case 'ORDERS':
      await sendUserOrders(ctx);
      return true;
    case 'REFILL': {
      const { DEPOSIT_WIZARD } = await import('./scenes/deposit.wizard');
      await ctx.scene.enter(DEPOSIT_WIZARD);
      return true;
    }
    case 'PROFILE':
      await sendUserProfile(ctx);
      return true;
    case 'SUPPORT':
      await sendSupportPrompt(ctx);
      return true;
    case 'REFERRALS': {
      const { REFERRAL_WIZARD } = await import('./scenes/referral.wizard');
      await ctx.scene.enter(REFERRAL_WIZARD);
      return true;
    }
    case 'URL': {
      const botHost = getTenantHost(botTenantId);
      const targetUrl = btn.value || (botHost.startsWith('http') ? botHost : `https://${botHost}`);
      await ctx.reply(
        `🌐 <b>${escapeHtml(btn.label)}</b>\n\nПерейдите по ссылке ниже:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.url('Перейти на сайт', targetUrl)]])
        }
      );
      return true;
    }
    case 'TEXT_REPLY': {
      const replyText = btn.value || 'Спасибо за обращение!';
      await ctx.reply(replyText, { parse_mode: 'HTML' });
      return true;
    }
    case 'COMMAND': {
      const cmd = (btn.value || '').replace(/^\//, '');
      if (cmd === 'start' || cmd === 'menu') {
        await sendMainMenu(ctx, false);
        return true;
      }
      if (cmd === 'help') {
        await ctx.reply('ℹ️ <b>Справка</b>\nИспользуйте кнопки меню для навигации или отправьте ссылку на соцсеть для быстрого заказа.', { parse_mode: 'HTML' });
        return true;
      }
      return true;
    }
    case 'WEB_APP': {
      const botHost = getTenantHost(botTenantId);
      const webAppUrl = btn.value || (botHost.startsWith('http') ? botHost : `https://${botHost}`);
      await ctx.reply(
        `📱 <b>${escapeHtml(btn.label)}</b>\n\nНажмите кнопку для запуска:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.webApp('Открыть приложение', webAppUrl)]])
        }
      );
      return true;
    }
    case 'DEPIN': {
      await sendDepinAppPrompt(ctx);
      return true;
    }
  }
  return false;
}

export async function dispatchDynamicMenuAction(ctx: BotContext, text: string): Promise<boolean> {
  const trimmed = text.trim();
  const buttons = await BotSettingsService.getMenuButtons(botTenantId);
  const btn = buttons.find(b => b.label.toLowerCase() === trimmed.toLowerCase() || b.label.replace(/^[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '').trim().toLowerCase() === trimmed.toLowerCase());
  
  if (btn) {
    if (ctx.scene) {
      await ctx.scene.leave().catch(() => {});
    }
    return executeDynamicAction(ctx, btn);
  }
  return false;
}

export async function sendNetworkCatalogMenu(ctx: BotContext, isEdit = false) {
  try {
    const networks = await BotCatalogService.getVisibleNetworks(botTenantId);
    if (networks.length === 0) {
      const text = '🛍 Каталог услуг временно недоступен или обновляется.';
      if (isEdit) {
        return await ctx.editMessageText(text).catch(() => {});
      }
      return await ctx.reply(text);
    }

    const rows: ReturnType<typeof Markup.button.callback>[][] = [];
    for (let i = 0; i < networks.length; i += 2) {
      const row = [Markup.button.callback(networks[i].name, `cat_net_${networks[i].id}`)];
      if (i + 1 < networks.length) {
        row.push(Markup.button.callback(networks[i + 1].name, `cat_net_${networks[i + 1].id}`));
      }
      rows.push(row);
    }
    rows.push([Markup.button.callback('🚀 Быстрый заказ по ссылке', 'start_fast_order')]);

    const text = '🛍 <b>Каталог услуг</b>\nВыберите социальную сеть (доступно только с активными услугами):';
    const extra = {
      parse_mode: 'HTML' as const,
      ...Markup.inlineKeyboard(rows)
    };

    if (isEdit) {
      return await ctx.editMessageText(text, extra).catch(() => {});
    }
    return await ctx.reply(text, extra);
  } catch (err) {
    console.error('[Bot Catalog Menu] Error:', err);
    if (isEdit) {
      return await ctx.answerCbQuery('Ошибка загрузки каталога').catch(() => {});
    }
    return await ctx.reply('Произошла ошибка при загрузке каталога.');
  }
}

export async function sendFastOrderPrompt(ctx: BotContext) {
  await ctx.reply(
    '🚀 <b>Быстрый заказ по ссылке</b>\n\n' +
    'Отправьте в ответ ссылку на ваш объект продвижения прямо в этот чат:\n' +
    '• <b>Telegram</b> (канал, группа, пост)\n' +
    '• <b>ВКонтакте</b> (стена, группа, видео, клип)\n' +
    '• <b>YouTube</b> (видео, shorts, канал)\n' +
    '• <b>Instagram</b>, <b>TikTok</b> и другие соцсети\n\n' +
    '<i>Я автоматически определю соцсеть, тип объекта и покажу только подходящие тарифы без риска ошибки!</i>',
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🛍 Выбрать из каталога вручную', 'shop')],
        [Markup.button.callback('❌ Отмена', 'cancel_fast_order')]
      ])
    }
  );
}

export async function sendDepinAppPrompt(ctx: BotContext) {
  const depinUrl = getBotDepinUrl();
  const isHttps = depinUrl.startsWith('https://');

  const text =
    `⚡ <b>DePIN Биржа микро-заданий SMMplan</b>\n\n` +
    `Выполняйте задания сообщества, копите очки PTS и продвигайте свои Telegram-каналы бесплатно!\n\n` +
    `📚 <b>Пакетный просмотр:</b> 3 поста подряд (+15 PTS)\n` +
    `💬 <b>Умные комментарии:</b> ИИ-генерация органичных мнений (+35 PTS)\n` +
    `🔥 <b>Реакции и просмотры:</b> мгновенное зачисление очков\n` +
    `🚀 <b>P2P-буст:</b> обмен очков на реальные просмотры вашего канала\n` +
    `🛡️ <b>Trust Score:</b> защита аккаунта от спам-блока и теневого бана\n\n` +
    `👇 <i>Нажмите кнопку ниже, чтобы запустить приложение:</i>`;

  const inlineKeyboard = Markup.inlineKeyboard([
    [
      isHttps
        ? Markup.button.webApp('🚀 Запустить DePIN Mini App', depinUrl)
        : Markup.button.url('🚀 Открыть DePIN в браузере', depinUrl)
    ],
    [Markup.button.callback('« Назад в главное меню', 'nav_start')]
  ]);

  return ctx.reply(text, {
    parse_mode: 'HTML',
    ...inlineKeyboard
  });
}

bot.action('nav_depin', async (ctx: BotContext) => {
  await ctx.answerCbQuery().catch(() => {});
  return sendDepinAppPrompt(ctx);
});

bot.command(['depin', 'boost', 'app', 'tma'], async (ctx: BotContext) => {
  return sendDepinAppPrompt(ctx);
});

bot.hears(/^(⚡\s*)?DePIN(\s*Задания)?(\s*\(Mini\s*App\))?$/i, async (ctx: BotContext) => {
  if (ctx.scene) await ctx.scene.leave().catch(() => {});
  return sendDepinAppPrompt(ctx);
});

bot.action(['nav_start', 'start', 'main_menu', 'home', 'nav_main_menu'], async (ctx: BotContext) => {
  await ctx.answerCbQuery().catch(() => {});
  if (ctx.scene) {
    await ctx.scene.leave().catch(() => {});
  }
  return sendMainMenu(ctx, true);
});

bot.action('start_fast_order', async (ctx: BotContext) => {
  await ctx.answerCbQuery().catch(() => {});
  return sendFastOrderPrompt(ctx);
});

bot.hears(['🚀 Заказать по ссылке', 'Заказать по ссылке', 'Быстрый заказ', 'Ввести ссылку', '🚀 Быстрый заказ'], async (ctx: BotContext) => {
  return sendFastOrderPrompt(ctx);
});

bot.command('menu', async (ctx: BotContext) => {
  return sendMainMenu(ctx, false);
});

bot.hears(/^(📱\s*)?Главное меню$/i, async (ctx: BotContext) => {
  if (ctx.scene) await ctx.scene.leave().catch(() => {});
  return sendMainMenu(ctx, false);
});

bot.hears(/^(📦\s*)?Мои заказы$/i, async (ctx: BotContext) => {
  if (ctx.scene) await ctx.scene.leave().catch(() => {});
  return sendUserOrders(ctx);
});

bot.hears(/^(💰\s*)?Баланс$/i, async (ctx: BotContext) => {
  if (ctx.scene) await ctx.scene.leave().catch(() => {});
  return sendUserProfile(ctx);
});

bot.hears(/^(🆘\s*)?Поддержка$/i, async (ctx: BotContext) => {
  if (ctx.scene) await ctx.scene.leave().catch(() => {});
  return sendSupportPrompt(ctx);
});

bot.action('cancel_fast_order', async (ctx: BotContext) => {
  await ctx.answerCbQuery('Отменено').catch(() => {});
  await ctx.editMessageText('❌ Ожидание ссылки отменено. Вы можете воспользоваться меню ниже:').catch(() => {});
});

bot.command(['shop', 'catalog'], async (ctx: BotContext) => {
  await sendNetworkCatalogMenu(ctx, false);
});

bot.hears(['🛍 Каталог услуг', 'Каталог услуг', '🛍 Каталог', 'Каталог', /^(🛍\s*Каталог|Каталог)/i], async (ctx: BotContext) => {
  await sendNetworkCatalogMenu(ctx, false);
});

export async function sendUserProfile(ctx: BotContext) {
  if (!ctx.from) return;
  const tgId = String(ctx.from.id);
  const user = await db.user.findFirst({ where: { telegramId: tgId, tenantId: botTenantId } });
  if (!user) return ctx.reply('Используйте /start для регистрации.');

  const orderCount = await db.order.count({
    where: { userId: user.id, ...(botTenantId ? { tenantId: botTenantId } : {}) }
  });

  const text =
    `👤 <b>Личный кабинет ${botSiteName}</b>\n\n` +
    `🆔 ID: <code>${user.id.slice(0, 8)}</code>\n` +
    `💰 Баланс: <b>${(Number(user.balance) / 100).toFixed(2)} ₽</b>\n` +
    `📦 Всего заказов: <b>${orderCount}</b>\n` +
    `👥 Реферальный код: <code>${user.referralCode || '—'}</code>\n\n` +
    `<i>Управляйте балансом, заказами и рефералами:</i>`;

  const isOwner = await isOwnerOrAdmin(tgId);
  const profileRows = [
    [Markup.button.callback('💰 Пополнить баланс', 'deposit'), Markup.button.callback('📦 Мои заказы', 'my_orders')],
    [Markup.button.callback('📜 История операций', 'my_tx'), Markup.button.callback('👥 Рефералы', 'referral')],
    [Markup.button.callback('🔗 Привязать к сайту', 'bind_account'), Markup.button.callback('🆘 Служба поддержки', 'support')]
  ];

  if (isOwner) {
    profileRows.unshift([Markup.button.callback('👑 Пульт Овнера / DevOps Hub', 'nav_owner_hub')]);
  }

  await ctx.reply(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard(profileRows)
  });
}

bot.hears(['👤 Профиль', 'Профиль', '👤 Личный кабинет', 'Личный кабинет', 'Кабинет', /^(👤\s*Профиль|Профиль|Личный кабинет)/i], sendUserProfile);
bot.command(['profile', 'me', 'account'], sendUserProfile);

bot.hears(['👑 Пульт Овнера', 'Пульт Овнера', '⚙️ Админка', '👑 Пульт управления', 'Админка', /^(👑\s*Пульт|Пульт Овнера)/i], async (ctx: BotContext) => {
  if (!ctx.from || !(await isOwnerOrAdmin(ctx.from.id))) {
    return ctx.reply('⛔ Доступ ограничен. Этот раздел доступен только владельцу платформы.');
  }
  return ctx.scene.enter('owner-hub');
});

bot.action('profile', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  await sendUserProfile(ctx);
});

bot.action('nav_owner_hub', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  if (!ctx.from || !(await isOwnerOrAdmin(ctx.from.id))) {
    return ctx.reply('⛔ Доступ ограничен.');
  }
  await auditAdminAwaitable({
    adminId: String(ctx.from.id),
    adminEmail: ctx.from.username ? `@${ctx.from.username}` : String(ctx.from.id),
    action: 'BOT_OWNER_HUB_ACCESS',
    target: String(ctx.from.id),
    targetType: 'TELEGRAM_BOT',
    newValue: {
      telegramId: String(ctx.from.id),
      username: ctx.from.username,
    },
  }).catch(() => {});
  return ctx.scene.enter('owner-hub');
});

bot.command('owner', async (ctx: BotContext) => {
  if (!ctx.from || !(await isOwnerOrAdmin(ctx.from.id))) {
    return ctx.reply('⛔ Доступ ограничен. Этот раздел доступен только владельцу платформы.');
  }
  await auditAdminAwaitable({
    adminId: String(ctx.from.id),
    adminEmail: ctx.from.username ? `@${ctx.from.username}` : String(ctx.from.id),
    action: 'BOT_OWNER_HUB_ACCESS',
    target: String(ctx.from.id),
    targetType: 'TELEGRAM_BOT',
    newValue: {
      telegramId: String(ctx.from.id),
      username: ctx.from.username,
    },
  }).catch(() => {});
  return ctx.scene.enter('owner-hub');
});

bot.command('id', async (ctx: BotContext) => {
  if (!ctx.from) return;
  const tgId = String(ctx.from.id);
  const user = await db.user.findFirst({ where: { telegramId: tgId } });
  const role = user?.role || 'Гость (не привязан)';
  const isOwner = await isOwnerOrAdmin(ctx.from.id);
  await ctx.reply(
    `🆔 <b>Ваш Telegram ID:</b> <code>${tgId}</code>\n` +
    `👤 <b>Привязанный аккаунт:</b> ${user?.email || 'Не привязан'}\n` +
    `🎭 <b>Роль в системе:</b> ${role}\n` +
    `👑 <b>Доступ к пульту овнера:</b> ${isOwner ? '✅ Разрешён (/owner)' : '❌ Ограничен'}`,
    { parse_mode: 'HTML' }
  );
});

bot.command('whoami', async (ctx: BotContext) => {
  if (!ctx.from) return;
  const tgId = String(ctx.from.id);
  const user = await db.user.findFirst({ where: { telegramId: tgId } });
  const role = user?.role || 'Гость (не привязан)';
  const isOwner = await isOwnerOrAdmin(ctx.from.id);
  await ctx.reply(
    `🆔 <b>Ваш Telegram ID:</b> <code>${tgId}</code>\n` +
    `👤 <b>Email:</b> ${user?.email || 'Не привязан'}\n` +
    `🎭 <b>Роль:</b> ${role}\n` +
    `👑 <b>Доступ к овнеру:</b> ${isOwner ? '✅ Разрешён' : '❌ Ограничен'}`,
    { parse_mode: 'HTML' }
  );
});

async function sendUserTransactions(ctx: BotContext) {
  if (!ctx.from) return;
  const tgId = String(ctx.from.id);
  const user = await db.user.findFirst({ where: { telegramId: tgId, tenantId: botTenantId } });
  if (!user) return ctx.reply('Используйте /start для регистрации.');

  const transactions = await db.ledgerEntry.findMany({
    where: { userId: user.id, ...(botTenantId ? { tenantId: botTenantId } : {}) },
    take: 8,
    orderBy: { createdAt: 'desc' }
  });

  if (transactions.length === 0) {
    return ctx.reply('📜 <b>История транзакций:</b>\n\nУ вас пока нет финансовых операций.', { parse_mode: 'HTML' });
  }

  let text = '📜 <b>История финансовых операций:</b>\n────────────────────\n\n';
  for (const tx of transactions) {
    const isCredit = tx.amount > BigInt(0);
    const sign = isCredit ? '➕' : '➖';
    const amountAbs = (Number(tx.amount < BigInt(0) ? -tx.amount : tx.amount) / 100).toFixed(2);
    const dateStr = new Date(tx.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    text += `${sign} <b>${amountAbs} ₽</b> [${tx.transactionType}]\n` +
      `   ├ ${escapeHtml(tx.reason || 'Операция')}\n` +
      `   └ <i>${dateStr}</i>\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'HTML' });
}

bot.action('my_tx', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  await sendUserTransactions(ctx);
});

bot.command('transactions', sendUserTransactions);

async function sendBindInstructions(ctx: BotContext) {
  const resolvedHost = getTenantHost(botTenantId);
  const host = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || (resolvedHost.startsWith('http') ? resolvedHost : `https://${resolvedHost}`);
  await ctx.reply(
    `🔗 <b>Связывание аккаунта ${botSiteName}</b>\n\n` +
    `Привяжите Telegram к сайту, чтобы синхронизировать баланс, получать уведомления о заказах и обращаться в поддержку без задержек.\n\n` +
    `<b>Как привязать:</b>\n` +
    `1. Войдите в аккаунт на сайте: ${host}/dashboard\n` +
    `2. Перейдите в <b>Личный кабинет</b> → вкладка <b>«Безопасность»</b> или нажмите <b>«Привязать Telegram»</b>.\n` +
    `3. Бот автоматически объединит баланс и историю заказов!\n\n` +
    `<i>Это безопасно: мы не передаем номер телефона и пароли.</i>`,
    {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...Markup.inlineKeyboard([
        [Markup.button.callback('💰 Проверить баланс', 'profile')],
        [Markup.button.callback('🛍 Каталог услуг', 'shop')]
      ])
    }
  );
}

bot.action('bind_account', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  await sendBindInstructions(ctx);
});

bot.action(/^confirm_bind:(.+)$/, async (ctx: BotContext) => {
  await ctx.answerCbQuery('Проверка привязки...').catch(() => {});
  if (!ctx.match || !ctx.from) return;
  const payload = ctx.match[1];
  const tgId = String(ctx.from.id);

  await ctx.editMessageText('⏳ <b>Привязываем аккаунт...</b>\n\nПожалуйста, подождите завершения операции.', {
    parse_mode: 'HTML'
  }).catch(() => {});

  const bindToken = await db.authToken.findFirst({
    where: { token: payload }
  });

  if (!bindToken || bindToken.used || bindToken.expiresAt <= new Date()) {
    return ctx.editMessageText(
      '⚠️ <b>Ссылка недействительна</b>\n\nСрок действия ссылки истек или она уже была использована. Сгенерируйте новую ссылку на сайте.',
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }

  const webUserId = bindToken.userId;

  try {
    await db.$transaction(async (tx) => {
      const consumedToken = await tx.authToken.updateMany({
        where: { id: bindToken.id, used: false },
        data: { used: true }
      });
      if (consumedToken.count === 0) {
        throw new Error("Токен привязки уже использован");
      }

      const tempUser = await tx.user.findFirst({ where: { telegramId: tgId, tenantId: botTenantId } });
      
      if (tempUser && tempUser.id !== webUserId) {
        // Refuse to hijack an established non-bot account
        if (!tempUser.isBotOnly) {
          throw new Error("Невозможно объединить: к Telegram уже привязан независимый веб-аккаунт.");
        }

        // Merge: move tickets to main account
        await tx.ticket.updateMany({
          where: { userId: tempUser.id },
          data: { userId: webUserId }
        });
        
        await tx.order.updateMany({ where: { userId: tempUser.id }, data: { userId: webUserId } });
        await tx.payment.updateMany({ where: { userId: tempUser.id }, data: { userId: webUserId } });
        await tx.invoice.updateMany({ where: { userId: tempUser.id }, data: { userId: webUserId } });
        await tx.auditLog.updateMany({ where: { userId: tempUser.id }, data: { userId: webUserId } });
        
        // Balance Transfer to preserve financial integrity and keep ledger immutable
        if (tempUser.balance > BigInt(0)) {
          const amount = Number(tempUser.balance);
          const reasonDebit = `Списание баланса при слиянии Telegram ${tempUser.email} с ${webUserId}`;
          const reasonCredit = `Перенос баланса со старого аккаунта Telegram ${tempUser.email}`;
          
          await WalletOps.charge(tx, tempUser.id, amount, reasonDebit, {
            idempotencyKey: `merge-debit-bot-${tempUser.id}-${webUserId}`
          });

          await WalletOps.credit(tx, webUserId, amount, reasonCredit, {
            idempotencyKey: `merge-credit-bot-${tempUser.id}-${webUserId}`
          });
        }
        
        // Re-assign telegramId and mark tempUser merged
        await tx.user.update({
          where: { id: tempUser.id },
          data: { 
            telegramId: null
          }
        });
      }

      // Link telegramId to web account
      await tx.user.update({
        where: { id: webUserId },
        data: { telegramId: tgId }
      });
    });

    await ctx.editMessageText(
      '🎉 <b>Аккаунт успешно привязан!</b>\n\n' +
      'Теперь вы можете управлять заказами и балансом прямо через Telegram-бота.',
      { parse_mode: 'HTML' }
    ).catch(() => {});

    return ctx.reply('Главное меню:', {
      ...Markup.keyboard([
        ['🛍 Каталог услуг', '📦 Мои заказы'],
        ['💰 Пополнить', '👤 Профиль'],
        ['🆘 Поддержка', '👥 Рефералы']
      ]).resize()
    });
  } catch (err: unknown) {
    console.error('[Bot Auth Bind] Transaction failed:', err);
    return ctx.editMessageText(
      '❌ <b>Ошибка привязки</b>\n\n' +
      (err instanceof Error ? err.message : 'Не удалось привязать аккаунт. Попробуйте создать новую ссылку в личном кабинете.'),
      { parse_mode: 'HTML' }
    ).catch(() => {});
  }
});

bot.action('cancel_bind', async (ctx: BotContext) => {
  await ctx.answerCbQuery('Привязка отменена').catch(() => {});
  return ctx.editMessageText(
    '❌ <b>Привязка аккаунта отменена</b>\n\nВаш текущий профиль Telegram и баланс в полной безопасности.',
    { parse_mode: 'HTML' }
  ).catch(() => {});
});

bot.action('support', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    '🎧 <b>Служба заботы о клиентах</b>\n\n' +
    'Напишите ваш вопрос, номер заказа или отправьте скриншот прямо в этот чат. Наш оператор ответит вам здесь же.',
    { parse_mode: 'HTML' }
  );
});

// Inline buttons from profile
bot.action('deposit', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(DEPOSIT_WIZARD);
});
bot.action('referral', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  return ctx.scene.enter(REFERRAL_WIZARD);
});
bot.action('shop', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  await sendNetworkCatalogMenu(ctx, false);
});
bot.action('my_orders', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  if (!ctx.from) return;
  const tgId = String(ctx.from.id);
  const user = await db.user.findFirst({ where: { telegramId: tgId, tenantId: botTenantId } });
  if (!user) return;
  const orders = await db.order.findMany({
    where: { userId: user.id, ...(botTenantId ? { tenantId: botTenantId } : {}) },
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { service: { select: { name: true } } }
  });
  if (orders.length === 0) {
    return ctx.reply('📦 У вас пока нет заказов.');
  }
  let text = '📦 <b>Последние заказы:</b>\n\n';
  for (const o of orders) {
    text += `#${o.numericId} — ${o.service?.name || 'Услуга'}\n` +
      `   ${o.quantity} шт. | ${(Number(o.charge) / 100).toFixed(2)}₽ | ${o.status}\n\n`;
  }
  await ctx.reply(text, { parse_mode: 'HTML' });
});

// ── CATALOG NAVIGATION ──
bot.action('cat_back_networks', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  await sendNetworkCatalogMenu(ctx, true);
});

// Callback handler: Select Network -> Show Categories
bot.action(/^cat_net_(.+)$/, async (ctx: BotContext) => {
  if (!ctx.match) return;
  const netId = ctx.match[1];
  try {
    const network = await db.network.findUnique({ where: { id: netId } });
    if (!network) return ctx.answerCbQuery('Социальная сеть не найдена');

    const categories = await BotCatalogService.getVisibleCategories(netId, botTenantId);

    if (categories.length === 0) {
      await ctx.answerCbQuery('В этой соцсети пока нет доступных категорий');
      return await sendNetworkCatalogMenu(ctx, true);
    }

    const buttons = categories.map((c: { id: string; name: string }) => [Markup.button.callback(c.name, `cat_ctg_${c.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад к списку сетей', 'cat_back_networks')]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(`🛍 <b>Каталог: ${network.name}</b>\nВыберите категорию услуг:`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }).catch(() => {});
  } catch (err) {
    console.error('[Bot Catalog Network Select] Error:', err);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Callback handler: Select Category -> Show Services
bot.action(/^cat_ctg_(.+)$/, async (ctx: BotContext) => {
  if (!ctx.match) return;
  const catId = ctx.match[1];
  try {
    const category = await db.category.findUnique({
      where: { id: catId },
      include: { network: true }
    });
    if (!category) return ctx.answerCbQuery('Категория не найдена');

    const { SettingsProvider } = await import('@/lib/settings');
    const { calculatePricePerUnit, formatPricePerUnit } = await import('./utils/formatter');
    const usdToRub = await SettingsProvider.getExchangeRateUSD();

    const services = await BotCatalogService.getVisibleServices(catId, botTenantId);

    if (services.length === 0) {
      await ctx.answerCbQuery('В этой категории пока нет доступных тарифов');
      return;
    }

    const buttons = services.map((s: { id: string; name: string; rate: number; markup: number; providerCurrency: string }) => {
      const pricePerUnit = calculatePricePerUnit(s, usdToRub);
      const label = `${s.name} — ${formatPricePerUnit(pricePerUnit)} ₽ / шт`;
      return [Markup.button.callback(label, `order_svc_${s.id}`)];
    });
    buttons.push([Markup.button.callback('⬅️ Назад к категориям', `cat_back_net_${category.networkId}`)]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(`🛍 <b>Каталог: ${category.network?.name} / ${category.name}</b>\nВыберите услугу для оформления заказа:`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }).catch(() => {});
  } catch (err) {
    console.error('[Bot Catalog Category Select] Error:', err);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Callback handler: Back to categories from service confirmation
bot.action(/^cat_back_net_(.+)$/, async (ctx: BotContext) => {
  if (!ctx.match) return;
  const netId = ctx.match[1];
  try {
    const network = await db.network.findUnique({ where: { id: netId } });
    if (!network) return ctx.answerCbQuery('Социальная сеть не найдена');

    const categories = await BotCatalogService.getVisibleCategories(netId, botTenantId);
    if (categories.length === 0) {
      await ctx.answerCbQuery('В этой соцсети пока нет доступных категорий');
      return await sendNetworkCatalogMenu(ctx, true);
    }

    const buttons = categories.map((c: { id: string; name: string }) => [Markup.button.callback(c.name, `cat_ctg_${c.id}`)]);
    buttons.push([Markup.button.callback('⬅️ Назад к списку сетей', 'cat_back_networks')]);

    await ctx.answerCbQuery();
    await ctx.editMessageText(`🛍 <b>Каталог: ${network.name}</b>\nВыберите категорию услуг:`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(buttons)
    }).catch(() => {});
  } catch (err) {
    console.error('[Bot Catalog Back Net] Error:', err);
    await ctx.answerCbQuery('Произошла ошибка');
  }
});

// Inline handler: Start order wizard with pre-selected service
bot.action(/^order_svc_(.+)$/, async (ctx: BotContext) => {
  if (!ctx.match) return;
  const serviceId = ctx.match[1];
  const service = await BotCatalogService.getServiceForOrder(serviceId, botTenantId);
  if (!service) {
    await ctx.answerCbQuery('Эта услуга временно недоступна или находится на техобслуживании');
    return;
  }
  const preFilledLink = (ctx.session as Record<string, unknown> | undefined)?.activeLink as string | undefined;
  if (ctx.session) {
    delete (ctx.session as Record<string, unknown>).activeLink;
  }
  await ctx.answerCbQuery();
  return ctx.scene.enter(ORDER_WIZARD, { 
    preSelectedService: service,
    preFilledLink: preFilledLink || undefined
  });
});

export async function sendSupportPrompt(ctx: BotContext) {
  await ctx.reply(
    '🎧 <b>Я всегда на связи!</b>\n\n' +
    'Просто напишите ваш вопрос, отправьте фото или голосовое сообщение прямо в этот чат, и оператор ответит вам здесь же.',
    { parse_mode: 'HTML' }
  );
}

export async function sendUserOrders(ctx: BotContext) {
  if (!ctx.from) return;
  const tgId = String(ctx.from.id);
  const user = await db.user.findFirst({ where: { telegramId: tgId, tenantId: botTenantId } });
  if (!user) return ctx.reply('Используйте /start для регистрации.');

  const orders = await db.order.findMany({
    where: { userId: user.id, ...(botTenantId ? { tenantId: botTenantId } : {}) },
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: { service: { select: { name: true } } }
  });

  if (orders.length === 0) {
    return ctx.reply('📦 У вас пока нет заказов.');
  }

  const statusEmoji: Record<string, string> = {
    'PENDING': '🕐', 'IN_PROGRESS': '🔄', 'COMPLETED': '✅',
    'PARTIAL': '⚠️', 'CANCELED': '❌', 'ERROR': '🔴',
    'AWAITING_PAYMENT': '💳', 'PROVISIONING': '⏳'
  };

  let text = '📦 <b>Ваши последние заказы:</b>\n\n';
  for (const o of orders) {
    const emoji = statusEmoji[o.status] || '❓';
    text += `${emoji} #${o.numericId} — ${o.service?.name || 'Услуга'}\n` +
      `   ${o.quantity} шт. | ${(Number(o.charge) / 100).toFixed(2)}₽ | ${o.status}\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'HTML' });
}

// ── ROBUST MULTI-ALIAS MENU HANDLERS ──

bot.hears(['💰 Пополнить', '💰 Пополнить баланс', 'Пополнить баланс', 'Пополнить', /^(💰\s*Пополнить|Пополнить)/i], async (ctx: BotContext) => {
  return ctx.scene.enter(DEPOSIT_WIZARD);
});
bot.command(['deposit', 'pay', 'balance'], async (ctx: BotContext) => {
  return ctx.scene.enter(DEPOSIT_WIZARD);
});

bot.hears(['🆘 Поддержка', 'Поддержка', '🆘 Помощь', 'Помощь', 'Оператор', /^(🆘\s*Поддержка|Поддержка|Помощь)/i], async (ctx: BotContext) => {
  return sendSupportPrompt(ctx);
});
bot.command(['support', 'help'], async (ctx: BotContext) => {
  return sendSupportPrompt(ctx);
});

bot.hears(['👥 Рефералы', 'Рефералы', 'Реферальная программа', 'Партнерам', /^(👥\s*Рефералы|Рефералы)/i], async (ctx: BotContext) => {
  return ctx.scene.enter(REFERRAL_WIZARD);
});
bot.command(['ref', 'referral'], async (ctx: BotContext) => {
  return ctx.scene.enter(REFERRAL_WIZARD);
});

bot.hears(['📦 Мои заказы', 'Мои заказы', 'Заказы', 'История заказов', /^(📦\s*Мои заказы|Мои заказы|Заказы)/i], async (ctx: BotContext) => {
  return sendUserOrders(ctx);
});
bot.command(['orders', 'myorders'], async (ctx: BotContext) => {
  return sendUserOrders(ctx);
});

// ── CSAT RATING CALLBACK ──
bot.action(/^rate:([^:]+):(\d+)$/, async (ctx: BotContext) => {
  if (!ctx.match) return;
  try {
    await ctx.answerCbQuery('Оценка принята!').catch(() => {});
    const ticketId = ctx.match[1];
    const score = Math.max(1, Math.min(5, Number(ctx.match[2])));

    try {
      const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
      if (ticket) {
        const newTags = Array.from(new Set([...(ticket.tags || []), `CSAT_${score}_STAR`]));
        await db.ticket.update({
          where: { id: ticketId },
          data: { tags: newTags }
        });

        await db.ticketFeedback.upsert({
          where: { ticketId },
          create: {
            ticketId,
            userId: ticket.userId,
            score,
            source: 'TELEGRAM',
            tenantId: ticket.tenantId || botTenantId,
            reasons: []
          },
          update: {
            score
          }
        });
      }
    } catch (dbErr) {
      console.error('[Bot] Error saving CSAT feedback to DB:', dbErr);
    }

    // Determine reason options
    let reasonList: string[] = [];
    try {
      const cfg = await BotSettingsService.getRatingReasons(botTenantId);
      if (score <= 2) reasonList = cfg.negative;
      else if (score === 3) reasonList = cfg.neutral;
      else reasonList = cfg.positive;
    } catch {
      reasonList = score <= 2 ? ['Долгий ответ', 'Проблема не решена'] : ['Быстро и вежливо', 'Вопрос решен'];
    }

    const stars = '⭐'.repeat(score);
    const reasonButtons = reasonList.slice(0, 4).map((r, idx) => [
      Markup.button.callback(r, `fb_rsn:${ticketId}:${idx}`)
    ]);
    reasonButtons.push([Markup.button.callback('✨ Пропустить', `fb_done:${ticketId}`)]);

    await ctx.editMessageText(
      `⭐ <b>Спасибо за оценку ${stars} (${score}/5)!</b>\n\nУточните, пожалуйста, что именно повлияло на вашу оценку:`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(reasonButtons)
      }
    ).catch(() => {});
  } catch (e) {
    console.error('[Bot] Rating action error:', e);
  }
});

// ── CSAT REASON CALLBACK ──
bot.action(/^fb_rsn:([^:]+):(\d+)$/, async (ctx: BotContext) => {
  if (!ctx.match) return;
  try {
    await ctx.answerCbQuery('Принято!').catch(() => {});
    const ticketId = ctx.match[1];
    const reasonIdx = Number(ctx.match[2]);

    let selectedReason = 'Качественный сервис';
    let thanksText = '⭐ <b>Спасибо за ваш отзыв!</b>\n\nВаш отзыв помогает нам становиться лучше. Если у вас возникнут новые вопросы, просто напишите в этот чат.';

    try {
      const cfg = await BotSettingsService.getRatingReasons(botTenantId);
      const tpl = await BotSettingsService.getTemplates(botTenantId);
      const fb = await db.ticketFeedback.findUnique({ where: { ticketId } });
      if (tpl?.ratingThanks) thanksText = tpl.ratingThanks;

      const score = fb?.score || 5;
      let reasonList: string[] = [];
      if (score <= 2) reasonList = cfg.negative;
      else if (score === 3) reasonList = cfg.neutral;
      else reasonList = cfg.positive;

      if (reasonList[reasonIdx]) {
        selectedReason = reasonList[reasonIdx];
      }

      if (fb) {
        const updatedReasons = Array.from(new Set([...(fb.reasons || []), selectedReason]));
        await db.ticketFeedback.update({
          where: { ticketId },
          data: { reasons: updatedReasons }
        });
      }
    } catch (err) {
      console.error('[Bot] Error saving feedback reason:', err);
    }

    thanksText = thanksText
      .replace(/{stars}/g, '⭐'.repeat(5))
      .replace(/{reasons}/g, escapeHtml(selectedReason));

    await ctx.editMessageText(
      `✅ <b>Отзыв принят: «${escapeHtml(selectedReason)}»</b>\n\n${thanksText}`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  } catch (e) {
    console.error('[Bot] Reason action error:', e);
  }
});

// ── CSAT SKIP REASON CALLBACK ──
bot.action(/^fb_done:([^:]+)$/, async (ctx: BotContext) => {
  if (!ctx.match) return;
  try {
    await ctx.answerCbQuery().catch(() => {});
    let thanksText = '⭐ <b>Спасибо за вашу оценку!</b>\n\nЕсли у вас возникнут новые вопросы, просто напишите в этот чат.';
    try {
      const tpl = await BotSettingsService.getTemplates(botTenantId);
      if (tpl?.ratingThanks) thanksText = tpl.ratingThanks.replace(/{stars}/g, '⭐⭐⭐⭐⭐');
    } catch { /* use default */ }

    await ctx.editMessageText(thanksText, { parse_mode: 'HTML' }).catch(() => {});
  } catch (e) {
    console.error('[Bot] Done action error:', e);
  }
});

function isPotentialLinkOrHandle(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 500) return false;
  const urlPattern = /^(https?:\/\/|t\.me\/|vk\.com\/|instagram\.com\/|youtube\.com\/|youtu\.be\/|tiktok\.com\/|ok\.ru\/|rutube\.ru\/|dzen\.ru\/|twitch\.tv\/|x\.com\/|twitter\.com\/|@[\w_]{3,})/i;
  const generalUrlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\/[^\s]*)/i;
  return urlPattern.test(trimmed) || generalUrlRegex.test(trimmed);
}

async function handleLinkInput(ctx: BotContext, rawInput: string) {
  try {
    const { IntelligenceLinkAnalyzer } = await import('@/services/analyzer/link-analyzer');
    const analyzer = new IntelligenceLinkAnalyzer();
    const analysis = await analyzer.analyze(rawInput);

    if (!analysis || analysis.platform === 'OTHER') {
      await ctx.reply(
        '🔍 <b>Не удалось автоматически определить социальную сеть по вашей ссылке.</b>\n\n' +
        'Пожалуйста, выберите нужный раздел вручную из каталога либо обратитесь в поддержку:',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🛍 Открыть каталог', 'shop')],
            [Markup.button.callback('🆘 Задать вопрос поддержке', 'support')]
          ])
        }
      );
      return;
    }

    const network = await BotCatalogService.findNetworkByPlatform(analysis.platform, botTenantId);
    if (!network) {
      await ctx.reply(
        `🔍 <b>Распознано: ${analysis.platform}</b>\n\n` +
        `К сожалению, для этой социальной сети сейчас нет активных услуг.\n` +
        `Вы можете выбрать другое направление в каталоге:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🛍 Открыть каталог', 'shop')]
          ])
        }
      );
      return;
    }

    const categories = await BotCatalogService.getVisibleCategories(network.id, botTenantId);
    if (categories.length === 0) {
      await ctx.reply(
        `🔍 <b>Распознано: ${network.name}</b>\n\n` +
        `В этой соцсети пока нет доступных категорий.\n` +
        `Выберите другую соцсеть в каталоге:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🛍 Открыть каталог', 'shop')]
          ])
        }
      );
      return;
    }

    const canonicalLink = analysis.canonicalUrl || rawInput.trim();
    if (!ctx.session) (ctx as unknown as { session: Record<string, unknown> }).session = {};
    (ctx.session as Record<string, unknown>).activeLink = canonicalLink;

    // SMART CATEGORY FILTER: Filter out incompatible categories (e.g. post likes for channel links)
    const { isLinkServiceCompatible, normalizeServiceTargetType } = await import('@/constants/link-service-compatibility');
    const { resolveServiceTargetType } = await import('@/utils/target-type-mapper');

    const detectedType = analysis.type || 'generic_link';
    const compatibleCategories: Array<{ id: string; name: string }> = [];

    for (const c of categories) {
      const svcs = await BotCatalogService.getVisibleServices(c.id, botTenantId);
      const hasCompatibleService = svcs.some((s: { targetType?: string | null; name: string }) => {
        const rawTarget = resolveServiceTargetType(s);
        const normalized = normalizeServiceTargetType(rawTarget);
        return isLinkServiceCompatible(detectedType, normalized);
      });
      if (hasCompatibleService) {
        compatibleCategories.push(c);
      }
    }

    const displayedCategories = compatibleCategories.length > 0 ? compatibleCategories : categories;

    const buttons = displayedCategories.map((c: { id: string; name: string }) => [
      Markup.button.callback(c.name, `cat_ctg_${c.id}`)
    ]);
    buttons.push([Markup.button.callback('⬅️ Все соцсети', 'cat_back_networks')]);

    const typeLabels: Record<string, string> = {
      channel: '📢 Канал / Сообщество',
      post: '📝 Публикация / Пост',
      profile: '👤 Профиль / Аккаунт',
      video: '🎬 Видео / Клип / Shorts',
      story: '⚡ История / Story',
      poll: '📊 Опрос / Голосование',
      bot: '🤖 Telegram-бот'
    };
    const objectTitle = typeLabels[analysis.type] || (analysis.type ? `(${analysis.type})` : '');

    await ctx.reply(
      `🎯 <b>Ссылка успешно распознана!</b>\n` +
      `🌐 Соцсеть: <b>${network.name}</b>\n` +
      (objectTitle ? `📌 Тип объекта: <b>${objectTitle}</b>\n` : '') +
      `🔗 Ссылка: <code>${escapeHtml(canonicalLink)}</code>\n\n` +
      `<i>Подобраны только совместимые категории продвижения:</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      }
    );
  } catch (err) {
    console.error('[Bot Link Input] Error:', err);
    await ctx.reply(
      '⚠️ Произошла ошибка при анализе ссылки. Пожалуйста, откройте каталог вручную:',
      {
        ...Markup.inlineKeyboard([[Markup.button.callback('🛍 Открыть каталог', 'shop')]])
      }
    );
  }
}

// ── CATCH-ALL (SMART LINK ANALYZER & SUPPORT DIRECT CHAT) ──
bot.on(['text', 'photo', 'voice', 'document', 'video', 'sticker', 'video_note', 'location'], async (ctx: BotContext) => {
  // 1. Check if user sent an unsupported format
  const msg = ctx.message as Record<string, unknown> | undefined;
  if (msg && (msg.video || msg.sticker || msg.video_note || msg.location)) {
    return ctx.reply('⚠️ К сожалению, мы не можем просматривать стикеры, кружочки или геолокации. Пожалуйста, отправьте текст, скриншот (фото) или голосовое сообщение.');
  }

  const text = (msg && 'text' in msg && typeof msg.text === 'string') ? msg.text.trim() : '';

  // 1.5. DYNAMIC MENU BUTTON DISPATCHER: Check if text matches any custom button configured in Admin Panel
  if (text) {
    const isHandled = await dispatchDynamicMenuAction(ctx, text);
    if (isHandled) {
      return;
    }
  }

  // 2. SMART LINK-FIRST FLOW: If message is or contains a link / handle, run analyzer
  if (text && isPotentialLinkOrHandle(text)) {
    return await handleLinkInput(ctx, text);
  }

  // 3. DIRECT SUPPORT CHAT: Resolve or Auto-Create User for Telegram Support
  if (!ctx.from) return;
  const tgId = String(ctx.from.id);
  let user = await db.user.findFirst({ where: { telegramId: tgId, tenantId: botTenantId } });
  if (!user) {
    const emailStub = `tg_${tgId}@${botTenantId}.bot`;
    user = await db.user.upsert({
      where: { email_tenantId: { email: emailStub, tenantId: botTenantId } },
      update: { telegramId: tgId },
      create: {
        email: emailStub,
        telegramId: tgId,
        tenantId: botTenantId,
      }
    });
  }

  try {
    const { supportBotService } = await import('@/services/support/support-bot.service');
    await supportBotService.handleIncomingMessage(ctx, user.id);
  } catch (e: unknown) {
    console.error('[Bot] Catch-all Support Error:', e);
    await ctx.reply('❌ Ошибка при отправке сообщения в поддержку.').catch(() => {});
  }
});

// ── LAUNCH ──
let isBotLaunched = false;
let isRedisSubscribed = false;

async function setupBotRedisSubscriber() {
  if (isRedisSubscribed) return;
  try {
    const { Redis } = await import('ioredis');
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const sub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
    await sub.connect();
    await sub.subscribe('bot:reload');
    isRedisSubscribed = true;
    sub.on('message', async (channel, msg) => {
      if (channel === 'bot:reload') {
        console.info('[Bot] 🔄 Received bot:reload event from Admin Panel:', msg);
        try {
          BotSettingsService.invalidate(botTenantId);
          try {
            bot.stop('Reload');
          } catch { /* ignore if not running */ }
          isBotLaunched = false;
          await new Promise(r => setTimeout(r, 1000));
          await launchBot();
        } catch (rErr) {
          console.error('[Bot] Failed to hot-reload bot after admin update:', rErr);
        }
      }
    });
    console.info('[Bot] 📡 Real-time settings listener active on Redis channel "bot:reload"');
  } catch (err) {
    console.warn('[Bot] Redis subscriber setup skipped:', err);
  }
}

export async function launchBot() {
  if (isBotLaunched) {
    console.info('[Bot] Bot instance is already running.');
    return;
  }

  // 1. Authoritative Source of Truth: load token from Admin Settings (PostgreSQL SystemSettings)
  let activeToken: string | null = null;
  try {
    activeToken = await BotSettingsService.getBotToken(botTenantId);
    if (activeToken) {
      console.info(`[Bot] 🔑 Loaded active bot token for tenant "${botTenantId}" from Admin Settings`);
    }
  } catch (dbErr) {
    console.warn('[Bot] Failed to read token from Admin Settings:', dbErr);
  }

  // 2. Secondary fallback to process.env.TELEGRAM_BOT_TOKEN ONLY if valid token
  if (!activeToken) {
    const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (envToken && /^\d{8,11}:[A-Za-z0-9_-]{35}$/.test(envToken) && !envToken.includes('YOUR_') && envToken !== 'dummy_token') {
      activeToken = envToken;
      console.info(`[Bot] 🔑 Using fallback bot token from environment variable`);
    }
  }

  if (!activeToken) {
    console.warn(`[Bot] ⚠️ Telegram bot token for tenant "${botTenantId}" is not set or invalid in Admin Settings. Bot daemon will wait for token configuration.`);
    isBotLaunched = false;
    // Schedule watchdog check in 30s to re-check if token was configured in Admin Panel
    setTimeout(() => {
      if (!isBotLaunched) {
        launchBot().catch(() => {});
      }
    }, 30_000);
    return;
  }

  process.env.TELEGRAM_BOT_TOKEN = activeToken;
  // NOTE: Telegraf.token is a getter-only property (throws TypeError on set).
  // Set the token via telegram instance and options only:
  (bot.telegram as any).token = activeToken;
  (bot as any).options = (bot as any).options || {};
  (bot as any).options.token = activeToken;

  isBotLaunched = true;
  setupBotRedisSubscriber().catch(() => {});

  const MAX_LAUNCH_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt++) {
    let currentProxyUrl: string | undefined = undefined;
    try {
      // Ensure agent is dynamically assigned from DB pool if not configured in ENV
      if (!agent) {
        currentProxyUrl = await resolveActiveTelegramProxyUrl(botTenantId);
        if (currentProxyUrl) {
          const dynamicAgent = getTelegramProxyAgent(currentProxyUrl);
          if (dynamicAgent) {
            (bot.telegram as any).options = (bot.telegram as any).options || {};
            (bot.telegram as any).options.agent = dynamicAgent;
            console.info(`[Bot] 🛡️ [Attempt ${attempt}/${MAX_LAUNCH_ATTEMPTS}] Dynamic proxy assigned: ${currentProxyUrl.replace(/:[^:@]+@/, ':***@')}`);
          }
        }
      }

      console.info('[Bot] Deleting any lingering webhook...');
      await bot.telegram.deleteWebhook({ drop_pending_updates: true });
      
      const me = await bot.telegram.getMe();
      console.info(`[Bot] ✅ Telegram bot @${me.username} (ID: ${me.id}) initialized.`);

      try {
        await bot.telegram.setMyCommands([
          { command: 'depin', description: '⚡ Запустить DePIN Mini App' },
          { command: 'boost', description: '🚀 P2P-буст и задания' },
          { command: 'menu', description: '📱 Главное меню' },
          { command: 'orders', description: '📦 Мои заказы' },
          { command: 'balance', description: '💰 Баланс и пополнение' },
          { command: 'support', description: '🆘 Поддержка' },
          { command: 'start', description: '🚀 Перезапуск бота' },
        ]);
        console.info('[Bot] Menu commands configured.');
      } catch (err) {
        console.warn('[Bot] Failed to set menu commands:', err);
      }

      // Heartbeat for Docker healthcheck and Admin UI status monitor
      try {
        const { redis } = await import('@/lib/redis');
        await redis.set('bot:heartbeat', Date.now(), 'EX', 60).catch(() => {});
        setInterval(() => {
          redis.set('bot:heartbeat', Date.now(), 'EX', 60).catch(() => {});
        }, 30_000);
      } catch (redisErr) {
        console.warn('[Bot] Redis heartbeat setup skipped:', redisErr);
      }

      // Fix node-fetch AbortSignal prototype check in Node 20
      try {
        const sig = new AbortController().signal;
        const sigProto = Object.getPrototypeOf(sig);
        if (sigProto && sigProto.constructor && sigProto.constructor.name !== 'AbortSignal') {
          Object.defineProperty(sigProto.constructor, 'name', { value: 'AbortSignal', configurable: true });
        }
      } catch { /* ignore */ }

      await bot.launch({ dropPendingUpdates: true });

      console.info(`[Bot] 🚀 Telegram bot @${me.username} is now actively polling for updates!`);
      break; // Successfully launched
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[Bot] ❌ Launch attempt ${attempt}/${MAX_LAUNCH_ATTEMPTS} failed: ${errMsg}`);

      if (attempt < MAX_LAUNCH_ATTEMPTS) {
        // Re-probe direct connectivity: maybe Clash Verge was enabled/disabled since last check
        try {
          const directNow = await Promise.race<boolean>([
            fetch('https://api.telegram.org', { method: 'HEAD', signal: AbortSignal.timeout(2000) })
              .then(r => r.status < 500).catch(() => false),
            new Promise<boolean>(res => setTimeout(() => res(false), 2100)),
          ]);
          if (directNow) {
            // Direct connection recovered — clear proxy and retry without it
            console.info('[Bot] 🔄 Direct connectivity restored — clearing proxy, retrying without proxy...');
            const tgOpts = bot.telegram as unknown as { options?: { agent?: unknown } };
            tgOpts.options = tgOpts.options || {};
            tgOpts.options.agent = undefined;
            currentProxyUrl = undefined;
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
        } catch { /* ignore */ }

        // Proxy failed and direct is still blocked — rotate to next proxy
        if (!agent && currentProxyUrl) {
          await reportTelegramProxyFailure(currentProxyUrl);
          console.warn(`[Bot] 🔄 Rotating to next proxy from pool in 1.5s...`);
        }
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      break;
    }
  }

  // ── Watchdog: if polling crashes after successful launch, restart automatically ──
  isBotLaunched = false; // allow re-launch
  const WATCHDOG_DELAY = 15_000;
  console.warn(`[Bot] ⚠️ Bot polling ended unexpectedly. Watchdog restarting in ${WATCHDOG_DELAY / 1000}s...`);
  setTimeout(() => {
    launchBot().catch(err => console.error('[Bot] Watchdog restart failed:', err));
  }, WATCHDOG_DELAY);
}

if (process.env.NODE_ENV !== 'test' && !process.env.NEXT_PHASE && process.env.SKIP_BOT !== 'true') {
  launchBot();
}

/**
 * --- GRACEFUL SHUTDOWN ---
 * Handles SIGTERM/SIGINT signals from Docker/PM2/tini
 */
async function handleShutdown(signal: string) {
  console.info(`[Bot] --- Signal ${signal} received. Graceful shutdown ---`);
  try {
    bot.stop(signal);
  } catch (err: unknown) {
    console.error('[Bot] Error stopping bot:', err);
  }
  process.exit(0);
}

process.once('SIGINT', () => handleShutdown('SIGINT'));
process.once('SIGTERM', () => handleShutdown('SIGTERM'));
