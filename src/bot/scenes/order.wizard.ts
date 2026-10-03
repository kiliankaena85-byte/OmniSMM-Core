/**
 * (c) 2024-2026 SMMplan. All rights reserved.
 * Created by Artem (http://artmspektr.ru)
 * Unauthorized copying of this file is strictly prohibited.
 *
 * MIGRATED TO SMMPLAN LITE CORE (April 2026)
 * Uses: db from @/lib/db, Service model, User.telegramId,
 *       orderService.createBotOrder(), marketingService.calculatePrice()
 */
import { Scenes, Markup } from 'telegraf';
import { db } from '@/lib/db';
import { orderService } from '@/services/core/order.service';
import { marketingService } from '@/services/marketing.service';
import { UnifiedPaymentService } from '@/services/financial/unified-payment.service';
import { escapeHtml } from '../utils/formatter';
import { formatCents } from '@/lib/utils';
import { getDripFeedFloorViolation } from '@/services/orders/drip-feed-floor';
import type { BotContext } from '../types/bot-context';
import { handleWizardMenuNavigation } from '../utils/menu-navigation';

export const ORDER_WIZARD = 'order-wizard';

export interface WizardOrderService {
  id: string;
  numericId: number;
  name: string;
  pricePer1000Cents: number;
  minQty: number;
  maxQty: number;
  isDripFeedEnabled?: boolean;
  rate?: number;
  markup?: number;
  providerCurrency?: string;
  category?: {
    name?: string;
    network?: {
      slug?: string;
    } | null;
  } | null;
  targetType?: string;
  features?: {
    requirements?: string[];
  } | null;
}

export interface WizardOrderData {
  service?: WizardOrderService;
  minQty?: number;
  maxQty?: number;
  qty?: number;
  isDripFeed?: boolean;
  runs?: number;
  interval?: number;
  link?: string;
  tempLink?: string;
  isLinkOverridden?: boolean;
  requirementsConfirmed?: boolean;
  totalCents?: number;
  providerCostCents?: number;
  totalQuantity?: number;
}

export function getOrderData(ctx: BotContext): WizardOrderData {
  const state = ctx.wizard.state as Record<string, unknown>;
  if (!state.orderData || typeof state.orderData !== 'object') {
    state.orderData = {};
  }
  return state.orderData as WizardOrderData;
}

/**
 * Resolve Lite User from Telegram context.
 * Schema: User.telegramId is String? containing the Telegram user ID.
 */
const botTenantId = process.env.BOT_TENANT_ID || 'smmplan';

async function resolveUser(tgId: number) {
  return db.user.findFirst({
    where: { telegramId: String(tgId), tenantId: botTenantId }
  });
}

// ──────────────────────────────────────────────────────────────
// HELPER: Show final confirmation with pricing from Lite core
// ──────────────────────────────────────────────────────────────

