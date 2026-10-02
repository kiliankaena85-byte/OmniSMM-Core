'use server';

import { db } from '@/lib/db';
import { requireStaffPermission } from '@/lib/server/rbac';
import { revalidatePath } from 'next/cache';
import { WalletOps } from '@/services/financial/wallet-ops';
import { z } from 'zod';
import crypto from 'crypto';
import { getClientIp } from '@/utils/ip';
import { headers } from 'next/headers';
import { SupportBalancePolicyService } from '@/services/financial/support-balance-policy.service';
import { auditAdminAwaitable } from '@/lib/admin-audit';
import { ExactMath } from '@/lib/financial/exact-math';

const compensationSchema = z.object({
  ticketId: z.string().min(1),
  costRub: z.number().positive().max(50000),
  note: z.string().min(10, 'Комментарий должен содержать минимум 10 символов'),
  topUpBalance: z.boolean().default(false),
  clientOperationToken: z.string().optional()
});

export async function logManualCompensation(formData: FormData) {
  return requireStaffPermission('tickets', 'edit', async (user) => {
    const rawCostRub = parseFloat(formData.get('costRub') as string);
    const parsed = compensationSchema.safeParse({
      ticketId: formData.get('ticketId'),
      costRub: isNaN(rawCostRub) ? 0 : rawCostRub,
      note: formData.get('note'),
      topUpBalance: formData.get('topUpBalance') === 'true',
      clientOperationToken: (formData.get('clientOperationToken') as string) || undefined
    });

    if (!parsed.success) {
      return { success: false as const, error: parsed.error.errors[0]?.message || 'Неверные параметры запроса' };
    }

    const { ticketId, costRub, note, topUpBalance, clientOperationToken } = parsed.data;
    const costCents = ExactMath.rublesToKopecks(costRub);

    const ticket = await db.ticket.findUnique({
      where: { id: ticketId },
      select: { userId: true, id: true, tenantId: true }
    });

    if (!ticket) {
      return { success: false as const, error: 'Тикет не найден' };
    }

    if (user.role !== 'OWNER' && ticket.tenantId !== user.tenantId && !user.allowedTenants?.includes(ticket.tenantId)) {
      return { success: false as const, error: 'Доступ ограничен: тикет принадлежит другому бренду' };
    }

    const reqHeaders = await headers();
    const userAgent = reqHeaders.get('user-agent') || 'Unknown';
    const ipAddress = await getClientIp('unknown');

    // Deterministic Idempotency Key
    const opToken = clientOperationToken || crypto.createHash('md5').update(`${ticketId}-${costCents}-${note}`).digest('hex');
    const idempotencyKey = `support-compensation-${ticket.id}-${ticket.userId}-${opToken}`;

    // Perform Policy Engine Check & Reserve Daily Limit in Serializable Transaction
    try {
      const actionResult = await db.$transaction(async (tx) => {
        const policyCheck = await SupportBalancePolicyService.validateAndReserveSupportOperation(tx, {
          staffUserId: user.id,
          targetUserId: ticket.userId,
          direction: 'CREDIT',
          amountCents: costCents,
          reasonCode: topUpBalance ? 'COMPENSATION_BALANCE' : 'COMPENSATION_REFILL',
          reasonNote: note,
          source: 'SUPPORT_COMPENSATION',
          ticketId: ticket.id,
          idempotencyKey,
          ipAddress,
          userAgent
        });

        if (!policyCheck.allowed) {
          return { failed: true as const, error: policyCheck.error };
        }

        // eslint-disable-next-line no-useless-assignment
        let ledgerEntryId: string | undefined = undefined;

        // Perform financial wallet modification via WalletOps
        if (topUpBalance) {
          const ledgerResult = await WalletOps.credit(tx, ticket.userId, costCents,
            `Компенсация в тикете #${ticket.id}: ${note}`,
            { adminId: user.id, idempotencyKey }
          );
          ledgerEntryId = ledgerResult.success && ledgerResult.entry ? ledgerResult.entry.id : undefined;
        } else {
          const creditKey = `compensation-credit-${idempotencyKey}`;
          const chargeKey = `compensation-charge-${idempotencyKey}`;

          const ledgerResult = await WalletOps.credit(tx, ticket.userId, costCents,
            `Компенсация (Докрут) в тикете #${ticket.id}: ${note}`,
            { adminId: user.id, idempotencyKey: creditKey }
          );
          ledgerEntryId = ledgerResult.success && ledgerResult.entry ? ledgerResult.entry.id : undefined;

          await WalletOps.charge(tx, ticket.userId, costCents,
            `Списание за ручной докрут в тикете #${ticket.id}: ${note}`,
            { idempotencyKey: chargeKey }
          );
        }

        // Determine review status (Auto-flag if amount > 5,000 RUB or staff has warnings)
        const isFlagged = costRub >= 5000 || policyCheck.warnings.length > 0;
        const reviewStatus = isFlagged ? 'FLAGGED' : 'PENDING';

        // Create SupportFinancialAction record
        const financialAction = await tx.supportFinancialAction.create({
          data: {
            tenantId: ticket.tenantId || user.tenantId || 'smmplan',
            staffUserId: user.id,
            targetUserId: ticket.userId,
            direction: 'CREDIT',
            source: 'SUPPORT_COMPENSATION',
            amountCents: costCents,
            reasonCode: topUpBalance ? 'COMPENSATION_BALANCE' : 'COMPENSATION_REFILL',
            reasonNote: note,
            ticketId: ticket.id,
            policyId: policyCheck.policy.id,
            policySnapshot: JSON.parse(JSON.stringify(policyCheck.policy, (_, v) => typeof v === 'bigint' ? v.toString() : v)),
            idempotencyKey,
            status: 'EXECUTED',
            ledgerEntryId,
            consentId: policyCheck.consentId || null,
            reviewStatus,
            ipAddress,
            userAgent
          }
        });

        // Add silent message to ticket chat
        await tx.ticketMessage.create({
          data: {
            ticketId: ticket.id,
            sender: 'INTERNAL',
            text: `[СИСТЕМА] Сотрудник (${user.email}) оформил компенсацию (${topUpBalance ? 'зачислен баланс' : 'ручной докрут'}). Сумма: ${costRub.toLocaleString('ru-RU')} ₽.\nПричина: ${note}`
          }
        });

        return { failed: false as const, financialActionId: financialAction.id, warnings: policyCheck.warnings };
      });

      if (actionResult.failed) {
        return { success: false as const, error: actionResult.error };
      }

      // Awaitable Audit Log
      await auditAdminAwaitable({
        adminId: user.id,
        adminEmail: user.email,
        action: topUpBalance ? 'SUPPORT_BALANCE_COMPENSATION' : 'SUPPORT_REFILL_COMPENSATION',
        target: ticket.id,
        targetType: 'TICKET',
        oldValue: JSON.stringify({ amountCents: 0 }),
        newValue: JSON.stringify({ amountCents: costCents.toString(), actionId: actionResult.financialActionId }),
        ipAddress
      });

      revalidatePath('/admin/tickets');
      revalidatePath(`/admin/tickets/${ticketId}`, 'page');
      revalidatePath(`/admin/finance`);

      return { success: true as const, warnings: actionResult.warnings };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Ошибка при оформлении компенсации';
      return { success: false as const, error: errorMessage };
    }
  });
}
