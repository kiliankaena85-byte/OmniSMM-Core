'use server';
import type { Prisma } from '@prisma/client';

import { verifySession } from '@/lib/session';
import { extractOrderIds } from '@/utils/ticket-parser';
import { ticketService } from '@/services/support/ticket.service';
import { db } from '@/lib/db';
import { aiSupportService } from '@/services/admin/ai-support.service';
import { requireStaffPermission } from '@/lib/server/rbac';
import { revalidatePath, revalidateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getClientIp } from '@/utils/ip';
import { auditAdmin, auditAdminAwaitable } from '@/lib/admin-audit';
import { WalletOps } from '@/services/financial/wallet-ops';
import { CompensationService } from '@/services/financial/compensation.service';

/**
 * MANDATORY INTEGRITY WARNING:
 * DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A Forensic Auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.
 */

// ... (rest of imports)

export async function generateSmartReplyAction(ticketId: string, options?: { forceRefresh?: boolean }) {
  return requireStaffPermission('tickets', 'view', async (admin) => {
    try {
      if (process.env.DISABLE_AI_SUPPORT === 'true') {
        return { success: false, error: 'AI-ассистент временно отключен администратором в настройках системы.' };
      }

      const aiData = await aiSupportService.generateReply(
        ticketId,
        admin.tenantId ?? 'smmplan',
        { forceRefresh: options?.forceRefresh }
      );

      // If Policy Engine blocked the response, inform the operator
      if (aiData.blocked) {
        const violationsSummary = aiData.policy_violations
          .map((v) => `[${v.severity}] ${v.rule}: ${v.detail}`)
          .join('\n');
        return {
          success: true,
          reply: `⛔ AI-ответ заблокирован системой безопасности.\n\nНарушения:\n${violationsSummary}\n\nНапишите ответ вручную.`,
          fromCache: aiData.fromCache,
        };
      }

      // Append escalation warning if needed
      const draft = aiData.escalate_to_senior
        ? `[⚠️ ИНСАЙТ AI (${aiData.client_sentiment}): ${aiData.internal_reasoning}]\n\n${aiData.draft_reply}`
        : aiData.draft_reply;

      return { success: true, reply: draft, fromCache: aiData.fromCache };
    } catch (err: unknown) {
      return { success: false, error: (err instanceof Error ? err.message : String(err)) };
    }
  });
}

export async function prefetchSmartReplyAction(ticketId: string) {
  return generateSmartReplyAction(ticketId, { forceRefresh: false });
}

import { RateLimitService } from '@/services/core/rate-limit.service';
import { publishMessageSSE } from '@/services/support/sse.service';




const createTicketSchema = z.object({
  subject: z.string().min(1),
  message: z.string().min(1)
});

const ticketMessageSchema = z.object({
  ticketId: z.string().min(1),
  message: z.string().optional(),
  mediaUrl: z.string().optional(),
  mediaType: z.string().optional(),
  replyToId: z.string().optional(),
  orderId: z.string().optional()
}).refine(data => data.message || data.mediaUrl, "Either message or mediaUrl must be provided");

const adminReplySchema = z.object({
  ticketId: z.string().min(1),
  message: z.string().optional(),
  isInternal: z.any().transform(val => val === 'true' || val === 'on'),
  mediaUrl: z.string().optional(),
  mediaType: z.string().optional(),
  replyToId: z.string().optional(),
  orderId: z.string().optional()
}).refine(data => data.message || data.mediaUrl, "Either message or mediaUrl must be provided");

