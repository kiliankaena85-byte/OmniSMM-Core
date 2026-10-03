'use server';

import { requireStaffPermission } from '@/lib/server/rbac';
import { db } from '@/lib/db';
import { auditAdminAwaitable } from '@/lib/admin-audit';
import { TesterInvitesService } from '@/services/security/tester-invites.service';
import { getBaseUrlAsync } from '@/utils/get-base-url';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

const generateSchema = z.object({
  count: z.number().int().min(1).max(50).default(10),
  note: z.string().max(255).optional(),
  tenantId: z.string().optional(),
});

export async function generateTesterInvitesAction(input?: { count?: number; note?: string; tenantId?: string }) {
  try {
    const admin = await requireStaffPermission('clients', 'edit');
    const parsed = generateSchema.parse(input || {});
    const targetTenantId = parsed.tenantId || admin.tenantId || 'smmplan';

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
      details: `Generated ${result.count} tester invites for tenant ${targetTenantId}`,
      tenantId: targetTenantId,
    });

    revalidatePath('/admin/testers');
    return {
      success: true,
      count: result.count,
      invites: fullInvites,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Не удалось сгенерировать ссылки для тестировщиков',
    };
  }
}

export async function listTesterInvitesAction(params?: {
  page?: number;
  limit?: number;
  status?: string;
  tenantId?: string;
}) {
  try {
    const admin = await requireStaffPermission('clients', 'view');
    const targetTenantId = params?.tenantId || admin.tenantId || 'smmplan';

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
      success: true,
      data: {
        ...data,
        items: itemsWithUrl,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Не удалось загрузить список приглашений',
    };
  }
}

export async function revokeTesterInviteAction(inviteId: string, tenantId?: string) {
  try {
    const admin = await requireStaffPermission('clients', 'edit');
    const targetTenantId = tenantId || admin.tenantId || 'smmplan';

    const success = await TesterInvitesService.revokeInvite(inviteId, targetTenantId);

    if (success) {
      await auditAdminAwaitable({
        adminId: admin.id,
        adminEmail: admin.email,
        action: 'REVOKE_TESTER_INVITE',
        target: inviteId,
        details: `Revoked tester invite ${inviteId}`,
        tenantId: targetTenantId,
      });
      revalidatePath('/admin/testers');
    }

    return { success };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Не удалось отозвать приглашение',
    };
  }
}

export async function toggleUserTesterStatusAction(userId: string, isTester: boolean) {
  try {
    const admin = await requireStaffPermission('clients', 'edit');

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
      details: `Set isTester=${isTester} for user ${updatedUser.email}`,
    });

    revalidatePath('/admin/testers');
    revalidatePath(`/admin/clients/${userId}`);
    return { success: true, user: updatedUser };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Не удалось изменить статус тестировщика',
    };
  }
}