async function showFinalConfirmation(ctx: BotContext) {
  const orderData = getOrderData(ctx);
  const { service, qty, isDripFeed, runs = 1, interval = 0, link } = orderData;
  if (!service || !qty || !link) return;
  if (!ctx.from) return;
  const tgId = ctx.from.id;
  const user = await resolveUser(tgId);
  if (!user) {
    await ctx.reply('❌ Пользователь не найден. Используйте /start для регистрации.');
    return ctx.scene.leave();
  }

  // --- REQUIREMENTS CHECK (Human-in-the-loop protection) ---
  const reqs = service.features?.requirements;
  if (reqs && Array.isArray(reqs) && reqs.length > 0 && !orderData.requirementsConfirmed) {
    const reqText = reqs.map((r: string) => {
      const linked = r.replace(/(https?:\/\/[^\s]+)/g, (url: string) => `<a href="${url}">Инструкция</a>`);
      return `• ${linked}`;
    }).join('\n');
    await ctx.reply(
      `⚠️ <b>ВАЖНЫЕ ТРЕБОВАНИЯ К УСЛУГЕ</b>\n────────────────────\n` +
      `Провайдер установил жесткие условия. Если их нарушить, заказ зависнет или будет отменен:\n\n` +
      `${reqText}\n\n` +
      `<i>Пожалуйста, подтвердите, что ваша ссылка соответствует требованиям.</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Я всё проверил, продолжить', 'confirm_reqs')],
          [Markup.button.callback('❌ Отмена', 'cancel_wizard')]
        ])
      }
    );
    return ctx.wizard.selectStep(7);
  }

  const totalQuantity = (isDripFeed && runs > 1) ? qty * runs : qty;

  if (isDripFeed && runs > 1) {
    const dripViolation = getDripFeedFloorViolation(totalQuantity, runs, service.minQty, 'runs');
    if (dripViolation) {
      await ctx.reply(`❌ <b>Ошибка Drip-Feed:</b> ${dripViolation}. Пожалуйста, повторите настройку.`, { parse_mode: 'HTML' });
      return ctx.scene.leave();
    }
  }

  const pricing = await marketingService.calculatePrice(user.id, service.id, totalQuantity);

  if (pricing.totalCents <= 0) {
    await ctx.reply('❌ <b>Ошибка:</b> Услуга недоступна для заказа (некорректная цена). Обратитесь в поддержку.', { parse_mode: 'HTML' });
    return ctx.scene.leave();
  }

  orderData.totalCents = pricing.totalCents;
  orderData.providerCostCents = pricing.providerCostCents;
  orderData.totalQuantity = totalQuantity;

  const { SettingsProvider } = await import('@/lib/settings');
  const { calculatePricePerUnit, formatPricePerUnit } = await import('../utils/formatter');
  const usdToRub = await SettingsProvider.getExchangeRateUSD();
  const pricePerUnit = calculatePricePerUnit({
    rate: service.rate || 0,
    markup: service.markup || 0,
    providerCurrency: service.providerCurrency || 'RUB'
  }, usdToRub);

  let summaryText = `🛒 <b>ПОДТВЕРЖДЕНИЕ ЗАКАЗА</b>\n────────────────────\n` +
    `📦 Услуга: <b>${escapeHtml(service.name)}</b>\n` +
    `💰 Цена: <b>${formatPricePerUnit(pricePerUnit)} ₽ / шт</b>\n` +
    `🔗 Ссылка: <code>${escapeHtml(link)}</code>\n` +
    `🔢 Количество: <b>${totalQuantity.toLocaleString()} шт.</b>\n`;

  if (isDripFeed && runs > 1) {
    const perRun = Math.floor(totalQuantity / runs);
    const totalTime = runs * interval;
    summaryText += `💧 <b>Drip-Feed:</b> Включен\n` +
      `   ├ Запусков: <b>${runs}</b> (по ~${perRun} шт.)\n` +
      `   └ Интервал: <b>${interval} мин.</b> (Всего: ~${(totalTime / 60).toFixed(1)} ч.)\n`;
  }

  if (pricing.discountCents > 0) {
    summaryText += `🎁 Скидка: <b>${formatCents(pricing.discountCents)}₽</b>\n`;
  }
  summaryText += `────────────────────\n`;
  summaryText += `💰 К оплате: <b>${formatCents(pricing.totalCents)}₽</b>`;

  const hasFunds = Number(user.balance) >= pricing.totalCents;
  const confirmLabel = hasFunds
    ? '🚀 Оплатить и запустить'
    : `💳 ДОПЛАТИТЬ И ЗАПУСТИТЬ (${formatCents(pricing.totalCents - Number(user.balance))}₽)`;

  await ctx.reply(summaryText, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback(confirmLabel, 'confirm_order')],
      [Markup.button.callback('❌ Отмена', 'cancel_wizard')]
    ])
  });

  return ctx.wizard.selectStep(7);
}

// ──────────────────────────────────────────────────────────────
// WIZARD DEFINITION
// ──────────────────────────────────────────────────────────────
export const orderWizard = new Scenes.WizardScene<BotContext>(
  ORDER_WIZARD,

  // ШАГ 1 (Index 0): Начало — показать выбранную услугу или запросить ссылку
  async (ctx: BotContext) => {
    const state = ctx.scene.state as Record<string, unknown>;
    const preSelected = state?.preSelectedService as WizardOrderService | undefined;
    const preFilledLink = state?.preFilledLink as string | undefined;

    if (preSelected) {
      const orderData = getOrderData(ctx);
      orderData.service = preSelected;
      orderData.minQty = preSelected.minQty;
      orderData.maxQty = preSelected.maxQty;

      if (preFilledLink && preFilledLink.trim().length > 0) {
        orderData.link = preFilledLink.trim();
        orderData.isLinkOverridden = false;
        await ctx.reply(
          `✨ <b>ВЫБРАНО:</b> ${escapeHtml(preSelected.name)}\n` +
          `🔗 <b>Ссылка:</b> <code>${escapeHtml(orderData.link)}</code>\n\n` +
          `🔢 <b>Введите количество</b> (от ${preSelected.minQty.toLocaleString()} до ${preSelected.maxQty.toLocaleString()}):\n\n` +
          `<i>Отправьте число в ответном сообщении:</i>`,
          {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_wizard')]])
          }
        );
        return ctx.wizard.selectStep(3);
      }

      await ctx.reply(`✨ <b>ВЫБРАНО:</b> ${escapeHtml(preSelected.name)}\n\n🚀 <b>Пришлите ссылку:</b>`, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_wizard')]])
      });
      return ctx.wizard.next();
    }

    await ctx.reply('🔗 <b>Выберите услугу из каталога</b>\nИспользуйте команду /shop для выбора услуги.', {
      parse_mode: 'HTML',
    });
    return ctx.scene.leave();
  },

  // ШАГ 2 (Index 1): Получение ссылки и автоматическая валидация
  async (ctx: BotContext) => {
    const msgText = (ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string') ? ctx.message.text.trim() : '';
    if (await handleWizardMenuNavigation(ctx, msgText)) {
      return;
    }
    if (!msgText) return ctx.reply('Пожалуйста, отправьте текстовую ссылку.');
    const link = msgText;

    const orderData = getOrderData(ctx);
    const service = orderData.service;
    if (!service) return ctx.scene.leave();

    const { unifiedLinkEngine } = await import('@/services/link-engine/unified-link-engine');
    let normalizedLink = link;
    let isValid = true;
    let validationErrorMsg = '';

    try {
      const valResult = await unifiedLinkEngine.validateForService(link, service);
      isValid = valResult.isValid;
      if (!valResult.isValid) {
        validationErrorMsg = valResult.error || 'неверный формат';
        normalizedLink = valResult.canonicalUrl || link;
      } else {
        normalizedLink = valResult.canonicalUrl;
      }
    } catch (err: unknown) {
      isValid = false;
      validationErrorMsg = err instanceof Error ? err.message : 'неверный формат';
    }

    if (!isValid) {
      orderData.tempLink = normalizedLink;
      await ctx.reply(
        `⚠️ <b>Ссылка не прошла проверку:</b>\n${escapeHtml(validationErrorMsg)}\n\n` +
        `Вы хотите продолжить в обход автоматической проверки или отправить другую ссылку?`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⚡ Продолжить всё равно', 'force_link')],
            [Markup.button.callback('🔄 Ввести другую ссылку', 'retry_link')],
            [Markup.button.callback('❌ Отмена', 'cancel_wizard')]
          ])
        }
      );
      return ctx.wizard.selectStep(2);
    }

    orderData.link = normalizedLink;
    orderData.isLinkOverridden = false;
    await ctx.reply(
      `🔢 <b>Введите количество</b> (от ${service.minQty.toLocaleString()} до ${service.maxQty.toLocaleString()}):\n\n` +
      `<i>Отправьте число в ответном сообщении:</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_wizard')]])
      }
    );
    return ctx.wizard.selectStep(3);
  },

  // ШАГ 3 (Index 2): Обработка развилки невалидной ссылки
  async (ctx: BotContext) => {
    const msgText = (ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string') ? ctx.message.text.trim() : '';
    if (msgText) {
      return ctx.wizard.selectStep(1);
    }
    return;
  },

  // ШАГ 4 (Index 3): Ввод количества и развилка Drip-feed
  async (ctx: BotContext) => {
    const msgText = (ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string') ? ctx.message.text.trim() : '';
    if (await handleWizardMenuNavigation(ctx, msgText)) {
      return;
    }
    if (!msgText) return ctx.reply('Пожалуйста, отправьте количество числом.');

    const qty = parseInt(msgText.replace(/\D/g, ''), 10);
    const orderData = getOrderData(ctx);
    const service = orderData.service;
    if (!service) return ctx.scene.leave();

    if (isNaN(qty) || qty < service.minQty || qty > service.maxQty) {
      return ctx.reply(
        `⚠️ <b>Некорректное количество</b>\n\n` +
        `Допустимый диапазон для этой услуги: от <b>${service.minQty.toLocaleString()}</b> до <b>${service.maxQty.toLocaleString()}</b>.\n\n` +
        `Пожалуйста, отправьте число:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('❌ Отмена', 'cancel_wizard'), Markup.button.callback('🆘 Поддержка', 'support')]
          ])
        }
      );
    }

    orderData.qty = qty;

    if (service.isDripFeedEnabled) {
      await ctx.reply(
        '💧 <b>Настройка Drip-Feed (постепенная накрутка)</b>\n\n' +
        'Хотите распределить заказ на несколько запусков с интервалами?',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('⚡ Обычный (за один раз)', 'drip_off')],
            [Markup.button.callback('💧 Включить Drip-Feed', 'drip_on')],
            [Markup.button.callback('❌ Отмена', 'cancel_wizard')]
          ])
        }
      );
      return ctx.wizard.selectStep(4);
    }

    orderData.isDripFeed = false;
    orderData.runs = 1;
    orderData.interval = 0;
    return showFinalConfirmation(ctx);
  },

  // ШАГ 5 (Index 4): Обработка выбора Drip-Feed (Inline Query Action)
  async (ctx: BotContext) => {
    const data = (ctx.callbackQuery && 'data' in ctx.callbackQuery && typeof ctx.callbackQuery.data === 'string') ? ctx.callbackQuery.data : '';
    const orderData = getOrderData(ctx);

    if (data === 'drip_off') {
      orderData.isDripFeed = false;
      orderData.runs = 1;
      orderData.interval = 0;
      await ctx.answerCbQuery();
      return showFinalConfirmation(ctx);
    }

    if (data === 'drip_on') {
      orderData.isDripFeed = true;
      await ctx.answerCbQuery();
      await ctx.reply(
        '🔢 <b>Количество запусков (Runs)</b>\n\n' +
        'На сколько частей разделить накрутку? (от 2 до 100 запусков):',
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_wizard')]])
        }
      );
      return ctx.wizard.selectStep(5);
    }

    return;
  },

  // ШАГ 6 (Index 5): Ввод числа запусков (Runs)
  async (ctx: BotContext) => {
    const msgText = (ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string') ? ctx.message.text.trim() : '';
    if (!msgText) return ctx.reply('Пожалуйста, введите число запусков (от 2 до 100):');

    const runs = parseInt(msgText.replace(/\D/g, ''), 10);
    if (isNaN(runs) || runs < 2 || runs > 100) {
      return ctx.reply('❌ Число запусков должно быть от 2 до 100. Введите число:');
    }

    const orderData = getOrderData(ctx);
    const service = orderData.service;
    if (!service) return ctx.scene.leave();

    const totalQuantity = (orderData.isDripFeed && runs > 1) ? (orderData.qty || 0) * runs : (orderData.qty || 0);

    const dripViolation = getDripFeedFloorViolation(totalQuantity, runs, service.minQty, 'runs');
    if (dripViolation) {
      return ctx.reply(
        `⚠️ <b>Некорректная настройка Drip-Feed:</b>\n\n` +
        `${dripViolation}.\n\n` +
        `Минимальное количество за 1 запуск для этой услуги: <b>${service.minQty.toLocaleString()}</b> шт.\n` +
        `Пожалуйста, введите другое число запусков:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_wizard')]])
        }
      );
    }

    if (totalQuantity > service.maxQty) {
      return ctx.reply(
        `⚠️ <b>Превышен максимум услуги:</b>\n\n` +
        `Суммарное количество (${totalQuantity.toLocaleString()} шт.) превышает максимальный лимит услуги (<b>${service.maxQty.toLocaleString()}</b> шт.).\n\n` +
        `Пожалуйста, уменьшите количество запусков:`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_wizard')]])
        }
      );
    }

    orderData.runs = runs;

    await ctx.reply(
      '⏱ <b>Интервал между запусками (минуты)</b>\n\n' +
      'С какой паузой запускать каждую пачку? (от 5 до 1440 минут):',
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_wizard')]])
      }
    );
    return ctx.wizard.selectStep(6);
  },

  // ШАГ 7 (Index 6): Ввод интервала (Interval) и переход к подтверждению
  async (ctx: BotContext) => {
    const msgText = (ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string') ? ctx.message.text.trim() : '';
    if (!msgText) return ctx.reply('Пожалуйста, введите интервал в минутах (от 5 до 1440):');

    const interval = parseInt(msgText.replace(/\D/g, ''), 10);
    if (isNaN(interval) || interval < 5 || interval > 1440) {
      return ctx.reply('❌ Интервал должен быть от 5 до 1440 минут. Введите число:');
    }

    const orderData = getOrderData(ctx);
    orderData.interval = interval;

    return showFinalConfirmation(ctx);
  },

  // ШАГ 8 (Index 7): Ожидание подтверждения (Confirm) или перехода к оплате
  async (ctx: BotContext) => {
    return;
  }
);