export async function createTicket(formData: FormData): Promise<{ success: false; error: string } | void> {
  if (!formData || typeof formData.entries !== 'function') return { success: false, error: "Некорректные данные формы" };
  const session = await verifySession();
  if (!session) return { success: false, error: 'Необходима авторизация' };

  // Rate Limit: Prevent ticket spam (max 5 tickets per 1 hour)
  const isAllowedUser = await RateLimitService.checkCustomKey(`create_ticket_user:${session.userId}`, 5, 3600);
  const isAllowedIp = await RateLimitService.check('create_ticket_ip', 10, 3600);
  if (!isAllowedUser || !isAllowedIp) {
    return { success: false, error: 'Вы создаете слишком много обращений. Пожалуйста, подождите некоторое время.' };
  }

  const parsed = createTicketSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { success: false, error: 'Данные тикета заполнены неверно' };
  const { subject, message } = parsed.data;

  const ticket = await ticketService.getOrCreateTicket(session.userId, subject, 'WEB', session.tenantId);
  await ticketService.addMessage(ticket.id, 'USER', message);

  revalidatePath('/dashboard/tickets');
  redirect(`/dashboard/tickets/${ticket.id}`);
}

export async function addTicketMessage(formData: FormData): Promise<{ success: boolean; error?: string }> {
  if (!formData || typeof formData.entries !== 'function') return { success: false, error: "Некорректные данные формы" };
  const session = await verifySession();
  if (!session) return { success: false, error: 'Необходима авторизация' };

  // Rate Limit: Prevent message flooding (max 60 messages per 1 minute)
  const isAllowedUser = await RateLimitService.checkCustomKey(`add_message_user:${session.tenantId || 'smmplan'}:${session.userId}`, 60, 60);
  const isAllowedIp = await RateLimitService.check('add_message_ip', 100, 60);
  if (!isAllowedUser || !isAllowedIp) {
    return { success: false, error: 'Слишком много сообщений. Пожалуйста, подождите перед следующим ответом.' };
  }

  const parsed = ticketMessageSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { success: false, error: 'Сообщение не может быть пустым' };
  const { ticketId, message, mediaUrl, mediaType, replyToId, orderId } = parsed.data;

  const isStaff = session.role ? ['OWNER', 'ADMIN', 'SUPPORT'].includes(session.role) : false;
  const isGlobalStaff = session.role ? ['OWNER', 'ADMIN'].includes(session.role) : false;
  // [TENANT ISOLATION] Only OWNER/ADMIN are cross-tenant; SUPPORT is scoped to its own tenant.
  const ticket = isGlobalStaff
    ? await db.ticket.findUnique({ where: { id: ticketId } })
    : isStaff
    ? await db.ticket.findFirst({ where: { id: ticketId, tenantId: session.tenantId || 'smmplan' } })
    : await db.ticket.findFirst({
        where: { id: ticketId, userId: session.userId, tenantId: session.tenantId }
      });
  if (!ticket) return { success: false, error: 'Тикет не найден или доступ запрещён' };

  let verifiedOrderId: string | undefined = undefined;
  if (orderId) {
    // Security check: verify user owns the SMM order
    const order = await db.order.findFirst({
      where: { id: orderId, ...(isStaff ? {} : { userId: session.userId }), tenantId: session.tenantId }
    });
    if (order) {
      verifiedOrderId = order.id;
      // Also link at the ticket level for legacy compatibility and top-level headers
      await db.ticket.update({
        where: { id: ticketId },
        data: { orderId: order.id }
      });
    }
  } else if (message) {
    const extractedIds = extractOrderIds(message);
    if (extractedIds.length > 0) {
      const order = await db.order.findFirst({
        where: {
          ...(isStaff ? {} : { userId: session.userId }),
          tenantId: session.tenantId,
          OR: [
            { id: { in: extractedIds } },
            { numericId: { in: extractedIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id)) } }
          ]
        }
      });
      if (order) {
        verifiedOrderId = order.id;
        if (!ticket.orderId) {
          await db.ticket.update({
            where: { id: ticketId },
            data: { orderId: order.id }
          });
        }
      }
    }
  }

  // If the user is writing in their own ticket (even if they have Admin/Owner role), they are acting as the client (USER).
  const isOwner = ticket.userId === session.userId;
  const sender = isOwner ? 'USER' : (isStaff ? 'STAFF' : 'USER');
  const savedMsg = await ticketService.addMessage(ticketId, sender, message || '', mediaUrl, mediaType, replyToId, undefined, undefined, verifiedOrderId);
  if (savedMsg?.id) {
    await publishMessageSSE(ticketId, savedMsg.id);
  }
  revalidatePath(`/dashboard/tickets/${ticketId}`);
  revalidatePath(`/admin/tickets/${ticketId}`);
  return { success: true };
}

