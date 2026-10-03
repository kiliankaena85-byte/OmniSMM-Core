import { createHmac, timingSafeEqual } from 'crypto';
import { redis } from '@/lib/redis';

const RATE_LIMIT_WINDOW_SECONDS = 3600; // 1 час
const RATE_LIMIT_MAX_REQUESTS = 360; // 1 задача каждые 10 секунд при открытом окне

/**
 * Валидирует Telegram.WebApp.initData по HMAC-SHA256 (официальный алгоритм Telegram)
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
async function validateTelegramInitData(initData: string, tenantId?: string): Promise<{
  valid: boolean;
  telegramId?: string;
  username?: string;
  error?: string;
}> {
  let botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  if (tenantId) {
    try {
      const { tokenResolver } = await import('@/lib/telegram/token-resolver');
      const resolved = await tokenResolver.resolveBotToken(tenantId);
      if (resolved) botToken = resolved;
    } catch {
      // fallback to env
    }
  }

  if (!botToken) {
    if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_DEP_AUTH === 'true') {
      return { valid: true, telegramId: 'dev_user_12345', username: 'dev_user' };
    }
    return { valid: false, error: 'TELEGRAM_BOT_TOKEN не задан' };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false, error: 'NO_HASH_IN_INITDATA' };

    // Строим checkString: все поля кроме hash, отсортированные по имени, через \n
    params.delete('hash');
    const checkString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // HMAC-SHA256: secret = HMAC-SHA256("WebAppData", botToken), data = checkString
    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expectedHash = createHmac('sha256', secretKey).update(checkString).digest('hex');

    const expectedBuf = Buffer.from(expectedHash, 'hex');
    const actualBuf = Buffer.from(hash, 'hex');
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      return { valid: false, error: 'INVALID_SIGNATURE' };
    }

    // Проверяем срок действия initData (не старше 24 часов)
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    if (Date.now() / 1000 - authDate > 86_400) {
      return { valid: false, error: 'INITDATA_EXPIRED' };
    }

    // Извлекаем данные пользователя
    const userRaw = params.get('user');
    if (!userRaw) return { valid: false, error: 'NO_USER_IN_INITDATA' };

    const user = JSON.parse(userRaw) as { id?: number; username?: string };
    const telegramId = String(user.id || '');
    if (!telegramId) return { valid: false, error: 'NO_USER_ID' };

    return { valid: true, telegramId, username: user.username };
  } catch {
    return { valid: false, error: 'PARSE_ERROR' };
  }
}

/**
 * [P0 BUG-2 FIX] Выдает nodeId привязанный к реальному Telegram ID пользователя.
 * Валидирует initData через HMAC-SHA256.
 *
 * POST /api/depin/auth
 * Body: { initData: string }
 * Response: { nodeId: string; telegramId: string; username?: string }
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    const initData = body?.initData;

    if (!initData || typeof initData !== 'string') {
      return Response.json(
        { success: false, error: 'initData обязателен' },
        { status: 400 }
      );
    }

    const tenantId = request.headers.get('x-tenant-id') || undefined;
    const validation = await validateTelegramInitData(initData, tenantId);
    if (!validation.valid) {
      return Response.json(
        { success: false, error: validation.error || 'INVALID_INITDATA' },
        { status: 401 }
      );
    }

    const telegramId = validation.telegramId!;
    // nodeId детерминирован: tg_{telegram_id} — стабилен при смене устройства/браузера
    const nodeId = `tg_${telegramId}`;

    // Touch / upsert DePinNode visit for DAU/MAU analytics
    try {
      const { db } = await import('@/lib/db');
      await db.dePinNode.upsert({
        where: { id: nodeId },
        create: {
          id: nodeId,
          lastVisitedAt: new Date(),
          lastActiveAt: new Date(),
        },
        update: {
          lastVisitedAt: new Date(),
          lastActiveAt: new Date(),
        },
      });
    } catch {
      // non-blocking
    }

    return Response.json({
      success: true,
      nodeId,
      telegramId,
      username: validation.username,
    });
  } catch {
    return Response.json({ success: false, error: 'AUTH_INTERNAL_ERROR' }, { status: 500 });
  }
}

/**
 * [P0 BUG-1 FIX] Rate-limit проверка для DePIN узла.
 * Ограничивает до 360 задач в час с одного nodeId через Redis.
 *
 * GET /api/depin/auth?nodeId=tg_12345&action=check_rate
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId');
    const action = url.searchParams.get('action');

    if (!nodeId || typeof nodeId !== 'string' || nodeId.length < 3) {
      return Response.json({ success: false, error: 'nodeId обязателен' }, { status: 400 });
    }

    if (action === 'check_rate') {
      const rateLimitKey = `depin:rate:${nodeId}`;
      const current = await redis.incr(rateLimitKey);

      if (current === 1) {
        // Первый запрос в окне — устанавливаем TTL
        await redis.expire(rateLimitKey, RATE_LIMIT_WINDOW_SECONDS);
      }

      const ttl = await redis.ttl(rateLimitKey);
      const allowed = current <= RATE_LIMIT_MAX_REQUESTS;

      return Response.json({
        success: true,
        allowed,
        current,
        limit: RATE_LIMIT_MAX_REQUESTS,
        resetInSeconds: ttl,
      });
    }

    return Response.json({ success: false, error: 'Неизвестный action' }, { status: 400 });
  } catch {
    return Response.json({ success: false, error: 'RATE_CHECK_ERROR' }, { status: 500 });
  }
}