// ──────────────────────────────────────────────────────────────
// INLINE ACTION HANDLERS
// ──────────────────────────────────────────────────────────────

orderWizard.action('force_link', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  const orderData = getOrderData(ctx);
  const service = orderData.service;
  if (!service) return ctx.scene.leave();

  orderData.link = orderData.tempLink;
  orderData.isLinkOverridden = true;

  await ctx.editMessageText(
    `🔢 <b>Введите количество</b> (от ${service.minQty.toLocaleString()} до ${service.maxQty.toLocaleString()}):\n\n` +
    `<i>Отправьте число в ответном сообщении:</i>`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_wizard')]])
    }
  ).catch(() => {});
  return ctx.wizard.selectStep(3);
});

orderWizard.action('retry_link', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText('🚀 <b>Пришлите новую ссылку:</b>', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'cancel_wizard')]])
  }).catch(() => {});
  return ctx.wizard.selectStep(1);
});

orderWizard.action('confirm_reqs', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  const orderData = getOrderData(ctx);
  orderData.requirementsConfirmed = true;
  // Let showFinalConfirmation use editMessageText by passing ctx (it might need a flag if we want it to edit, but for now we'll leave showFinalConfirmation as is or modify it separately)
  return showFinalConfirmation(ctx);
});

orderWizard.action('confirm_order', async (ctx: BotContext) => {
  await ctx.answerCbQuery('Обработка заказа...');
  const orderData = getOrderData(ctx);
  const { service, totalQuantity, totalCents = 0, providerCostCents = 0, link, isDripFeed, runs = 1, interval = 0, isLinkOverridden } = orderData;
  if (!service || !totalQuantity || !link) return ctx.scene.leave();
  if (!ctx.from) return ctx.scene.leave();

  const tgId = ctx.from.id;
  const user = await resolveUser(tgId);
  if (!user) return ctx.scene.leave();

  if (Number(user.balance) >= totalCents) {
    // [VULN-TG-03 Mitigation] Immediate visual debounce to prevent double-click race condition
    await ctx.editMessageText('⏳ <b>Оформление заказа...</b>\n\nПожалуйста, подождите, операция регистрируется в системе.', {
      parse_mode: 'HTML'
    }).catch(() => {});

    try {
      // [VULN-TG-02 Mitigation] Deterministic idempotencyKey prevents double-charge in WalletOps
      if (!orderData.idempotencyKey) {
        orderData.idempotencyKey = `bot-order-${user.id}-${service.id}-${Date.now()}`;
      }
      const res = await orderService.createOrder(user.id, {
        serviceId: service.id,
        link,
        quantity: totalQuantity,
        charge: totalCents,
        providerCost: providerCostCents,
        runs,
        interval,
        isLinkOverridden: Boolean(isLinkOverridden)
      }, orderData.idempotencyKey);
      if (!res.success) {
        throw new Error(res.error || 'Ошибка оформления заказа');
      }

      await ctx.editMessageText(
        `🎉 <b>Заказ успешно оформлен!</b>\n\n` +
        `🆔 Номер заказа: <b>#${res.orderId || '—'}</b>\n` +
        `📦 Услуга: <b>${escapeHtml(service.name)}</b>\n` +
        `📊 Статус: <b>В очереди на выполнение</b>\n\n` +
        `Следить за статусом можно в разделе /orders`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📋 Мои заказы', 'my_orders')],
            [Markup.button.callback('🛒 Заказать ещё', 'shop'), Markup.button.callback('🏠 В главное меню', 'nav_start')]
          ])
        }
      ).catch(() => {});
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.editMessageText(
        `❌ <b>Ошибка оформления заказа</b>\n────────────────────\n${errMsg}\n\n` +
        `<i>Если у вас возникли вопросы или списались средства, напишите нам:</i>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('🆘 Написать в поддержку', 'support')],
            [Markup.button.callback('🛒 Выбрать другую услугу', 'shop'), Markup.button.callback('🏠 В главное меню', 'nav_start')]
          ])
        }
      ).catch(() => {});

      try {
        const { sendAdminAlert } = await import('@/lib/notifications');
        sendAdminAlert(
          `📦 <b>[BOT ALERT: Ошибка оформления заказа]</b>\n\n` +
          `👤 <b>Пользователь:</b> TG ID <code>${tgId}</code> (@${ctx.from.username || '—'})\n` +
          `🛍 <b>Услуга:</b> #${service.numericId} (${escapeHtml(service.name)})\n` +
          `🔢 <b>Количество:</b> ${totalQuantity}\n` +
          `💰 <b>Сумма:</b> ${formatCents(totalCents)} ₽\n` +
          `⚠️ <b>Ошибка:</b> <code>${errMsg}</code>`,
          'CRITICAL',
          botTenantId
        );
      } catch { /* alert must not throw */ }
    }
    return ctx.scene.leave();
  }

  const deficitCents = totalCents - Number(user.balance);
  const deficitRub = Math.ceil(deficitCents / 100);

  try {
    const payment = await UnifiedPaymentService.createPayment(
      undefined,
      user.id,
      deficitRub,
      `Доплата за заказ ${service.name}`,
      {
        type: 'AUTO_ORDER_TOPUP',
        serviceId: service.id,
        link,
        quantity: totalQuantity,
        totalCents,
        providerCostCents,
        isDripFeed: Boolean(isDripFeed),
        runs,
        interval,
        isLinkOverridden: Boolean(isLinkOverridden)
      },
      'yookassa'
    );
    if (!payment.success || !payment.confirmationUrl) {
      throw new Error(payment.error || 'Не удалось сформировать ссылку на оплату');
    }

    await ctx.editMessageText(
      `💳 <b>Недостаточно средств на балансе</b>\n────────────────────\n` +
      `Сумма заказа: <b>${formatCents(totalCents)}₽</b>\n` +
      `Ваш баланс: <b>${formatCents(Number(user.balance))}₽</b>\n` +
      `К доплате: <b>${deficitRub} ₽</b>\n\n` +
      `<i>После оплаты заказ запустится автоматически.</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.url('💳 Оплатить картой / СБП', payment.confirmationUrl)],
          [Markup.button.callback('❌ Отмена', 'cancel_wizard')]
        ])
      }
    ).catch(() => {});
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await ctx.editMessageText(
      `❌ <b>Ошибка создания платежа</b>\n────────────────────\n${errMsg}\n\n` +
      `<i>Служба заботы на связи и поможет решить вопрос прямо сейчас:</i>`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('🆘 Написать в поддержку', 'support')],
          [Markup.button.callback('🏠 В главное меню', 'nav_start')]
        ])
      }
    ).catch(() => {});

    try {
      const { sendAdminAlert } = await import('@/lib/notifications');
      sendAdminAlert(
        `💳 <b>[BOT ALERT: Ошибка формирования доплаты за заказ]</b>\n\n` +
        `👤 <b>Пользователь:</b> TG ID <code>${tgId}</code> (@${ctx.from.username || '—'})\n` +
        `🛍 <b>Услуга:</b> #${service.numericId} (${escapeHtml(service.name)})\n` +
        `💰 <b>К доплате:</b> ${deficitRub} ₽\n` +
        `⚠️ <b>Ошибка:</b> <code>${errMsg}</code>`,
        'WARNING',
        botTenantId
      );
    } catch { /* alert must not throw */ }
  }
  return ctx.scene.leave();
});

orderWizard.action('cancel_wizard', async (ctx: BotContext) => {
  await ctx.answerCbQuery('Заказ отменен').catch(() => {});
  await ctx.editMessageText('❌ <b>Оформление заказа отменено.</b>', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🛍 Выбрать другую услугу', 'shop'), Markup.button.callback('🏠 В главное меню', 'nav_start')]
    ])
  }).catch(() => {});
  return ctx.scene.leave();
});

orderWizard.command('cancel', async (ctx: BotContext) => {
  await ctx.reply('❌ <b>Оформление заказа отменено.</b>', {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('🛍 Каталог услуг', 'shop'), Markup.button.callback('🏠 В главное меню', 'nav_start')]
    ])
  });
  return ctx.scene.leave();
});

orderWizard.hears(/(.+)/, async (ctx: BotContext, next) => {
  const text = (ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string') ? ctx.message.text : '';
  if (await handleWizardMenuNavigation(ctx, text)) {
    return;
  }
  return next();
});