export async function adminReplyTicket(formData: FormData) {
  return requireStaffPermission('tickets', 'edit', async (admin) => {
    const parsed = adminReplySchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { success: false, error: 'Ошибка валидации сообщения' };
    const { ticketId, message, isInternal, mediaUrl, mediaType, replyToId, orderId } = parsed.data;

    const isGlobalStaff = ['OWNER', 'ADMIN'].includes(admin.role);
    const ticket = await db.ticket.findFirst({
      where: isGlobalStaff ? { id: ticketId } : { id: ticketId, tenantId: admin.tenantId ?? 'smmplan' },
      select: { id: true, userId: true, orderId: true, tenantId: true, user: { select: { email: true, isBotOnly: true, telegramId: true } } }
    });
    if (!ticket) return { success: false, error: 'Ticket not found' };

    let verifiedOrderId: string | undefined = undefined;
    if (orderId) {
      const order = await db.order.findFirst({
        where: { id: orderId, userId: ticket.userId, tenantId: ticket.tenantId }
      });
      if (order) {
        verifiedOrderId = order.id;
        if (!ticket.orderId) {
          await db.ticket.update({
            where: { id: ticketId },
            data: { orderId: order.id }
          });
        }
      }
    } else if (message) {
      const extractedIds = extractOrderIds(message);
      if (extractedIds.length > 0) {
        const order = await db.order.findFirst({
          where: {
            userId: ticket.userId,
            tenantId: ticket.tenantId,
            OR: [
              { id: { in: extractedIds } },
              { numericId: { in: extractedIds.map(id => parseInt(id, 10)).filter(id => !isNaN(id)) } }
            ]
          }
        });
        if (order) {
          verifiedOrderId = order.id;
          if (!ticket.orderId) {
            await db.ticket.update({
              where: { id: ticketId },
              data: { orderId: order.id }
            });
          }
        }
      }
    }

    const sender = isInternal ? 'INTERNAL' : 'STAFF';

    const savedMsg = await ticketService.addMessage(ticketId, sender, message || '', mediaUrl, mediaType, replyToId, undefined, undefined, verifiedOrderId);

    const ipAddress = await getClientIp('unknown');
    auditAdmin({
      adminId: admin.id,
      adminEmail: admin.email,
      action: isInternal ? 'TICKET_INTERNAL_NOTE_ADD' : 'TICKET_REPLY_SEND',
      target: ticketId,
      targetType: 'TICKET',
      newValue: { message, mediaUrl, mediaType, replyToId, orderId: verifiedOrderId },
      ipAddress
    });

    // Broadcast STAFF replies and INTERNAL notes to SSE stream (INTERNAL notes are safely filtered out route-side for non-staff)
    if (sender === 'STAFF' || sender === 'INTERNAL') {
      await publishMessageSSE(ticketId, savedMsg.id);
    }

    revalidatePath(`/admin/tickets/${ticketId}`);
    revalidatePath(`/admin/tickets`);

    if (savedMsg.telegramMsgId?.startsWith('FAILED:')) {
      const errorDetails = savedMsg.telegramMsgId.replace('FAILED:', '').trim();
      const isBotUser = ticket.user?.email?.includes('@smmplan.bot') || ticket.user?.email?.includes('@flux.bot') || ticket.user?.isBotOnly;
      if (isBotUser) {
        return {
          success: false,
          error: `Ошибка отправки в Telegram: ${errorDetails}`,
        };
      }
      return {
        success: true,
        warning: `Сообщение сохранено на сайте, но НЕ доставлено в Telegram: ${errorDetails}`,
      };
    }

    return { success: true };
  });
}

const changeStatusSchema = z.object({
  ticketId: z.string().min(1),
  status: z.enum(['OPEN', 'PENDING', 'CLOSED'])
});

