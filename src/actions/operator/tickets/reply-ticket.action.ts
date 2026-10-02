'use server';

import { requireOperatorPermission } from '@/lib/operator/rbac';
import { db } from '@/lib/db';
import { ticketService } from '@/services/support/ticket.service';
import { publishMessageSSE } from '@/services/support/sse.service';
import { getClientIp } from '@/utils/ip';
import { auditAdminAwaitable } from '@/lib/admin-audit';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const schema = z.object({
  ticketId: z.string().min(1),
  message: z.string().min(1, 'Сообщение не может быть пустым'),
  isInternal: z.boolean().default(false),
});

export async function replyTicketAction(data: {
  ticketId: string;
  message: string;
  isInternal?: boolean;
}) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const errorMsg = parsed.error.errors[0]?.message || 'Некорректные входные данные';
    return { success: false as const, error: errorMsg };
  }

  try {
    const result = await requireOperatorPermission('tickets', 'edit', async (admin) => {
      const { ticketId, message, isInternal } = parsed.data;

      const ticket = await db.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true, userId: true, tenantId: true },
      });
      if (!ticket || (admin.tenantId && ticket.tenantId && admin.tenantId !== 'smmplan' && ticket.tenantId !== admin.tenantId)) {
        return { success: false as const, error: 'Обращение не найдено или доступ ограничен' };
      }

      const sender = isInternal ? 'INTERNAL' : 'STAFF';

      // Save message in DB
      const savedMsg = await ticketService.addMessage(
        ticketId,
        sender,
        message,
        undefined, // mediaUrl
        undefined, // mediaType
        undefined, // replyToId
        undefined, // telegramMsgId
        undefined, // attachments
        undefined  // orderId
      );

      // Audit Action
      const ipAddress = await getClientIp('unknown');
      await auditAdminAwaitable({
        adminId: admin.id,
        adminEmail: admin.email,
        action: isInternal ? 'TICKET_INTERNAL_NOTE_ADD' : 'TICKET_REPLY_SEND',
        target: ticketId,
        targetType: 'TICKET',
        newValue: { message },
        ipAddress,
      });

      // Broadcast to client via Server-Sent Events (only for client-facing replies)
      if (sender === 'STAFF' && savedMsg?.id) {
        await publishMessageSSE(ticketId, savedMsg.id);
      }

      return { success: true as const };
    });

    if (result.success) {
      revalidatePath(`/operator/tickets`);
    }

    return result;
  } catch (err) {
    console.error('[replyTicketAction] Error replying to ticket:', err);
    const message = err instanceof Error ? err.message : 'Ошибка сервера при отправке ответа';
    return { success: false as const, error: message };
  }
}
