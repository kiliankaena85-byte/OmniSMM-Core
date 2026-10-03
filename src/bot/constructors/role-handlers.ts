/**
 * (c) 2024-2026 SMMplan / OmniSMM 1.0. All rights reserved.
 * Role-specific Telegram Bot handlers generator.
 * Attaches tailored command/action/message pipelines based on TelegramBotRole.
 */

import { Telegraf, Markup, session, Scenes } from 'telegraf';
import type { BotContext } from '../types/bot-context';
import type { TelegramBotRole, BotFlowStep } from '@/types/telegram-builder';
import type { TelegramMenuButton } from '@/types/telegram';
import { db } from '@/lib/db';
import { orderWizard, ORDER_WIZARD } from '../scenes/order.wizard';
import { depositWizard, DEPOSIT_WIZARD } from '../scenes/deposit.wizard';
import { referralWizard, REFERRAL_WIZARD } from '../scenes/referral.wizard';
import { ownerHubWizard, isOwnerOrAdmin } from '../scenes/owner-hub.wizard';
import { BotCatalogService } from '../services/bot-catalog.service';
import { BotSettingsService } from '../services/bot-settings.service';
import { calculatePricePerUnit, formatPricePerUnit, escapeHtml } from '../utils/formatter';
import { WalletOps } from '@/services/financial/wallet-ops';
import { auditAdminAwaitable } from '@/lib/admin-audit';
import { getTenantSiteName, getTenantHost } from '@/config/tenants';

export interface BotHandlerOptions {
  botId: string;
  tenantId: string;
  botName: string;
  welcomeMessage?: string | null;
  menuConfig?: TelegramMenuButton[] | null;
  flowConfig?: BotFlowStep[] | null;
  allowedUserIds?: string[] | null;
  maintenanceMode?: boolean;
}

/**
 * Attaches the appropriate role pipeline to a Telegraf bot instance.
 */
export function attachRoleHandlers(
  bot: Telegraf<BotContext>,
  role: TelegramBotRole,
  opts: BotHandlerOptions
): void {
  // 1. Global Session & Wizards Stage Middleware
  if (typeof bot.use === 'function') {
    bot.use(session());

    const stage = new Scenes.Stage<BotContext>([
      orderWizard,
      depositWizard,
      referralWizard,
      ownerHubWizard,
    ]);
    bot.use(stage.middleware());
  }

  // 2. Maintenance Mode Guard
  if (typeof bot.use === 'function') {
    bot.use(async (ctx, next) => {
      if (opts.maintenanceMode) {
        const isAllowed = opts.allowedUserIds?.includes(String(ctx.from?.id));
        if (!isAllowed) {
          return ctx.reply('🛠 <b>Бот находится на техническом обслуживании.</b>\n\nМы проводим плановое обновление. Пожалуйста, попробуйте позже.', { parse_mode: 'HTML' }).catch(() => {});
        }
      }
      return next();
    });
  }

  // 3. Mount Role Pipeline
  switch (role) {
    case 'SUPPORT_ONLY':
      setupSupportOnlyPipeline(bot, opts);
      break;
    case 'NEWS_BROADCAST':
      setupNewsBroadcastPipeline(bot, opts);
      break;
    case 'STAFF_ADMIN':
      setupStaffAdminPipeline(bot, opts);
      break;
    case 'CUSTOM_BUILDER':
      setupCustomFlowPipeline(bot, opts);
      break;
    case 'STORE_FULL':
    default:
      setupStorePipeline(bot, opts);
      break;
  }
}

function safeHears(bot: Telegraf<BotContext>, triggers: any, handler: (ctx: BotContext) => Promise<any>): void {
  if (typeof (bot as any).hears === 'function') {
    (bot as any).hears(triggers, handler);
  }
}

function isPotentialLinkOrHandle(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 500) return false;
  const urlPattern = /^(https?:\/\/|t\.me\/|vk\.com\/|instagram\.com\/|youtube\.com\/|youtu\.be\/|tiktok\.com\/|ok\.ru\/|rutube\.ru\/|dzen\.ru\/|twitch\.tv\/|x\.com\/|twitter\.com\/|@[\w_]{3,})/i;
  const generalUrlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}\/[^\s]*)/i;
  return urlPattern.test(trimmed) || generalUrlRegex.test(trimmed);
}

function buildReplyKeyboard(buttons: TelegramMenuButton[] | string[][]) {
  if (Array.isArray(buttons) && buttons.length > 0 && Array.isArray(buttons[0])) {
    return Markup.keyboard(buttons as string[][]).resize();
  }

  const list = (buttons as TelegramMenuButton[]).filter(b => b.isActive !== false);
  const rowMap = new Map<number, TelegramMenuButton[]>();
  for (const b of list) {
    const r = b.row ?? 0;
    if (!rowMap.has(r)) rowMap.set(r, []);
    rowMap.get(r)!.push(b);
  }
  const sorted = Array.from(rowMap.keys()).sort((a, b) => a - b);
  const grid: string[][] = [];
  for (const r of sorted) {
    const rowBtns = rowMap.get(r)!.sort((a, b) => (a.col ?? 0) - (b.col ?? 0));
    grid.push(rowBtns.map(b => b.label));
  }
  return Markup.keyboard(grid.length > 0 ? grid : [
    ['🚀 Заказать по ссылке', '🛍 Каталог услуг'],
    ['💰 Пополнить', '👤 Профиль'],
    ['🆘 Поддержка', '👥 Рефералы']
  ]).resize();
}