export async function changeTicketStatus(formData: FormData) {
  return requireStaffPermission('tickets', 'edit', async (admin) => {
    const parsed = changeStatusSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { success: false, error: 'Неверный статус' };
    const { ticketId, status } = parsed.data;

    const isGlobalStaff = ['OWNER', 'ADMIN'].includes(admin.role);
    const oldTicket = await db.ticket.findFirst({
      where: isGlobalStaff ? { id: ticketId } : { id: ticketId, tenantId: admin.tenantId ?? 'smmplan' },
      select: { status: true, tenantId: true, user: { select: { telegramId: true } } }
    });

    await db.ticket.update({
      where: { id: ticketId },
      data: { 
        status,
        ...(status === 'CLOSED' ? { resolvedAt: new Date() } : {})
      }
    });

    const ipAddress = await getClientIp('unknown');
    auditAdmin({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'TICKET_STATUS_CHANGE',
      target: ticketId,
      targetType: 'TICKET',
      oldValue: oldTicket?.status,
      newValue: status,
      ipAddress
    });

    // CSAT: When ticket is closed, send interactive rating buttons to user in Telegram in background (non-blocking)
    if (status === 'CLOSED' && oldTicket?.user?.telegramId) {
      const tgUserId = oldTicket.user.telegramId;
      const tenantId = oldTicket.tenantId || 'smmplan';
      import('@/services/support/support-bot.service')
        .then(({ supportBotService }) => supportBotService.sendTicketClosedRating(tgUserId, ticketId, tenantId))
        .catch((e) => console.error('[changeTicketStatus] Error sending Telegram CSAT rating:', e));
    }

    try {
      revalidateTag('tickets', 'default');
      revalidateTag('open-count', 'default');
      revalidatePath(`/admin/tickets/${ticketId}`);
      revalidatePath(`/admin/tickets`);
      revalidatePath(`/admin`, 'layout');
    } catch { /* ignore non-request contexts */ }
    return { success: true as const };
  });
}

const editMessageSchema = z.object({
  messageId: z.string().min(1),
  newText: z.string().min(1)
});

export async function editTicketMessage(formData: FormData) {
  return requireStaffPermission('tickets', 'edit', async (user) => {
    const parsed = editMessageSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { success: false, error: 'Ошибка редактирования сообщения' };
    const { messageId, newText } = parsed.data;

    // Retrieve the old message
    const msg = await db.ticketMessage.findUnique({ 
      where: { id: messageId },
      include: { ticket: { include: { user: true } } }
    });
    if (!msg) return { success: false, error: 'Message not found' };
    if (msg.sender === 'USER') {
      return { success: false, error: 'You cannot edit user messages' };
    }

    const ipAddress = await getClientIp('unknown');
    // Transaction for updating text and auditing
    await db.$transaction(async (tx) => {
      await tx.ticketMessage.update({
        where: { id: messageId },
        data: { 
          text: newText.trim(),
          isEdited: true,
          originalText: msg.isEdited ? undefined : msg.text
        }
      });

      await tx.adminAuditLog.create({
        data: {
          adminId: user.id,
          adminEmail: user.email,
          action: 'TICKET_MESSAGE_EDITED',
          target: msg.id,
          targetType: 'TICKET_MESSAGE',
          oldValue: msg.text,
          newValue: newText.trim(),
          ipAddress
        }
      });
    });

    // Sync to Telegram if applicable
    if (msg.telegramMsgId && msg.ticket.user.telegramId && msg.sender === 'STAFF') {
      try {
        const { supportBotService } = await import('@/services/support/support-bot.service');
        await supportBotService.editSupportReply(msg.ticket.user.telegramId, msg.telegramMsgId, newText.trim(), msg.ticket.tenantId || 'smmplan');
      } catch (e) {
        console.error('[editTicketMessage] Error syncing edit to Telegram:', e);
        // We don't throw here to avoid failing the web UI if Telegram is temporarily down
      }
    }

    revalidatePath(`/admin/tickets/${msg.ticketId}`);
  });
}

const deleteMessageSchema = z.object({
  messageId: z.string().min(1)
});

