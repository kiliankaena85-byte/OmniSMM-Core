import crypto from 'crypto';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface GeneratedInviteItem {
  code: string;
  tenantId: string;
  status: string;
  expiresAt: Date;
  createdById?: string | null;
  note?: string | null;
}

export class TesterInvitesService {
  public static readonly INVITE_VALIDITY_DAYS = 14;

  /**
   * Generates a batch of unique single-use 14-day tester invite links (INV-TESTER-02).
   */
  public static async generateInvites(
    tenantId: string = 'smmplan',
    count: number = 10,
    createdById?: string,
    note?: string
  ): Promise<{ count: number; invites: GeneratedInviteItem[] }> {
    const safeCount = Math.max(1, Math.min(count, 100));
    const now = Date.now();
    const expiresAt = new Date(now + this.INVITE_VALIDITY_DAYS * 24 * 60 * 60 * 1000);

    const invites: GeneratedInviteItem[] = [];
    for (let i = 0; i < safeCount; i++) {
      const code = crypto.randomBytes(16).toString('hex');
      invites.push({
        code,
        tenantId,
        status: 'ACTIVE',
        expiresAt,
        createdById: createdById || null,
        note: note || null,
      });
    }

    await db.testerInvite.createMany({
      data: invites,
    });

    logger.info({
      msg: '[TesterInvitesService] Generated tester invites batch',
      tenantId,
      count: safeCount,
      createdById,
    });

    return {
      count: safeCount,
      invites,
    };
  }

  /**
   * Validates an invite link without consuming it (read-only inspection for UI).
   */
  public static async validateInvite(
    code: string,
    tenantId?: string
  ): Promise<{ valid: boolean; error?: string; invite?: any }> {
    if (!code || typeof code !== 'string') {
      return { valid: false, error: 'Код приглашения не указан' };
    }

    const invite = await db.testerInvite.findUnique({
      where: { code },
      include: {
        createdBy: {
          select: { id: true, email: true },
        },
      },
    });

    if (!invite) {
      return { valid: false, error: 'Ссылка-приглашение не найдена' };
    }

    if (tenantId && invite.tenantId !== tenantId) {
      return { valid: false, error: 'Ссылка-приглашение предназначена для другого сервиса' };
    }

    if (invite.status !== 'ACTIVE') {
      return { valid: false, error: 'Ссылка-приглашение уже использована или отозвана' };
    }

    if (new Date(invite.expiresAt).getTime() <= Date.now()) {
      return { valid: false, error: 'Срок действия приглашения истёк (действует 14 дней)' };
    }

    return { valid: true, invite };
  }

  /**
   * Atomically redeems a tester invite, binds it to the user email, and sets isTester = true (INV-TESTER-01 & 03).
   */
  public static async redeemInvite(
    code: string,
    userId: string,
    userEmail: string,
    tenantId?: string
  ): Promise<{ success: boolean; error?: string; message?: string }> {
    if (!code || !userId || !userEmail) {
      return { success: false, error: 'Некорректные параметры для активации приглашения' };
    }

    const existing = await db.testerInvite.findUnique({
      where: { code },
    });

    if (!existing) {
      return { success: false, error: 'Ссылка-приглашение не найдена' };
    }

    if (existing.status !== 'ACTIVE') {
      return { success: false, error: 'Ссылка-приглашение уже использована или недействительна' };
    }

    const now = new Date();
    if (new Date(existing.expiresAt).getTime() <= now.getTime()) {
      return { success: false, error: 'Срок действия приглашения истёк (действует 14 дней)' };
    }

    if (tenantId && existing.tenantId !== tenantId) {
      return { success: false, error: 'Ссылка-приглашение предназначена для другого сервиса' };
    }

    try {
      await db.$transaction(async (tx) => {
        const updateResult = await tx.testerInvite.updateMany({
          where: {
            code,
            status: 'ACTIVE',
            expiresAt: { gt: now },
            ...(tenantId ? { tenantId } : {}),
          },
          data: {
            status: 'USED',
            usedById: userId,
            usedEmail: userEmail,
            usedAt: now,
          },
        });

        if (updateResult.count !== 1) {
          throw new Error('Ссылка-приглашение уже использована или недействительна');
        }

        await tx.user.update({
          where: { id: userId },
          data: { isTester: true },
        });
      });

      logger.info({
        msg: '[TesterInvitesService] Successfully redeemed tester invite',
        code,
        userId,
        userEmail,
        tenantId: existing.tenantId,
      });

      return {
        success: true,
        message: 'Статус тестировщика успешно активирован! Теперь вам доступно тестовое пополнение и оформление заказов.',
      };
    } catch (err: any) {
      logger.warn({
        msg: '[TesterInvitesService] Redemption failed',
        code,
        userId,
        error: err?.message,
      });
      return {
        success: false,
        error: err?.message || 'Не удалось активировать ссылку-приглашение',
      };
    }
  }

  /**
   * Lists invites for admin panel with pagination and filters.
   */
  public static async listInvites(params: {
    tenantId: string;
    page?: number;
    limit?: number;
    status?: string;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(params.limit || 50, 100));
    const skip = (page - 1) * limit;

    const where: any = { tenantId: params.tenantId };
    if (params.status && params.status !== 'ALL') {
      where.status = params.status;
    }

    const [items, total] = await Promise.all([
      db.testerInvite.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          createdBy: { select: { id: true, email: true } },
          usedBy: { select: { id: true, email: true } },
        },
      }),
      db.testerInvite.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Revokes an active invite.
   */
  public static async revokeInvite(id: string, tenantId: string) {
    const updated = await db.testerInvite.updateMany({
      where: { id, tenantId, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
    return updated.count > 0;
  }
}