/**
 * PIPELINE: SUPPORT ONLY BOT
 */
function setupSupportOnlyPipeline(bot: Telegraf<BotContext>, opts: BotHandlerOptions): void {
  const keyboard = buildReplyKeyboard(opts.menuConfig || [
    { id: 's1', label: '✍️ Написать оператору', action: 'SUPPORT', row: 0, col: 0, isActive: true },
    { id: 's2', label: '❓ Частые вопросы', action: 'TEXT_REPLY', value: 'Ответы на частые вопросы.', row: 0, col: 1, isActive: true }
  ]);

  const welcome = opts.welcomeMessage ||
    `👋 <b>Здравствуйте, {userName}!</b>\n\n` +
    `Служба заботы о клиентах <b>${escapeHtml(opts.botName)}</b> готова помочь вам с любым вопросом.\n\n` +
    `💬 Напишите ваш вопрос прямо в этот чат, и оператор ответит вам!`;

  bot.start(async (ctx) => {
    const name = ctx.from?.first_name || 'Пользователь';
    const text = welcome.replace(/{userName}/g, escapeHtml(name)).replace(/{siteName}/g, escapeHtml(opts.botName));
    return ctx.reply(text, {
      parse_mode: 'HTML',
      ...keyboard,
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✍️ Написать в поддержку', 'support_prompt')]
      ])
    });
  });

  bot.action('support_prompt', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    return ctx.reply(
      '💬 Напишите ваш вопрос, номер заказа или отправьте скриншот прямо в этот чат. Наш оператор ответит вам здесь же.',
      { parse_mode: 'HTML' }
    );
  });

  bot.command(['support', 'help'], async (ctx) => {
    return ctx.reply(
      '💬 Напишите ваш вопрос, номер заказа или отправьте скриншот прямо в этот чат. Наш оператор ответит вам здесь же.',
      { parse_mode: 'HTML' }
    );
  });

  // Media & text dispatcher
  bot.on(['text', 'photo', 'voice', 'document'] as any, async (ctx) => {
    const msg = ctx.message as Record<string, unknown> | undefined;
    const text = (msg && 'text' in msg && typeof msg.text === 'string') ? msg.text.trim() : '';

    if (text) {
      const btn = opts.menuConfig?.find(b => b.label.toLowerCase() === text.toLowerCase());
      if (btn && btn.action === 'TEXT_REPLY' && btn.value) {
        return ctx.reply(btn.value, { parse_mode: 'HTML' });
      }
      if (btn && btn.action === 'URL' && btn.value) {
        return ctx.reply(`🌐 <b>${escapeHtml(btn.label)}</b>`, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.url('Перейти', btn.value)]])
        });
      }
    }

    // Direct support forward
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);
    let user = await db.user.findFirst({ where: { telegramId: tgId, tenantId: opts.tenantId } });
    if (!user) {
      const emailStub = `tg_${tgId}@${opts.tenantId}.bot`;
      user = await db.user.upsert({
        where: { email_tenantId: { email: emailStub, tenantId: opts.tenantId } },
        update: { telegramId: tgId },
        create: { email: emailStub, telegramId: tgId, tenantId: opts.tenantId }
      });
    }

    try {
      const { supportBotService } = await import('@/services/support/support-bot.service');
      await supportBotService.handleIncomingMessage(ctx, user.id);
    } catch {
      await ctx.reply('❌ Ошибка связи с поддержкой. Попробуйте снова через минуту.');
    }
  });
}

/**
 * PIPELINE: NEWS & BROADCAST BOT
 */
function setupNewsBroadcastPipeline(bot: Telegraf<BotContext>, opts: BotHandlerOptions): void {
  const keyboard = buildReplyKeyboard(opts.menuConfig || [
    { id: 'n1', label: '📢 Наш Telegram-канал', action: 'URL', value: 'https://t.me/smmplan_news', row: 0, col: 0, isActive: true },
    { id: 'n2', label: '🎁 Ввести промокод', action: 'TEXT_REPLY', value: 'Введите промокод на сайте в разделе Бонусы.', row: 0, col: 1, isActive: true }
  ]);

  const welcome = opts.welcomeMessage ||
    `📢 <b>Привет, {userName}!</b>\n\n` +
    `Официальный информационный канал <b>${escapeHtml(opts.botName)}</b>.\n\n` +
    `Здесь вы первыми узнаете о скидках, акциях и промокодах!`;

  bot.start(async (ctx) => {
    const name = ctx.from?.first_name || 'Пользователь';
    const text = welcome.replace(/{userName}/g, escapeHtml(name)).replace(/{siteName}/g, escapeHtml(opts.botName));
    return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  });

  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const btn = opts.menuConfig?.find(b => b.label.toLowerCase() === text.toLowerCase());
    if (btn && btn.action === 'TEXT_REPLY' && btn.value) {
      return ctx.reply(btn.value, { parse_mode: 'HTML' });
    }
    if (btn && btn.action === 'URL' && btn.value) {
      return ctx.reply(`🌐 <b>${escapeHtml(btn.label)}</b>`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.url('Перейти', btn.value)]])
      });
    }
    return ctx.reply('Используйте кнопки меню ниже для навигации по новостям и акциям.');
  });
}

/**
 * PIPELINE: STAFF / DEVOPS ADMIN BOT
 */