export async function deleteTicketMessage(formData: FormData) {
  return requireStaffPermission('tickets', 'edit', async (admin) => {
    const parsed = deleteMessageSchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) return { success: false, error: 'Ошибка удаления сообщения' };
    const { messageId } = parsed.data;

    const msg = await db.ticketMessage.findUnique({
      where: { id: messageId },
      include: { ticket: { include: { user: true } } },
    });

    if (!msg) {
      return { success: false, error: 'Сообщение не найдено' };
    }

    if (msg.sender === 'USER') {
      return { success: false, error: 'Нельзя удалять сообщения пользователя' };
    }

    const ipAddress = await getClientIp('unknown');

    await db.$transaction(async (tx) => {
      await tx.ticketMessage.update({
        where: { id: messageId },
        data: { 
          isDeleted: true,
          text: '[Сообщение удалено оператором]'
        }
      });

      await tx.adminAuditLog.create({
        data: {
          adminId: admin.id,
          adminEmail: admin.email,
          action: 'DELETE_TICKET_MESSAGE',
          target: messageId,
          targetType: 'TICKET',
          oldValue: msg.text,
          newValue: '[DELETED]',
          ipAddress
        }
      });
    });

    // Sync deletion to Telegram if applicable
    if (msg.telegramMsgId && msg.ticket.user.telegramId && msg.sender === 'STAFF') {
      try {
        const { supportBotService } = await import('@/services/support/support-bot.service');
        await supportBotService.deleteSupportReply(msg.ticket.user.telegramId, msg.telegramMsgId, msg.ticket.tenantId || 'smmplan');
      } catch (e) {
        console.error('[deleteTicketMessage] Error deleting from Telegram:', e);
      }
    }

    revalidatePath(`/admin/tickets/${msg.ticketId}`);
    return { success: true };
  });
}

const requestBindSchema = z.object({
  ticketId: z.string().min(1)
});

