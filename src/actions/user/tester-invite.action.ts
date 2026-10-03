'use server';

import { verifySession } from '@/lib/session';
import { db } from '@/lib/db';
import { headers } from 'next/headers';
import { resolveTenantFromRequest } from '@/lib/tenant-resolver-edge';
import { TesterInvitesService } from '@/services/security/tester-invites.service';

export interface TesterInviteActionResult {
  success: boolean;
  message?: string;
  error?: string;
  invite?: {
    code: string;
    status: string;
    expiresAt: string;
    note?: string | null;
  };
}

export async function validateTesterInviteAction(code: string): Promise<TesterInviteActionResult> {
  try {
    const reqHeaders = await headers();
    const tenantId = resolveTenantFromRequest(reqHeaders);

    const validation = await TesterInvitesService.validateInvite(code, tenantId);
    if (!validation.valid || !validation.invite) {
      return {
        success: false,
        error: validation.error || 'Ссылка-приглашение недействительна',
      };
    }

    return {
      success: true,
      invite: {
        code: validation.invite.code,
        status: validation.invite.status,
        expiresAt: new Date(validation.invite.expiresAt).toISOString(),
        note: validation.invite.note,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Ошибка проверки приглашения',
    };
  }
}

export async function redeemTesterInviteAction(code: string): Promise<TesterInviteActionResult> {
  try {
    const reqHeaders = await headers();
    const tenantId = resolveTenantFromRequest(reqHeaders);

    const session = await verifySession(tenantId);
    if (!session || !session.userId) {
      return {
        success: false,
        error: 'Для активации ссылки-приглашения необходимо войти в аккаунт или зарегистрироваться',
      };
    }

    const user = await db.user.findFirst({
      where: { id: session.userId, tenantId },
      select: { id: true, email: true, isTester: true, isActive: true, isDeleted: true },
    });

    if (!user || user.isDeleted || !user.isActive) {
      return {
        success: false,
        error: 'Пользователь не найден или заблокирован',
      };
    }

    if (user.isTester) {
      return {
        success: true,
        message: 'Вы уже являетесь участником программы тестирования! Тестовые платежи и функции доступны.',
      };
    }

    const result = await TesterInvitesService.redeemInvite(code, user.id, user.email, tenantId);
    return result;
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Не удалось активировать приглашение',
    };
  }
}