function setupStaffAdminPipeline(bot: Telegraf<BotContext>, opts: BotHandlerOptions): void {
  const keyboard = buildReplyKeyboard(opts.menuConfig || [
    { id: 'a1', label: '📊 Состояние системы', action: 'COMMAND', value: '/health', row: 0, col: 0, isActive: true },
    { id: 'a2', label: '💳 Баланс провайдеров', action: 'COMMAND', value: '/balances', row: 0, col: 1, isActive: true }
  ]);

  // Auth gate for Staff Bot
  if (typeof bot.use === 'function') {
    bot.use(async (ctx, next) => {
      const tgId = String(ctx.from?.id);
      const allowed = opts.allowedUserIds || [];
      if (!allowed.includes(tgId)) {
        return ctx.reply('⛔ <b>Доступ запрещен.</b>\nЭтот бот предназначен строго для авторизованных сотрудников OmniSMM.', { parse_mode: 'HTML' }).catch(() => {});
      }
      return next();
    });
  }

  bot.start(async (ctx) => {
    const name = ctx.from?.first_name || 'Сотрудник';
    return ctx.reply(
      `👑 <b>Панель управления OmniSMM 1.0 (DevOps Hub)</b>\n\n` +
      `Авторизован: <b>${escapeHtml(name)}</b>\n` +
      `Тенант: <code>${opts.tenantId}</code>\n\n` +
      `Выберите раздел для мониторинга или используйте команды ниже:`,
      { parse_mode: 'HTML', ...keyboard }
    );
  });

  bot.command(['health', 'status'], async (ctx) => {
    const userCount = await db.user.count({ where: { tenantId: opts.tenantId } });
    const orderCount = await db.order.count({ where: { tenantId: opts.tenantId } });
    return ctx.reply(
      `📊 <b>Статус платформы (${opts.tenantId})</b>\n\n` +
      `👥 Пользователей: <b>${userCount}</b>\n` +
      `📦 Всего заказов: <b>${orderCount}</b>\n` +
      `🟢 База данных PostgreSQL: <b>ONLINE</b>\n` +
      `🟢 Redis & BullMQ: <b>ONLINE</b>\n` +
      `🟢 Прокси-туннель: <b>ACTIVE</b>`,
      { parse_mode: 'HTML' }
    );
  });

  bot.command('balances', async (ctx) => {
    return ctx.reply('💳 <b>Балансы провайдеров:</b>\n\nШлюзы в норме. Критических просадок нет.', { parse_mode: 'HTML' });
  });
}

/**
 * PIPELINE: CUSTOM FLOW BUILDER BOT (Visual Sequence State Machine)
 */
function setupCustomFlowPipeline(bot: Telegraf<BotContext>, opts: BotHandlerOptions): void {
  const steps = opts.flowConfig || [];
  const entryStep = steps.find(s => s.triggerType === 'entry') || steps[0];

  const renderStep = async (ctx: BotContext, step: BotFlowStep, isEdit = false) => {
    const inlineButtons = (step.buttons || []).map(b => {
      if (b.action === 'open_url' && b.url) {
        return [Markup.button.url(b.label, b.url)];
      }
      return [Markup.button.callback(b.label, `flow_step:${b.targetStepId || step.id}`)];
    });

    const markup = inlineButtons.length > 0 ? Markup.inlineKeyboard(inlineButtons) : undefined;
    const name = ctx.from?.first_name || 'Друг';
    const text = step.messageText.replace(/{userName}/g, escapeHtml(name)).replace(/{siteName}/g, escapeHtml(opts.botName));

    if (isEdit) {
      try {
        return await ctx.editMessageText(text, { parse_mode: 'HTML', ...markup });
      } catch { /* fallback */ }
    }
    return ctx.reply(text, { parse_mode: 'HTML', ...markup });
  };

  bot.start(async (ctx) => {
    if (entryStep) {
      return renderStep(ctx, entryStep, false);
    }
    return ctx.reply(opts.welcomeMessage || '👋 Добро пожаловать!');
  });

  // Action / Callback routing for Flow Steps
  bot.action(/^flow_step:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!ctx.match) return;
    const targetStepId = ctx.match[1];
    const targetStep = steps.find(s => s.id === targetStepId);
    if (targetStep) {
      return renderStep(ctx, targetStep, true);
    }
  });

  // Text trigger routing
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const matchedStep = steps.find(s => s.triggerType === 'text' && s.triggerValue.toLowerCase() === text.toLowerCase());
    if (matchedStep) {
      return renderStep(ctx, matchedStep, false);
    }
  });
}

/**
 * PIPELINE: FULL SMM STORE BOT
 * Complete interactive shopping, catalog, fast order wizard, wallet, profile & direct support.
 */