export async function requestTelegramBind(formData: FormData) {
  return requireStaffPermission('tickets', 'edit', async (admin) => {
    try {
      console.info('[requestTelegramBind] Action started');
      const parsed = requestBindSchema.safeParse(Object.fromEntries(formData.entries()));
      if (!parsed.success) {
        console.error('[requestTelegramBind] Validation failed:', parsed.error);
        return { success: false, error: 'Invalid ticketId' };
      }
      const { ticketId } = parsed.data;
      console.info('[requestTelegramBind] Processing ticketId:', ticketId);

      const isGlobalStaff = ['OWNER', 'ADMIN'].includes(admin.role);
      const ticket = await db.ticket.findFirst({
        where: isGlobalStaff ? { id: ticketId } : { id: ticketId, tenantId: admin.tenantId ?? 'smmplan' },
        include: { user: true }
      });
      if (!ticket) return { success: false, error: 'Ticket not found' };

      if (!ticket.user.email.startsWith('tg_')) {
        return { success: false, error: 'У пользователя уже есть веб-аккаунт' };
      }

      const host = process.env.NEXT_PUBLIC_APP_URL || 'https://smmplan.pro';
      const magicLink = `${host}/api/support/telegram?forceAuth=true`;

      const messageText = `🎧 <b>Служба поддержки SMMplan</b>\n\nЧтобы мы могли найти ваши заказы и оформить возврат средств на баланс, пожалуйста, подтвердите владение заказом по ссылке: ${magicLink}`;

      const savedMsg = await ticketService.addMessage(ticketId, 'STAFF', messageText);

      await publishMessageSSE(ticketId, savedMsg.id);

      revalidatePath(`/admin/tickets/${ticketId}`);
      return { success: true };
    } catch (err) {
      console.error('[requestTelegramBind] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });
}

const manualBindSchema = z.object({
  ticketId: z.string().min(1),
  targetEmail: z.string().email('Некорректный email'),
  confirm: z.string().optional()
});

export async function adminManualTelegramBind(formData: FormData) {
  return requireStaffPermission('tickets', 'edit', async (admin) => {
    try {
      // W6-5: SUPPORT cannot call manual bind
      if (!['ADMIN', 'OWNER'].includes(admin.role)) return { success: false, error: 'Forbidden: Only ADMIN or OWNER can manually bind Telegram accounts' };

      const parsed = manualBindSchema.safeParse(Object.fromEntries(formData.entries()));
      if (!parsed.success) return { success: false, error: 'Invalid input' };
      const { ticketId, targetEmail, confirm } = parsed.data;

      const ticket = await db.ticket.findFirst({
        where: { id: ticketId, tenantId: admin.tenantId ?? 'smmplan' },
        include: { user: true }
      });
      if (!ticket) return { success: false, error: 'Ticket not found' };

      const tempUser = ticket.user;
      if (!tempUser.email.startsWith('tg_') || !tempUser.telegramId) {
        return { success: false, error: 'Этот профиль не является временным Telegram-аккаунтом' };
      }

      const webUser = await db.user.findUnique({ 
        where: { email_tenantId: { email: targetEmail, tenantId: tempUser.tenantId } },
        include: { _count: { select: { orders: true } } }
      });
      if (!webUser) {
        return { success: false, error: 'Целевой аккаунт с таким email не найден' };
      }

      // W6-4: Add confirmationToken flow
      if (confirm !== 'true') {
        const tempUserOrders = await db.order.count({ where: { userId: tempUser.id, tenantId: tempUser.tenantId } });
        return { 
          preview: true, 
          data: {
            tempUserEmail: tempUser.email,
            tempUserOrders: tempUserOrders,
            targetEmail: webUser.email,
            targetBalance: (Number(webUser.balance) / 100).toFixed(2),
            targetOrders: (webUser as { _count?: { orders?: number } })._count?.orders || 0
          }
        };
      }

      const ipAddress = await getClientIp('unknown');
      await db.$transaction(async (tx) => {
        // 1. Move all relational data from tempUser to webUser (excluding LedgerEntries because of block trigger)
        await tx.ticket.updateMany({ where: { userId: tempUser.id, tenantId: tempUser.tenantId }, data: { userId: webUser.id } });
        await tx.order.updateMany({ where: { userId: tempUser.id, tenantId: tempUser.tenantId }, data: { userId: webUser.id } });
        await tx.payment.updateMany({ where: { userId: tempUser.id, tenantId: tempUser.tenantId }, data: { userId: webUser.id } });
        await tx.invoice.updateMany({ where: { userId: tempUser.id }, data: { userId: webUser.id } });
        await tx.auditLog.updateMany({ where: { userId: tempUser.id }, data: { userId: webUser.id } });

        // 1.5. Balance Transfer to preserve financial integrity and keep ledger immutable
        if (tempUser.balance > BigInt(0)) {
          const amount = Number(tempUser.balance);
          const reasonDebit = `Списание баланса при слиянии аккаунта ${tempUser.email} с ${webUser.email}`;
          const reasonCredit = `Перенос баланса со старого аккаунта ${tempUser.email}`;
          
          // Debit tempUser
          await WalletOps.charge(tx, tempUser.id, amount, reasonDebit, {
            idempotencyKey: `merge-debit-${tempUser.id}-${webUser.id}`
          });

          // Credit webUser
          await WalletOps.credit(tx, webUser.id, amount, reasonCredit, {
            idempotencyKey: `merge-credit-${tempUser.id}-${webUser.id}`
          });
        }

        // 2. Archive temp user instead of deleting, because of onDelete: Restrict on LedgerEntry
        await tx.user.update({
          where: { id: tempUser.id },
          data: {
            isActive: false,
            isDeleted: true,
            telegramId: null,
            email: `merged_${tempUser.id}@smmplan.stub`
          }
        });

        // 3. Bind telegramId to the target web user
        await tx.user.update({
          where: { id: webUser.id },
          data: { telegramId: tempUser.telegramId }
        });

        // 4. Audit Log
        await tx.adminAuditLog.create({
          data: {
            adminId: admin.id,
            adminEmail: admin.email,
            action: 'MANUAL_TELEGRAM_BIND',
            target: webUser.id,
            targetType: 'USER',
            oldValue: tempUser.email,
            newValue: webUser.email,
            ipAddress
          }
        });
      });

      revalidatePath(`/admin/tickets`);
      return { success: true };
    } catch (err) {
      console.error('[adminManualTelegramBind] Error:', err);
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });
}

export async function bulkRefillOrdersAction(ticketId: string, orderIds: string[]) {
  return requireStaffPermission('tickets', 'edit', async (admin) => {
    const ticket = await db.ticket.findFirst({
      where: { id: ticketId, tenantId: admin.tenantId ?? 'smmplan' }
    });
    if (!ticket) return { success: false as const, error: 'Тикет не найден' };

    let processedCount = 0;
    const errors: string[] = [];
    const createdRefills: { id: string; tenantId: string }[] = [];

    await db.$transaction(async (tx) => {
      for (const orderId of orderIds) {
        try {
          const order = await tx.order.findFirst({
            where: { id: orderId, userId: ticket.userId, tenantId: ticket.tenantId },
            include: { service: true }
          });

          if (!order) {
            errors.push(`Заказ ${orderId} не найден или принадлежит другому пользователю`);
            continue;
          }

          if (order.status === 'CANCELED' || order.status === 'ERROR') {
            errors.push(`Заказ #${order.numericId}: Невозможно докрутить отмененный или ошибочный заказ`);
            continue;
          }

          if (order.status === 'PARTIAL') {
            errors.push(`Заказ #${order.numericId}: Невозможно докрутить заказ с частичным возвратом`);
            continue;
          }

          if (!order.service.isRefillEnabled) {
            errors.push(`Заказ #${order.numericId}: Докрутка не поддерживается для этой услуги`);
            continue;
          }

          // R2-004 Fix: Check for existing active refill
          const activeRefill = await tx.refill.findFirst({
            where: {
              orderId: order.id,
              status: { in: ['PENDING', 'IN_PROGRESS'] }
            }
          });

          if (activeRefill) {
            errors.push(`Заказ #${order.numericId}: Уже есть активный запрос на докрутку`);
            continue;
          }

          const refill = await tx.refill.create({
            data: {
              orderId: order.id,
              status: 'PENDING'
            }
          });

          createdRefills.push({ id: refill.id, tenantId: order.tenantId });
          processedCount++;
        } catch (err: unknown) {
          errors.push(`Ошибка по заказу ${orderId}: ${(err instanceof Error ? err.message : String(err))}`);
        }
      }
    });

    const { refillQueue } = await import('@/lib/queue-manager');
    for (const refill of createdRefills) {
      await refillQueue.add('process-refill', { refillId: refill.id, tenantId: refill.tenantId });
    }

    const ipAddress = await getClientIp('unknown');
    auditAdmin({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'TICKET_BULK_REFILL',
      target: ticketId,
      targetType: 'TICKET',
      newValue: { orderIds, processedCount, errors },
      ipAddress
    });

    revalidatePath(`/admin/tickets/${ticketId}`);
    revalidatePath('/admin/refills');

    return { success: true as const, processedCount, errors };
  });
}

export async function bulkRefundOrdersAction(ticketId: string, orderIds: string[]) {
  return requireStaffPermission('tickets', 'edit', async (admin) => {
    const ticket = await db.ticket.findFirst({ 
      where: { id: ticketId, tenantId: admin.tenantId ?? 'smmplan' },
      include: { user: true }
    });
    if (!ticket) return { success: false as const, error: 'Тикет не найден' };

    // Check ApiConfig profile to see if the user is a API reseller
    const apiConfig = await db.apiConfig.findUnique({
      where: { userId: ticket.userId }
    });
    const isApiEnabledClient = !!apiConfig && apiConfig.isApiEnabled;

    let processedCount = 0;
    let totalRefundedCents = 0;
    const errors: string[] = [];

    const { calculatePartialRefund } = await import('@/utils/refund');

    const calculatedRefunds: { order: { id: string; numericId: number; userId: string; remains: number; quantity: number; charge: bigint; tenantId: string }; calculatedAmount: number }[] = [];

    const txResult = await db.$transaction(async (tx) => {
      // Calculate total refund cents first
      let totalToRefundCents = 0;

      for (const orderId of orderIds) {
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (order && !['CANCELED', 'PARTIAL'].includes(order.status) && order.remains > 0 && order.userId === ticket.userId) {
          const calculatedAmount = calculatePartialRefund({
            remains: order.remains,
            quantity: order.quantity,
            charge: order.charge
          });
          if (calculatedAmount > 0) {
            totalToRefundCents += calculatedAmount;
            calculatedRefunds.push({ order, calculatedAmount });
          }
        } else if (order) {
          if (order.userId !== ticket.userId) {
            errors.push(`Заказ ${orderId} принадлежит другому пользователю`);
          } else if (['CANCELED', 'PARTIAL'].includes(order.status)) {
            errors.push(`Заказ #${order.numericId}: Уже отменен или частично возвращен`);
          } else if (order.remains <= 0) {
            errors.push(`Заказ #${order.numericId}: Нет остатков для возврата (remains <= 0)`);
          }
        } else {
          errors.push(`Заказ ${orderId} не найден`);
        }
      }

      if (totalToRefundCents > 0 && !isApiEnabledClient) {
        const currentSpentToday = await getAdminSpentToday(admin.id, tx);
        const limitLeft = admin.supportLimitCents - currentSpentToday;
        if (totalToRefundCents > limitLeft) {
          return {
            failed: true as const,
            error: `Превышен суточный лимит компенсаций оператора. Требуется: ${(totalToRefundCents / 100).toFixed(2)} ₽, Осталось: ${(limitLeft / 100).toFixed(2)} ₽`
          };
        }
      }

      // Perform updates
      for (const item of calculatedRefunds) {
        await tx.order.update({
          where: { id: item.order.id },
          data: { status: 'PARTIAL' }
        });

        const idempotencyKey = `refund_ticket_${ticketId}_order_${item.order.id}`;
        await WalletOps.refund(tx, ticket.userId, item.calculatedAmount,
          `Компенсация (частичный возврат) по тикету #${ticketId} за недовыполненный заказ #${item.order.numericId}`,
          { idempotencyKey, adminId: admin.id, tenantId: item.order.tenantId || ticket.tenantId }
        );

        processedCount++;
        totalRefundedCents += item.calculatedAmount;
      }

      return { failed: false as const };
    }, { isolationLevel: 'Serializable' });

    if (txResult.failed) {
      return { success: false as const, error: txResult.error };
    }

    for (const item of calculatedRefunds) {
      CompensationService.trackCompensation(item.order.id).catch(err => console.error('[TicketActions] Failed to track compensation', err));
    }

    const ipAddress = await getClientIp('unknown');
    await auditAdminAwaitable({
      adminId: admin.id,
      adminEmail: admin.email,
      action: 'TICKET_BULK_REFUND',
      target: ticketId,
      targetType: 'TICKET',
      newValue: { orderIds, processedCount, totalRefundedCents, errors },
      ipAddress
    });

    revalidatePath(`/admin/tickets/${ticketId}`);
    revalidatePath(`/admin/tickets`);

    return { 
      success: true as const, 
      processedCount, 
      totalRefundedAmount: (totalRefundedCents / 100).toFixed(2), 
      errors 
    };
  });
}

import { getMSKMidnightUTC } from '@/services/admin/escrow.service';

// Internal helper for limit calculation (not an exported Server Action)
async function getAdminSpentToday(adminId: string, tx?: Prisma.TransactionClient): Promise<number> {
  const todayStart = getMSKMidnightUTC();

  const client = tx || db;
  const ledgerCompensations = await client.ledgerEntry.findMany({
    where: {
      adminId,
      createdAt: { gte: todayStart },
    },
    select: {
      amount: true
    }
  });

  return ledgerCompensations.reduce((acc: number, entry: { amount: bigint }) => {
    const amt = Number(entry.amount);
    return acc + Math.abs(amt);
  }, 0);
}


