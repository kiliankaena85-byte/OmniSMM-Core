'use server';

import { requireStaffPermission } from '@/lib/server/rbac';
import { db } from '@/lib/db';
import { auditAdminAwaitable } from '@/lib/admin-audit';
import { TesterInvitesService } from '@/services/security/tester-invites.service';
import { getBaseUrlAsync } from '@/utils/get-base-url';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

// SPEC-TYPEFIX-TESTER-INVITES-AUTH-2026: ВСЕ действия исполняются только внутри колбэка
// requireStaffPermission. Его отказ ({ success:false }) возвращается как есть, до любых побочных эффектов.

const generateSchema = z.object({
  count: z.number().int().min(1).max(50).default(10),
  note: z.string().max(255).optional(),
  tenantId: z.string().optional(),
});

type ActionFailure = { success: false; error: string };

function toFailure(err: unknown, fallback: string): ActionFailure {
  return { success: false, error: err instanceof Error && err.message ? err.message : fallback };
}

export async function generateTesterInvitesAction(input?: { count?: number; note?: string; tenantId?: string }) {
  return requireStaffPermission('clients', 'edit', async (admin, _role, activeTenantId) => {
    try {
      const parsed = generateSchema.parse(input || {});
      const targetTenantId = parsed.tenantId || activeTenantId || admin.tenantId || 'smmplan';

      const result = await TesterInvitesService.generateInvites(
        targetTenantId,
        parsed.count,
        admin.id,
        parsed.note
      );

      const baseUrl = await getBaseUrlAsync();
      const fullInvites = result.invites.map((item) => ({
        ...item,
        url: `${baseUrl}/invite/${item.code}`,
      }));

      await auditAdminAwaitable({
        adminId: admin.id,
        adminEmail: admin.email,
        action: 'GENERATE_TESTER_INVITES',
        target: `count:${result.count}`,
        targetType: 'TesterInvite',
        newValue: { count: result.count, tenantId: targetTenantId },
        tenantId: targetTenantId,
      });

      revalidatePath('/admin/testers');
      return {
        success: true as const,
        count: result.count,
        invites: fullInvites,
      };
    } catch (err: unknown) {
      return toFailure(err, 'Не удалось сгенерировать ссылки для тестировщиков');
    }
  });
}

export async function listTesterInvitesAction(params?: {
  page?: number;
  limit?: number;
  status?: string;
  tenantId?: string;
}) {
  return requireStaffPermission('clients', 'view', async (admin, _role, activeTenantId) => {
    try {
      const targetTenantId = params?.tenantId || activeTenantId || admin.tenantId || 'smmplan';

      const data = await TesterInvitesService.listInvites({
        tenantId: targetTenantId,
        page: params?.page || 1,
        limit: params?.limit || 50,
        status: params?.status,
      });

      const baseUrl = await getBaseUrlAsync();
      const itemsWithUrl = data.items.map((inv) => ({
        ...inv,
        url: `${baseUrl}/invite/${inv.code}`,
      }));

      return {
        success: true as const,
        data: {
          ...data,
          items: itemsWithUrl,
        },
      };
    } catch (err: unknown) {
      return toFailure(err, 'Не удалось загрузить список приглашений');
    }
  });
}

export async function revokeTesterInviteAction(inviteId: string, tenantId?: string) {
  return requireStaffPermission('clients', 'edit', async (admin, _role, activeTenantId) => {
    try {
      const targetTenantId = tenantId || activeTenantId || admin.tenantId || 'smmplan';

      const revoked = await TesterInvitesService.revokeInvite(inviteId, targetTenantId);

      if (revoked) {
        await auditAdminAwaitable({
          adminId: admin.id,
          adminEmail: admin.email,
          action: 'REVOKE_TESTER_INVITE',
          target: inviteId,
          targetType: 'TesterInvite',
          tenantId: targetTenantId,
        });
        revalidatePath('/admin/testers');
      }

      return { success: revoked };
    } catch (err: unknown) {
      return toFailure(err, 'Не удалось отозвать приглашение');
    }
  });
}

export async function toggleUserTesterStatusAction(userId: string, isTester: boolean) {
  return requireStaffPermission('clients', 'edit', async (admin, _role, activeTenantId) => {
    try {
      const targetTenantId = activeTenantId || admin.tenantId || 'smmplan';

      // INV-RBAC-05 (BOLA): менять isTester можно только пользователю активного tenant
      const target = await db.user.findFirst({
        where: { id: userId, tenantId: targetTenantId },
        select: { id: true, email: true },
      });
      if (!target) {
        return { success: false as const, error: 'Пользователь не найден в текущем сервисе' };
      }

      const updatedUser = await db.user.update({
        where: { id: userId },
        data: { isTester },
        select: { id: true, email: true, isTester: true },
      });

      await auditAdminAwaitable({
        adminId: admin.id,
        adminEmail: admin.email,
        action: 'TOGGLE_USER_TESTER_STATUS',
        target: userId,
        targetType: 'User',
        newValue: { isTester },
        tenantId: targetTenantId,
      });

      revalidatePath('/admin/testers');
      revalidatePath(`/admin/clients/${userId}`);
      return { success: true as const, user: updatedUser };
    } catch (err: unknown) {
      return toFailure(err, 'Не удалось изменить статус тестировщика');
    }
  });
}