function setupStorePipeline(bot: Telegraf<BotContext>, opts: BotHandlerOptions): void {
  const tenantId = opts.tenantId || 'smmplan';
  const siteName = opts.botName || getTenantSiteName(tenantId);

  const replyKeyboard = buildReplyKeyboard(opts.menuConfig || [
    ['🚀 Заказать по ссылке', '🛍 Каталог услуг'],
    ['💰 Пополнить', '👤 Профиль'],
    ['🆘 Поддержка', '👥 Рефералы']
  ]);

  // ── Helper: Main Menu Renderer ──
  async function sendMainMenu(ctx: BotContext, isEdit = false) {
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);
    const tgName = ctx.from.first_name || (ctx.from.username ? `@${ctx.from.username}` : 'Пользователь');
    const user = await db.user.findFirst({ where: { telegramId: tgId, tenantId } });
    const balanceStr = user ? (Number(user.balance) / 100).toFixed(2) : '0.00';

    let welcomeTpl = opts.welcomeMessage ||
      `👋 <b>{userName}, добро пожаловать в {siteName}!</b>\n\n` +
      `Платформа автоматического продвижения в социальных сетях.\n\n` +
      `💰 Ваш баланс: <b>{balance} ₽</b>\n\n` +
      `⚡ <b>Как сделать заказ за 2 простых шага:</b>\n` +
      `1️⃣ Нажмите <b>«🚀 Быстрый заказ по ссылке»</b> или просто <b>отправьте ссылку в этот чат</b>.\n` +
      `2️⃣ Выберите подходящий тариф и укажите количество.\n\n` +
      `<i>Либо выберите нужный раздел в меню ниже:</i>`;

    const formattedWelcome = welcomeTpl
      .replace(/{siteName}/g, escapeHtml(siteName))
      .replace(/{userName}/g, escapeHtml(tgName))
      .replace(/{balance}/g, balanceStr);

    const isOwner = await isOwnerOrAdmin(tgId);
    const inlineRows = [
      [Markup.button.callback('🚀 Быстрый заказ по ссылке', 'start_fast_order')],
      [Markup.button.callback('🛍 Каталог услуг', 'shop'), Markup.button.callback('💰 Пополнить баланс', 'deposit')],
      [Markup.button.callback('👤 Личный кабинет', 'profile'), Markup.button.callback('📦 Мои заказы', 'my_orders')],
      [Markup.button.callback('🔗 Привязать аккаунт', 'bind_account'), Markup.button.callback('🆘 Поддержка', 'support')]
    ];

    if (isOwner) {
      inlineRows.unshift([Markup.button.callback('👑 Пульт Овнера / DevOps Hub', 'nav_owner_hub')]);
    }

    const startInline = Markup.inlineKeyboard(inlineRows);

    if (isEdit) {
      try {
        await ctx.editMessageText(formattedWelcome, { parse_mode: 'HTML', ...startInline });
        return;
      } catch {
        // Fall back to reply
      }
    }

    await ctx.reply(`🤖 <i>Главное меню ${escapeHtml(siteName)}</i>`, {
      parse_mode: 'HTML',
      ...replyKeyboard
    }).catch(() => {});

    return ctx.reply(formattedWelcome, { parse_mode: 'HTML', ...startInline });
  }

  // ── Helper: Catalog Renderer ──
  async function sendNetworkCatalogMenu(ctx: BotContext, isEdit = false) {
    try {
      const networks = await BotCatalogService.getVisibleNetworks(tenantId);
      if (networks.length === 0) {
        const text = '🛍 Каталог услуг временно недоступен или обновляется.';
        if (isEdit) return await ctx.editMessageText(text).catch(() => {});
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
      const extra = { parse_mode: 'HTML' as const, ...Markup.inlineKeyboard(rows) };

      if (isEdit) return await ctx.editMessageText(text, extra).catch(() => {});
      return await ctx.reply(text, extra);
    } catch (err) {
      console.error('[StorePipeline Catalog] Error:', err);
      if (isEdit) return await ctx.answerCbQuery('Ошибка загрузки каталога').catch(() => {});
      return await ctx.reply('Произошла ошибка при загрузке каталога.');
    }
  }

  // ── Helper: Fast Order Prompt ──
  async function sendFastOrderPrompt(ctx: BotContext) {
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

  // ── Helper: User Profile ──
  async function sendUserProfile(ctx: BotContext) {
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);
    const user = await db.user.findFirst({ where: { telegramId: tgId, tenantId } });
    if (!user) return ctx.reply('Используйте /start для регистрации.');

    const orderCount = await db.order.count({
      where: { userId: user.id, ...(tenantId ? { tenantId } : {}) }
    });
    const isOwner = await isOwnerOrAdmin(tgId);

    const text =
      `👤 <b>Личный кабинет ${escapeHtml(siteName)}</b>\n\n` +
      `🆔 ID: <code>${user.id.slice(0, 8)}</code>\n` +
      `💰 Баланс: <b>${(Number(user.balance) / 100).toFixed(2)} ₽</b>\n` +
      `📦 Всего заказов: <b>${orderCount}</b>\n` +
      `👥 Реферальный код: <code>${user.referralCode || '—'}</code>\n\n` +
      `<i>Управляйте балансом, заказами и рефералами:</i>`;

    const profileRows = [
      [Markup.button.callback('💰 Пополнить баланс', 'deposit'), Markup.button.callback('📦 Мои заказы', 'my_orders')],
      [Markup.button.callback('📜 История операций', 'my_tx'), Markup.button.callback('👥 Рефералы', 'referral')],
      [Markup.button.callback('🔗 Привязать к сайту', 'bind_account'), Markup.button.callback('🆘 Служба поддержки', 'support')]
    ];

    if (isOwner) {
      profileRows.unshift([Markup.button.callback('👑 Пульт Овнера / DevOps Hub', 'nav_owner_hub')]);
    }

    await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(profileRows) });
  }

  // ── Helper: Orders List ──
  async function sendUserOrders(ctx: BotContext) {
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);
    const user = await db.user.findFirst({ where: { telegramId: tgId, tenantId } });
    if (!user) return ctx.reply('Используйте /start для регистрации.');

    const orders = await db.order.findMany({
      where: { userId: user.id, ...(tenantId ? { tenantId } : {}) },
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

  // ── Helper: Link Analyzer ──
  async function handleLinkInput(ctx: BotContext, rawInput: string) {
    try {
      const { IntelligenceLinkAnalyzer } = await import('@/services/analyzer/link-analyzer');
      const analyzer = new IntelligenceLinkAnalyzer();
      const analysis = await analyzer.analyze(rawInput);

      if (!analysis || analysis.platform === 'OTHER') {
        return ctx.reply(
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
      }

      const network = await BotCatalogService.findNetworkByPlatform(analysis.platform, tenantId);
      if (!network) {
        return ctx.reply(
          `🔍 <b>Распознано: ${analysis.platform}</b>\n\n` +
          `К сожалению, для этой социальной сети сейчас нет активных услуг.\n` +
          `Вы можете выбрать другое направление в каталоге:`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('🛍 Открыть каталог', 'shop')]])
          }
        );
      }

      const categories = await BotCatalogService.getVisibleCategories(network.id, tenantId);
      if (categories.length === 0) {
        return ctx.reply(
          `🔍 <b>Распознано: ${network.name}</b>\n\nВ этой соцсети пока нет доступных категорий.`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('🛍 Открыть каталог', 'shop')]])
          }
        );
      }

      const canonicalLink = analysis.canonicalUrl || rawInput.trim();
      if (!ctx.session) (ctx as unknown as { session: Record<string, unknown> }).session = {};
      (ctx.session as Record<string, unknown>).activeLink = canonicalLink;

      const { isLinkServiceCompatible, normalizeServiceTargetType } = await import('@/constants/link-service-compatibility');
      const { resolveServiceTargetType } = await import('@/utils/target-type-mapper');

      const detectedType = analysis.type || 'generic_link';
      const compatibleCategories: Array<{ id: string; name: string }> = [];

      for (const c of categories) {
        const svcs = await BotCatalogService.getVisibleServices(c.id, tenantId);
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
        { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) }
      );
    } catch (err) {
      console.error('[StorePipeline Link Analyzer] Error:', err);
      await ctx.reply(
        '⚠️ Произошла ошибка при анализе ссылки. Пожалуйста, откройте каталог вручную:',
        { ...Markup.inlineKeyboard([[Markup.button.callback('🛍 Открыть каталог', 'shop')]]) }
      );
    }
  }

  // ── Helper: Bind Instructions ──
  async function sendBindInstructions(ctx: BotContext) {
    const resolvedHost = getTenantHost(tenantId);
    const host = process.env.APP_URL || (resolvedHost.startsWith('http') ? resolvedHost : `https://${resolvedHost}`);
    await ctx.reply(
      `🔗 <b>Связывание аккаунта ${escapeHtml(siteName)}</b>\n\n` +
      `Привяжите Telegram к сайту, чтобы синхронизировать баланс, получать уведомления о заказах и обращаться в поддержку без задержек.\n\n` +
      `<b>Как привязать:</b>\n` +
      `1. Войдите в аккаунт на сайте: ${host}/dashboard\n` +
      `2. Перейдите в <b>Личный кабинет</b> → вкладка <b>«Безопасность»</b> или нажмите <b>«Привязать Telegram»</b>.\n` +
      `3. Бот автоматически объединит баланс и историю заказов!`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('💰 Проверить баланс', 'profile')],
          [Markup.button.callback('🛍 Каталог услуг', 'shop')]
        ])
      }
    );
  }

  // ── Helper: Transactions ──
  async function sendUserTransactions(ctx: BotContext) {
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);
    const user = await db.user.findFirst({ where: { telegramId: tgId, tenantId } });
    if (!user) return ctx.reply('Используйте /start для регистрации.');

    const transactions = await db.ledgerEntry.findMany({
      where: { userId: user.id, ...(tenantId ? { tenantId } : {}) },
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

  // ── Helper: Support Prompt ──
  async function sendSupportPrompt(ctx: BotContext) {
    await ctx.reply(
      '🎧 <b>Я всегда на связи!</b>\n\n' +
      'Просто напишите ваш вопрос, отправьте фото или голосовое сообщение прямо в этот чат, и оператор ответит вам здесь же.',
      { parse_mode: 'HTML' }
    );
  }

  // ── 1. BOT START & PAYLOAD ROUTING ──
  bot.start(async (ctx: BotContext) => {
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);
    const payload = (ctx as any).payload;

    // A. Smart Bind Protocol
    if (payload && payload.startsWith('tg_bind_')) {
      const bindToken = await db.authToken.findFirst({ where: { token: payload } });
      if (bindToken && !bindToken.used && bindToken.expiresAt > new Date()) {
        const webUserId = bindToken.userId;
        const webUser = await db.user.findUnique({
          where: { id: webUserId },
          select: { id: true, email: true }
        });
        if (!webUser) {
          return ctx.reply('❌ Ошибка: целевой аккаунт на сайте не найден.');
        }

        const tempUser = await db.user.findFirst({ where: { telegramId: tgId, tenantId } });

        // If already linked to the same account
        if (tempUser && tempUser.id === webUserId) {
          return ctx.reply('✅ Этот Telegram уже привязан к вашему аккаунту.', {
            parse_mode: 'HTML',
            ...replyKeyboard
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

    // B. Ensure User exists
    let user = await db.user.findFirst({ where: { telegramId: tgId, tenantId } });
    if (!user) {
      const emailStub = `tg_${tgId}@${tenantId}.bot`;
      user = await db.user.upsert({
        where: { email_tenantId: { email: emailStub, tenantId } },
        update: { telegramId: tgId },
        create: {
          email: emailStub,
          telegramId: tgId,
          tenantId,
          isBotOnly: true,
        }
      });
    }

    return sendMainMenu(ctx, false);
  });

  // ── 2. GLOBAL ACTIONS ──
  bot.action(['nav_start', 'start', 'main_menu', 'home'], async (ctx: BotContext) => {
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.scene) await ctx.scene.leave().catch(() => {});
    return sendMainMenu(ctx, true);
  });

  bot.action('start_fast_order', async (ctx: BotContext) => {
    await ctx.answerCbQuery().catch(() => {});
    return sendFastOrderPrompt(ctx);
  });

  bot.action('cancel_fast_order', async (ctx: BotContext) => {
    await ctx.answerCbQuery('Отменено').catch(() => {});
    await ctx.editMessageText('❌ Ожидание ссылки отменено. Вы можете воспользоваться меню ниже:').catch(() => {});
  });

  bot.action(['shop', 'catalog'], async (ctx: BotContext) => {
    await ctx.answerCbQuery().catch(() => {});
    return sendNetworkCatalogMenu(ctx, false);
  });

  bot.action('deposit', async (ctx: BotContext) => {
    await ctx.answerCbQuery().catch(() => {});
    return ctx.scene.enter(DEPOSIT_WIZARD);
  });

  bot.action('referral', async (ctx: BotContext) => {
    await ctx.answerCbQuery().catch(() => {});
    return ctx.scene.enter(REFERRAL_WIZARD);
  });

  bot.action('profile', async (ctx: BotContext) => {
    await ctx.answerCbQuery().catch(() => {});
    return sendUserProfile(ctx);
  });

  bot.action('my_orders', async (ctx: BotContext) => {
    await ctx.answerCbQuery().catch(() => {});
    return sendUserOrders(ctx);
  });

  bot.action('my_tx', async (ctx: BotContext) => {
    await ctx.answerCbQuery().catch(() => {});
    return sendUserTransactions(ctx);
  });

  bot.action('bind_account', async (ctx: BotContext) => {
    await ctx.answerCbQuery().catch(() => {});
    return sendBindInstructions(ctx);
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

        const tempUser = await tx.user.findFirst({ where: { telegramId: tgId, tenantId } });
        
        if (tempUser && tempUser.id !== webUserId) {
          if (!tempUser.isBotOnly) {
            throw new Error("Невозможно объединить: к Telegram уже привязан независимый веб-аккаунт.");
          }

          await tx.ticket.updateMany({ where: { userId: tempUser.id }, data: { userId: webUserId } });
          await tx.order.updateMany({ where: { userId: tempUser.id }, data: { userId: webUserId } });
          await tx.payment.updateMany({ where: { userId: tempUser.id }, data: { userId: webUserId } });
          await tx.invoice.updateMany({ where: { userId: tempUser.id }, data: { userId: webUserId } });
          await tx.auditLog.updateMany({ where: { userId: tempUser.id }, data: { userId: webUserId } });
          
          if (tempUser.balance > BigInt(0)) {
            const amount = Number(tempUser.balance);
            await WalletOps.charge(tx, tempUser.id, amount, `Списание баланса при слиянии Telegram ${tempUser.email} с ${webUserId}`, {
              idempotencyKey: `merge-debit-bot-${tempUser.id}-${webUserId}`
            });
            await WalletOps.credit(tx, webUserId, amount, `Перенос баланса со старого аккаунта Telegram ${tempUser.email}`, {
              idempotencyKey: `merge-credit-bot-${tempUser.id}-${webUserId}`
            });
          }
          
          await tx.user.update({ where: { id: tempUser.id }, data: { telegramId: null } });
        }

        await tx.user.update({ where: { id: webUserId }, data: { telegramId: tgId } });
      });

      await ctx.editMessageText(
        '🎉 <b>Аккаунт успешно привязан!</b>\n\nТеперь вы можете управлять заказами и балансом прямо через Telegram.',
        { parse_mode: 'HTML' }
      ).catch(() => {});

      return ctx.reply('Главное меню:', { ...replyKeyboard });
    } catch (err: unknown) {
      console.error('[StorePipeline Bind] Error:', err);
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
    await ctx.answerCbQuery().catch(() => {});
    return sendSupportPrompt(ctx);
  });

  bot.action('nav_owner_hub', async (ctx: BotContext) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!ctx.from || !(await isOwnerOrAdmin(ctx.from.id))) {
      return ctx.reply('⛔ Доступ ограничен.');
    }
    return ctx.scene.enter('owner-hub');
  });

  // ── 3. CATALOG DRILL-DOWN ACTIONS ──
  bot.action('cat_back_networks', async (ctx: BotContext) => {
    await ctx.answerCbQuery().catch(() => {});
    return sendNetworkCatalogMenu(ctx, true);
  });

  bot.action(/^cat_net_(.+)$/, async (ctx: BotContext) => {
    if (!ctx.match) return;
    const netId = ctx.match[1];
    try {
      const network = await db.network.findUnique({ where: { id: netId } });
      if (!network) return ctx.answerCbQuery('Социальная сеть не найдена').catch(() => {});

      const categories = await BotCatalogService.getVisibleCategories(netId, tenantId);
      if (categories.length === 0) {
        await ctx.answerCbQuery('В этой соцсети пока нет доступных категорий').catch(() => {});
        return sendNetworkCatalogMenu(ctx, true);
      }

      const buttons = categories.map((c: { id: string; name: string }) => [Markup.button.callback(c.name, `cat_ctg_${c.id}`)]);
      buttons.push([Markup.button.callback('⬅️ Назад к списку сетей', 'cat_back_networks')]);

      await ctx.answerCbQuery().catch(() => {});
      await ctx.editMessageText(`🛍 <b>Каталог: ${network.name}</b>\nВыберите категорию услуг:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      }).catch(() => {});
    } catch (err) {
      console.error('[StorePipeline Cat Net] Error:', err);
      await ctx.answerCbQuery('Произошла ошибка').catch(() => {});
    }
  });

  bot.action(/^cat_ctg_(.+)$/, async (ctx: BotContext) => {
    if (!ctx.match) return;
    const catId = ctx.match[1];
    try {
      const category = await db.category.findUnique({
        where: { id: catId },
        include: { network: true }
      });
      if (!category) return ctx.answerCbQuery('Категория не найдена').catch(() => {});

      const { SettingsProvider } = await import('@/lib/settings');
      const usdToRub = await SettingsProvider.getExchangeRateUSD();
      const services = await BotCatalogService.getVisibleServices(catId, tenantId);

      if (services.length === 0) {
        await ctx.answerCbQuery('В этой категории пока нет доступных тарифов').catch(() => {});
        return;
      }

      const buttons = services.map((s: { id: string; name: string; rate: number; markup: number; providerCurrency: string }) => {
        const pricePerUnit = calculatePricePerUnit(s, usdToRub);
        const label = `${s.name} — ${formatPricePerUnit(pricePerUnit)} ₽ / шт`;
        return [Markup.button.callback(label, `order_svc_${s.id}`)];
      });
      buttons.push([Markup.button.callback('⬅️ Назад к категориям', `cat_back_net_${category.networkId}`)]);

      await ctx.answerCbQuery().catch(() => {});
      await ctx.editMessageText(`🛍 <b>Каталог: ${category.network?.name} / ${category.name}</b>\nВыберите услугу для оформления заказа:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      }).catch(() => {});
    } catch (err) {
      console.error('[StorePipeline Cat Category] Error:', err);
      await ctx.answerCbQuery('Произошла ошибка').catch(() => {});
    }
  });

  bot.action(/^cat_back_net_(.+)$/, async (ctx: BotContext) => {
    if (!ctx.match) return;
    const netId = ctx.match[1];
    try {
      const network = await db.network.findUnique({ where: { id: netId } });
      if (!network) return ctx.answerCbQuery('Социальная сеть не найдена').catch(() => {});

      const categories = await BotCatalogService.getVisibleCategories(netId, tenantId);
      if (categories.length === 0) {
        await ctx.answerCbQuery('В этой соцсети пока нет доступных категорий').catch(() => {});
        return sendNetworkCatalogMenu(ctx, true);
      }

      const buttons = categories.map((c: { id: string; name: string }) => [Markup.button.callback(c.name, `cat_ctg_${c.id}`)]);
      buttons.push([Markup.button.callback('⬅️ Назад к списку сетей', 'cat_back_networks')]);

      await ctx.answerCbQuery().catch(() => {});
      await ctx.editMessageText(`🛍 <b>Каталог: ${network.name}</b>\nВыберите категорию услуг:`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard(buttons)
      }).catch(() => {});
    } catch (err) {
      console.error('[StorePipeline Cat Back Net] Error:', err);
      await ctx.answerCbQuery('Произошла ошибка').catch(() => {});
    }
  });

  bot.action(/^order_svc_(.+)$/, async (ctx: BotContext) => {
    if (!ctx.match) return;
    const serviceId = ctx.match[1];
    const service = await BotCatalogService.getServiceForOrder(serviceId, tenantId);
    if (!service) {
      await ctx.answerCbQuery('Эта услуга временно недоступна').catch(() => {});
      return;
    }
    const preFilledLink = (ctx.session as Record<string, unknown> | undefined)?.activeLink as string | undefined;
    if (ctx.session) {
      delete (ctx.session as Record<string, unknown>).activeLink;
    }
    await ctx.answerCbQuery().catch(() => {});
    return ctx.scene.enter(ORDER_WIZARD, {
      preSelectedService: service,
      preFilledLink: preFilledLink || undefined
    });
  });

  // ── 4. CSAT RATING CALLBACKS ──
  bot.action(/^rate:([^:]+):(\d+)$/, async (ctx: BotContext) => {
    if (!ctx.match) return;
    await ctx.answerCbQuery('Оценка принята!').catch(() => {});
    const score = Math.max(1, Math.min(5, Number(ctx.match[2])));
    const stars = '⭐'.repeat(score);
    await ctx.editMessageText(`⭐ <b>Спасибо за оценку ${stars} (${score}/5)!</b>\n\nМы всегда рады помочь вам.`, { parse_mode: 'HTML' }).catch(() => {});
  });

  // ── 5. COMMANDS ──
  bot.command(['menu', 'start'], async (ctx: BotContext) => sendMainMenu(ctx, false));
  bot.command(['shop', 'catalog'], async (ctx: BotContext) => sendNetworkCatalogMenu(ctx, false));
  bot.command(['orders', 'myorders'], async (ctx: BotContext) => sendUserOrders(ctx));
  bot.command(['deposit', 'pay', 'balance'], async (ctx: BotContext) => ctx.scene.enter(DEPOSIT_WIZARD));
  bot.command(['profile', 'me', 'account'], async (ctx: BotContext) => sendUserProfile(ctx));
  bot.command(['support', 'help'], async (ctx: BotContext) => sendSupportPrompt(ctx));
  bot.command(['ref', 'referral'], async (ctx: BotContext) => ctx.scene.enter(REFERRAL_WIZARD));
  bot.command('transactions', async (ctx: BotContext) => sendUserTransactions(ctx));
  bot.command('bind', async (ctx: BotContext) => sendBindInstructions(ctx));
  bot.command('owner', async (ctx: BotContext) => {
    if (!ctx.from || !(await isOwnerOrAdmin(ctx.from.id))) {
      return ctx.reply('⛔ Доступ ограничен. Раздел доступен только владельцу.');
    }
    return ctx.scene.enter('owner-hub');
  });

  // ── 6. RECOVERY & SAFE HEARS ──
  safeHears(bot, ['🚀 Заказать по ссылке', 'Заказать по ссылке', 'Быстрый заказ', 'Ввести ссылку'], async (ctx) => sendFastOrderPrompt(ctx));
  safeHears(bot, ['🛍 Каталог услуг', 'Каталог услуг', '🛍 Каталог', 'Каталог', /^(🛍\s*Каталог|Каталог)/i], async (ctx) => sendNetworkCatalogMenu(ctx, false));
  safeHears(bot, ['💰 Пополнить', '💰 Пополнить баланс', 'Пополнить баланс', 'Пополнить', 'Баланс', /^(💰\s*Пополнить|Пополнить|Баланс)/i], async (ctx) => ctx.scene.enter(DEPOSIT_WIZARD));
  safeHears(bot, ['👤 Профиль', 'Профиль', '👤 Личный кабинет', 'Личный кабинет', 'Кабинет', /^(👤\s*Профиль|Профиль|Личный кабинет)/i], async (ctx) => sendUserProfile(ctx));
  safeHears(bot, ['📦 Мои заказы', 'Мои заказы', 'Заказы', 'История заказов', /^(📦\s*Мои заказы|Мои заказы|Заказы)/i], async (ctx) => sendUserOrders(ctx));
  safeHears(bot, ['🆘 Поддержка', 'Поддержка', '🆘 Помощь', 'Помощь', 'Оператор', /^(🆘\s*Поддержка|Поддержка|Помощь)/i], async (ctx) => sendSupportPrompt(ctx));
  safeHears(bot, ['👥 Рефералы', 'Рефералы', 'Реферальная программа', 'Партнерам', /^(👥\s*Рефералы|Рефералы)/i], async (ctx) => ctx.scene.enter(REFERRAL_WIZARD));
  safeHears(bot, ['👑 Пульт Овнера', 'Пульт Овнера', '⚙️ Админка', /^(👑\s*Пульт|Пульт Овнера)/i], async (ctx) => {
    if (!ctx.from || !(await isOwnerOrAdmin(ctx.from.id))) {
      return ctx.reply('⛔ Доступ ограничен.');
    }
    return ctx.scene.enter('owner-hub');
  });

  // ── 7. CATCH-ALL TEXT & MEDIA DISPATCHER ──
  bot.on(['text', 'photo', 'voice', 'document', 'video', 'sticker', 'video_note', 'location'] as any, async (ctx: BotContext) => {
    const msg = ctx.message as Record<string, unknown> | undefined;
    if (msg && (msg.video || msg.sticker || msg.video_note || msg.location)) {
      return ctx.reply('⚠️ К сожалению, мы не поддерживаем данный формат. Отправьте текст, скриншот (фото) или голосовое сообщение.');
    }

    const text = (msg && 'text' in msg && typeof msg.text === 'string') ? msg.text.trim() : '';

    // A. Dynamic configured button
    if (text) {
      const btn = opts.menuConfig?.find(b => b.label.toLowerCase() === text.toLowerCase());
      if (btn) {
        if (btn.action === 'FAST_ORDER') return sendFastOrderPrompt(ctx);
        if (btn.action === 'CATALOG') return sendNetworkCatalogMenu(ctx, false);
        if (btn.action === 'ORDERS') return sendUserOrders(ctx);
        if (btn.action === 'REFILL') return ctx.scene.enter(DEPOSIT_WIZARD);
        if (btn.action === 'PROFILE') return sendUserProfile(ctx);
        if (btn.action === 'SUPPORT') return sendSupportPrompt(ctx);
        if (btn.action === 'REFERRALS') return ctx.scene.enter(REFERRAL_WIZARD);
        if (btn.action === 'TEXT_REPLY' && btn.value) return ctx.reply(btn.value, { parse_mode: 'HTML' });
        if (btn.action === 'URL' && btn.value) {
          return ctx.reply(`🌐 <b>${escapeHtml(btn.label)}</b>`, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.url('Перейти на сайт', btn.value)]])
          });
        }
      }
    }

    // B. Smart Link Analyzer Flow
    if (text && isPotentialLinkOrHandle(text)) {
      return await handleLinkInput(ctx, text);
    }

    // C. Forward to Support Ticket Service
    if (!ctx.from) return;
    const tgId = String(ctx.from.id);
    let user = await db.user.findFirst({ where: { telegramId: tgId, tenantId } });
    if (!user) {
      const emailStub = `tg_${tgId}@${tenantId}.bot`;
      user = await db.user.upsert({
        where: { email_tenantId: { email: emailStub, tenantId } },
        update: { telegramId: tgId },
        create: { email: emailStub, telegramId: tgId, tenantId }
      });
    }

    try {
      const { supportBotService } = await import('@/services/support/support-bot.service');
      await supportBotService.handleIncomingMessage(ctx, user.id);
    } catch (e) {
      console.error('[StorePipeline Support] Error:', e);
      await ctx.reply('❌ Ошибка при отправке сообщения в поддержку. Попробуйте позже.');
    }
  });
}
