import type { BotContext } from '../types/bot-context';
/**
 * (c) 2024-2026 SMMplan. All rights reserved.
 * Created by Artem (http://artmspektr.ru)
 * Unauthorized copying of this file is strictly prohibited.
 *
 * MIGRATED TO SMMPLAN LITE CORE (April 2026)
 */
import { Scenes, Markup } from 'telegraf';
import { getBaseUrlSync } from '@/utils/get-base-url';
import { db } from '@/lib/db';
import { getTenantHost } from '@/config/tenants';

export const REFERRAL_WIZARD = 'referral-wizard';

const botTenantId = process.env.BOT_TENANT_ID || 'smmplan';

async function resolveUser(tgId: number) {
  let user = await db.user.findFirst({
    where: { telegramId: String(tgId), tenantId: botTenantId },
    select: { id: true, referralCode: true, referralBalance: true, _count: { select: { referrals: true } } }
  });

  if (!user) {
    const emailStub = `tg_${tgId}@${botTenantId}.bot`;
    const created = await db.user.upsert({
      where: { email_tenantId: { email: emailStub, tenantId: botTenantId } },
      update: { telegramId: String(tgId) },
      create: {
        email: emailStub,
        telegramId: String(tgId),
        tenantId: botTenantId,
        isBotOnly: true,
      },
      select: { id: true, referralCode: true, referralBalance: true }
    });

    user = {
      ...created,
      _count: { referrals: 0 }
    };
  }

  return user;
}

// ──────────────────────────────────────────────────────────────
// WIZARD DEFINITION
// ──────────────────────────────────────────────────────────────
export const referralWizard = new Scenes.WizardScene<BotContext>(
  REFERRAL_WIZARD,

  // ШАГ 1: Показать статистику и ссылку
  async (ctx: BotContext) => {
    try {
      if (!ctx.from) return ctx.scene.leave();
      const tgId = ctx.from.id;
      const user = await resolveUser(tgId);

      if (!user) {
        await ctx.reply('❌ Пользователь не найден. Используйте /start для регистрации.');
        return ctx.scene.leave();
      }

      if (!user.referralCode) {
        let newCode = '';
        for (let attempt = 0; attempt < 5; attempt++) {
          newCode = Array.from(Array(8), () => Math.floor(Math.random() * 36).toString(36)).join('').toUpperCase();
          const existing = await db.user.findUnique({ where: { referralCode: newCode } });
          if (!existing) break;
        }
        await db.user.update({
          where: { id: user.id },
          data: { referralCode: newCode }
        });
        user.referralCode = newCode;
      }

      const tenantHost = getTenantHost(botTenantId);
      const host = process.env.APP_URL || (tenantHost.startsWith('http') ? tenantHost : `https://${tenantHost}`);
      const link = `${host}/?ref=${user.referralCode}`;
      const earned = Number(user.referralBalance ?? BigInt(0)) / 100;
      const refsCount = user._count?.referrals ?? 0;

      await ctx.reply(
        `👥 <b>Реферальная программа</b>\n\n` +
        `Приглашайте друзей и получайте <b>15%</b> с каждого их заказа пожизненно!\n\n` +
        `🔗 <b>Ваша ссылка:</b>\n<code>${link}</code>\n\n` +
        `📊 <b>Ваша статистика:</b>\n` +
        `• Приглашено: <b>${refsCount} чел.</b>\n` +
        `• Заработано: <b>${earned.toFixed(2)} ₽</b>\n\n` +
        `<i>Для вывода средств на основной баланс используйте веб-интерфейс.</i>`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.url('Перейти в личный кабинет', `${host}/dashboard/referrals`)],
            [Markup.button.callback('❌ Закрыть', 'close_ref')]
          ])
        }
      );
      return ctx.wizard.next();
    } catch (err) {
      console.error('[ReferralWizard] Error:', err);
      await ctx.reply('❌ Произошла ошибка при загрузке реферальной информации. Попробуйте позже.');
      return ctx.scene.leave();
    }
  },

  async (ctx: BotContext) => {
    return;
  }
);

referralWizard.action('close_ref', async (ctx: BotContext) => {
  await ctx.answerCbQuery();
  await ctx.deleteMessage().catch(() => {});
  return ctx.scene.leave();
});

referralWizard.command('cancel', async (ctx: BotContext) => {
  return ctx.scene.leave();
});

referralWizard.hears(/(.+)/, async (ctx: BotContext, next) => {
  const text = (ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string') ? ctx.message.text : '';
  const { handleWizardMenuNavigation } = await import('../utils/menu-navigation');
  if (await handleWizardMenuNavigation(ctx, text)) {
    return;
  }
  return next();
});
