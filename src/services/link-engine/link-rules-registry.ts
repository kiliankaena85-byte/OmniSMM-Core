import { z } from 'zod';
import { IntelligencePlatform } from '../analyzer/link-rules';

/**
 * Unified and pre-compiled regex registry for platform & targetType combinations.
 * All patterns are vetted for linear execution (ReDoS immune).
 */
export const UNIFIED_REGEX = {
  TELEGRAM: {
    // Allows public channel / group / profile: t.me/durov, t.me/@durov, t.me/joinchat/xxx, t.me/+xxx, t.me/s/durov, t.me/boost/xxx, t.me/xxx/boost, t.me/c/xxx/boost
    CHANNEL: /^https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/(?:joinchat\/|\+|s\/|boost\/)?(?:c\/\d+|@?[\w-]+)(?:\/boost)?\/?(?:\?.*)?$/i,
    // Allows posts: t.me/channel/123, topic posts: t.me/group/100/250, web previews: t.me/s/channel/123
    POST: /^https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?[\w-]+\/(?:topic\/)?\d+(?:\/\d+)?\/?(?:\?.*)?$/i,
    // Allows posts in private channels (t.me/c/1234567890/123) as well as public channels
    PRIVATE_POST: /^https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/(?:c\/\d+\/(?:topic\/)?\d+(?:\/\d+)?|(?:s\/)?[\w-]+\/(?:topic\/)?\d+(?:\/\d+)?)\/?(?:\?.*)?$/i,
    // Allows stories: t.me/channel/s/123
    STORY: /^https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/[\w-]+\/s\/\d+\/?$/i,
    // Allows comments: t.me/channel/123?comment=456
    COMMENT: /^https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/[\w-]+\/\d+\?(?:.*&)?comment=\d+$/i,
    // Allows bot: t.me/my_bot, t.me/my_bot?start=ref
    BOT: /^https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/[\w-]+_bot(?:\?start=[\w-]+)?$/i,
    // Allows poll: t.me/channel/123
    POLL: /^https?:\/\/(?:t\.me|telegram\.me|telegram\.dog)\/(?:s\/)?[\w-]+\/\d+\/?$/i,
  },

  VK: {
    // Allows posts, videos, clips, photos: vk.com/wall-1_2, vk.com/video-1_2, vk.com/clip-1_2, vk.com/photo-1_2
    POST: /^https?:\/\/(?:m\.)?(?:vk\.(?:com|ru)|vkvideo\.ru)\/(?:wall|video|clip|photo)-?\d+_\d+/i,
    // Allows groups, publics, users: vk.com/durov, vk.com/public123, vk.com/club123, vk.com/id123
    CHANNEL: /^https?:\/\/(?:m\.)?vk\.(?:com|ru)\/(?:public\d+|club\d+|id\d+|[a-zA-Z0-9_.]+)\/?$/i,
    // Allows comments with reply param (ReDoS hardened)
    COMMENT: /^https?:\/\/(?:m\.)?(?:vk\.(?:com|ru)|vkvideo\.ru)\/(?:wall|video|clip|photo)-?\d+_\d+\?[^#]*\breply=\d+/i,
    // Allows polls
    POLL: /^https?:\/\/(?:m\.)?(?:vk\.(?:com|ru)|vkvideo\.ru)\/(?:wall|video|clip|photo)-?\d+_\d+/i,
  },

  INSTAGRAM: {
    // Allows p, reel, reels, tv, share/p, share/reel
    POST: /^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:p|reel|reels|tv|share\/[a-zA-Z0-9_-]+)\/[a-zA-Z0-9_-]+\/?/i,
    // Allows profile
    CHANNEL: /^https?:\/\/(?:www\.|m\.)?instagram\.com\/@?[a-zA-Z0-9_.]+\/?$/i,
    // Allows story: instagram.com/stories/username/123 or profile
    STORY: /^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:stories\/[a-zA-Z0-9_.]+\/\d+|@?[a-zA-Z0-9_.]+)\/?$/i,
    // Allows comments: instagram.com/p/xxx/c/yyy
    COMMENT: /^https?:\/\/(?:www\.|m\.)?instagram\.com\/(?:p|reel|reels|tv)\/[a-zA-Z0-9_-]+\/c\/[a-zA-Z0-9_-]+\/?/i,
    // Allows polls
    POLL: /^https?:\/\/(?:www\.|m\.)?instagram\.com\/@?[a-zA-Z0-9_.]+\/?$/i,
  },

  TIKTOK: {
    // Allows video/photo posts or share links
    POST: /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@[a-zA-Z0-9_.]+\/(?:video|photo)\/\d+|^https?:\/\/(?:vm|vt)\.tiktok\.com\/[a-zA-Z0-9_]+/i,
    // Allows profile
    CHANNEL: /^https?:\/\/(?:www\.|m\.)?tiktok\.com\/@?[a-zA-Z0-9_.]+\/?$/i,
  },

  YOUTUBE: {
    // Allows watch, shorts, live, embed, youtu.be
    POST: /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/)|youtu\.be\/)[a-zA-Z0-9_-]+/i,
    // Allows channels: @handle, channel/UC..., c/..., user/...
    CHANNEL: /^https?:\/\/(?:www\.|m\.)?youtube\.com\/(@[a-zA-Z0-9_.-]+|channel\/UC[a-zA-Z0-9_.-]+|c\/[a-zA-Z0-9_.-]+|user\/[a-zA-Z0-9_.-]+)\/?$/i,
    // Allows comments with &lc= param
    COMMENT: /^https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?.*[?&]v=[a-zA-Z0-9_-]+.*[?&]lc=[a-zA-Z0-9_-]+/i,
  },

  RUTUBE: {
    POST: /^https?:\/\/(?:www\.)?rutube\.ru\/(?:video|shorts|play\/embed)\/[a-zA-Z0-9_-]+\/?/i,
    CHANNEL: /^https?:\/\/(?:www\.)?rutube\.ru\/(?:channel\/\d+|u\/[a-zA-Z0-9_.-]+|feeds\/[a-zA-Z0-9_.-]+)\/?/i,
  },

  OK: {
    POST: /^https?:\/\/(?:www\.|m\.)?ok\.ru\/(?:group|profile)\/\d+\/(?:topic|statuses)\/\d+/i,
    CHANNEL: /^https?:\/\/(?:www\.|m\.)?ok\.ru\/(?:group\/\d+|profile\/\d+|[a-zA-Z0-9_.-]+)\/?$/i,
  },

  TWITTER: {
    POST: /^https?:\/\/(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+\/status\/\d+/i,
    CHANNEL: /^https?:\/\/(?:twitter\.com|x\.com)\/@?[a-zA-Z0-9_]+\/?$/i,
  },

  THREADS: {
    POST: /^https?:\/\/(?:www\.)?threads\.net\/@[a-zA-Z0-9_.]+\/post\/[a-zA-Z0-9_-]+/i,
    CHANNEL: /^https?:\/\/(?:www\.)?threads\.net\/@?[a-zA-Z0-9_.]+\/?$/i,
  },

  FACEBOOK: {
    POST: /^https?:\/\/(?:www\.|m\.)?(?:facebook\.com|fb\.watch)\/.+/i,
    CHANNEL: /^https?:\/\/(?:www\.|m\.)?facebook\.com\/.+/i,
  },

  TWITCH: {
    POST: /^https?:\/\/(?:www\.|m\.)?twitch\.tv\/videos\/\d+/i,
    CHANNEL: /^https?:\/\/(?:www\.|m\.)?twitch\.tv\/[a-zA-Z0-9_]+\/?$/i,
  },

  KICK: {
    CHANNEL: /^https?:\/\/(?:www\.)?kick\.com\/[a-zA-Z0-9_.-]+\/?$/i,
  },

  SPOTIFY: {
    POST: /^https?:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9_-]+/i,
    CHANNEL: /^https?:\/\/open\.spotify\.com\/(?:playlist|album|artist)\/[a-zA-Z0-9_-]+/i,
  },

  MAX: {
    CHANNEL: /^https?:\/\/(?:www\.)?max\.ru\/(?:c\/(?:-?\d+(?:\/[a-zA-Z0-9_-]+)?|[a-zA-Z0-9_.-]+)|[a-zA-Z0-9_.-]+)\/?$/i,
  },

  DZEN: {
    POST: /^https?:\/\/(?:www\.)?(?:dzen\.ru|zen\.yandex\.ru)\/(?:a\/|b\/|shorts\/|video\/watch\/|media\/(?:[\w.-]+\/)?)[a-zA-Z0-9_-]+/i,
    CHANNEL: /^https?:\/\/(?:www\.)?(?:dzen\.ru|zen\.yandex\.ru)\/(?:id\/[a-zA-Z0-9_-]+|u\/[a-zA-Z0-9_.-]+|channel\/[a-zA-Z0-9_-]+|@?[a-zA-Z0-9_.-]+)\/?/i,
  },

  LIKEE: {
    POST: /^https?:\/\/(?:l\.likee\.video\/v\/[\w-]+|(?:likee\.video|likee\.com)\/@[\w.]+\/video\/\d+)/i,
    CHANNEL: /^https?:\/\/(?:l\.likee\.video\/p\/[\w-]+|(?:likee\.video|likee\.com)\/@[\w.]+)\/?/i,
  },

  DISCORD: {
    CHANNEL: /^https?:\/\/(?:www\.)?(?:discord\.gg|discord\.com\/invite)\/[a-zA-Z0-9_-]+/i,
  }
};

/**
 * Returns a compiled Zod schema validator for a specific platform and targetType.
 */
export function getUnifiedLinkValidator(
  platform: string,
  targetType: string,
  options?: { isPrivate?: boolean }
): z.ZodType<string> {
  const normPlatform = (platform || '').toUpperCase();
  const normTarget = (targetType || '').toUpperCase();
  const isPrivate = options?.isPrivate === true || normTarget === 'PRIVATE_POST';

  switch (normPlatform) {
    case 'TELEGRAM':
      if (normTarget === 'CHANNEL' || normTarget === 'CHANNEL_POSTS' || normTarget === 'PROFILE') {
        return z.string().regex(UNIFIED_REGEX.TELEGRAM.CHANNEL, "Укажите ссылку на канал или чат Telegram (например, https://t.me/durov)");
      }
      if (normTarget === 'POST' || normTarget === 'PRIVATE_POST') {
        if (isPrivate) {
          return z.string().regex(
            UNIFIED_REGEX.TELEGRAM.PRIVATE_POST,
            "Укажите ссылку на пост Telegram (например, https://t.me/durov/123 или https://t.me/c/1234567890/123)"
          );
        }
        return z.string()
          .refine(val => !val.includes('/c/'), "Невозможно заказать услугу в закрытый чат (ссылка содержит /c/). Сделайте канал публичным.")
          .and(z.string().regex(UNIFIED_REGEX.TELEGRAM.POST, "Укажите ссылку на конкретный пост (например, https://t.me/durov/123)"));
      }
      if (normTarget === 'STORY') {
        return z.string().regex(UNIFIED_REGEX.TELEGRAM.STORY, "Укажите ссылку на историю Telegram (например, https://t.me/durov/s/1)");
      }
      if (normTarget === 'COMMENT') {
        return z.string().regex(UNIFIED_REGEX.TELEGRAM.COMMENT, "Укажите ссылку на комментарий в Telegram (например, https://t.me/durov/123?comment=456)");
      }
      if (normTarget === 'TELEGRAM_BOT' || normTarget === 'BOT') {
        return z.string().regex(UNIFIED_REGEX.TELEGRAM.BOT, "Укажите ссылку на Telegram-бота (например, https://t.me/my_bot или ?start=ref123)");
      }
      if (normTarget === 'POLL') {
        return z.string().regex(UNIFIED_REGEX.TELEGRAM.POLL, "Укажите ссылку на пост с опросом (например, https://t.me/durov/123)");
      }
      break;

    case 'VK':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.VK.POST, "Укажите ссылку на пост, фото, клип или видео ВКонтакте.");
      }
      if (normTarget === 'CHANNEL' || normTarget === 'PROFILE') {
        return z.string().regex(UNIFIED_REGEX.VK.CHANNEL, "Укажите прямую ссылку на группу или профиль ВКонтакте.");
      }
      if (normTarget === 'COMMENT') {
        return z.string().regex(UNIFIED_REGEX.VK.COMMENT, "Укажите ссылку на комментарий ВКонтакте (должна содержать параметр reply).");
      }
      if (normTarget === 'POLL') {
        return z.string().regex(UNIFIED_REGEX.VK.POLL, "Укажите ссылку на пост с опросом ВКонтакте.");
      }
      break;

    case 'INSTAGRAM':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.INSTAGRAM.POST, "Укажите ссылку на публикацию или Reel в Instagram.");
      }
      if (normTarget === 'CHANNEL' || normTarget === 'PROFILE') {
        return z.string().regex(UNIFIED_REGEX.INSTAGRAM.CHANNEL, "Укажите правильную ссылку на профиль Instagram.");
      }
      if (normTarget === 'STORY') {
        return z.string().regex(UNIFIED_REGEX.INSTAGRAM.STORY, "Укажите ссылку на историю или профиль Instagram.");
      }
      if (normTarget === 'COMMENT') {
        return z.string().regex(UNIFIED_REGEX.INSTAGRAM.COMMENT, "Укажите ссылку на комментарий Instagram.");
      }
      if (normTarget === 'POLL') {
        return z.string().regex(UNIFIED_REGEX.INSTAGRAM.POLL, "Укажите ссылку на профиль или историю Instagram с опросом.");
      }
      break;

    case 'TIKTOK':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.TIKTOK.POST, "Скопируйте ссылку на видео или фото из приложения TikTok.");
      }
      if (normTarget === 'CHANNEL' || normTarget === 'PROFILE') {
        return z.string().regex(UNIFIED_REGEX.TIKTOK.CHANNEL, "Укажите ссылку на профиль TikTok.");
      }
      break;

    case 'YOUTUBE':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.YOUTUBE.POST, "Укажите ссылку на YouTube видео, Shorts или стрим.");
      }
      if (normTarget === 'CHANNEL' || normTarget === 'PROFILE') {
        return z.string().regex(UNIFIED_REGEX.YOUTUBE.CHANNEL, "Укажите ссылку на канал YouTube.");
      }
      if (normTarget === 'COMMENT') {
        return z.string().regex(UNIFIED_REGEX.YOUTUBE.COMMENT, "Укажите ссылку на комментарий YouTube (с параметром &lc=).");
      }
      break;

    case 'RUTUBE':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.RUTUBE.POST, "Укажите ссылку на Rutube-видео или Shorts.");
      }
      if (normTarget === 'CHANNEL' || normTarget === 'PROFILE') {
        return z.string().regex(UNIFIED_REGEX.RUTUBE.CHANNEL, "Укажите ссылку на канал или профиль Rutube.");
      }
      break;

    case 'OK':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.OK.POST, "Укажите ссылку на тему или статус в Одноклассниках.");
      }
      if (normTarget === 'CHANNEL' || normTarget === 'PROFILE') {
        return z.string().regex(UNIFIED_REGEX.OK.CHANNEL, "Укажите прямую ссылку на группу или профиль в Одноклассниках.");
      }
      break;

    case 'TWITTER':
    case 'X':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.TWITTER.POST, "Укажите ссылку на твит/пост в Twitter / X.");
      }
      if (normTarget === 'CHANNEL' || normTarget === 'PROFILE') {
        return z.string().regex(UNIFIED_REGEX.TWITTER.CHANNEL, "Укажите ссылку на профиль Twitter / X.");
      }
      break;

    case 'THREADS':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.THREADS.POST, "Укажите ссылку на пост в Threads.");
      }
      if (normTarget === 'CHANNEL' || normTarget === 'PROFILE') {
        return z.string().regex(UNIFIED_REGEX.THREADS.CHANNEL, "Укажите ссылку на профиль Threads.");
      }
      break;

    case 'FACEBOOK':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.FACEBOOK.POST, "Укажите ссылку на публикацию или видео Facebook.");
      }
      if (normTarget === 'CHANNEL' || normTarget === 'PROFILE' || normTarget === 'GROUP') {
        return z.string().regex(UNIFIED_REGEX.FACEBOOK.CHANNEL, "Укажите ссылку на страницу, группу или профиль Facebook.");
      }
      break;

    case 'TWITCH':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.TWITCH.POST, "Укажите ссылку на запись трансляции (VOD) Twitch.");
      }
      if (normTarget === 'CHANNEL' || normTarget === 'PROFILE') {
        return z.string().regex(UNIFIED_REGEX.TWITCH.CHANNEL, "Укажите ссылку на Twitch-канал.");
      }
      break;

    case 'KICK':
      return z.string().regex(UNIFIED_REGEX.KICK.CHANNEL, "Укажите правильную ссылку на Kick-канал.");

    case 'SPOTIFY':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.SPOTIFY.POST, "Укажите ссылку на трек Spotify.");
      }
      return z.string().regex(UNIFIED_REGEX.SPOTIFY.CHANNEL, "Укажите ссылку на плейлист, альбом или артиста Spotify.");

    case 'MAX':
      return z.string().regex(UNIFIED_REGEX.MAX.CHANNEL, "Укажите ссылку на профиль или канал мессенджера МАКС.");

    case 'DZEN':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.DZEN.POST, "Укажите ссылку на публикацию или видео в Дзене.");
      }
      return z.string().regex(UNIFIED_REGEX.DZEN.CHANNEL, "Укажите ссылку на канал в Дзене.");

    case 'LIKEE':
      if (normTarget === 'POST') {
        return z.string().regex(UNIFIED_REGEX.LIKEE.POST, "Укажите ссылку на видео Likee.");
      }
      return z.string().regex(UNIFIED_REGEX.LIKEE.CHANNEL, "Укажите ссылку на профиль Likee.");

    case 'DISCORD':
      return z.string().regex(UNIFIED_REGEX.DISCORD.CHANNEL, "Укажите ссылку-приглашение на Discord сервер (discord.gg/...).");
  }

  // Universal Fallback validator
  return z.string().url("Укажите корректную ссылку (URL), начинающуюся с https://");
}

/**
 * Validates custom parameter inputs (e.g. comments list, numbers, text).
 */
export function getUnifiedCustomValidator(customDataType?: string | null): z.ZodType<string> {
  const type = (customDataType || 'NONE').toUpperCase();
  if (type === 'NUMBER') {
    return z.string().trim().regex(/^\d+$/, "Значение должно состоять только из цифр");
  }
  if (type === 'TEXTAREA') {
    return z.string().trim()
      .min(1, "Поле не может быть пустым")
      .max(10000, "Текст слишком длинный (максимум 10000 символов)")
      .refine(val => {
        for (let i = 0; i < val.length; i++) {
          const code = val.charCodeAt(i);
          // Disallow control characters: 0-8, 11-12, 14-31, 127 (keep 9=\t, 10=\n, 13=\r)
          if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
            return false;
          }
        }
        return true;
      }, "Текст содержит недопустимые управляющие символы");
  }
  return z.string().trim().min(1, "Поле не может быть пустым");
}

export interface LinkSpecificationDTO {
  targetType: string;
  placeholder: string;
  hint: string;
  regex?: string;
  clientRequirement?: string;
  requiresBotAdmin: boolean;
  isMediaGroupAware: boolean;
  customDataType: 'NONE' | 'TEXTAREA' | 'NUMBER';
  customDataLabel?: string;
}

/**
 * Generates declarative link placeholder, validation hint, and regex for catalog service import.
 * Single Source of Truth connecting provider catalog import to link engine rules (SIL-2026).
 */
export function getUnifiedLinkSpecification(
  platform: string,
  targetType: string,
  activityType: string = 'OTHER'
): LinkSpecificationDTO {
  const net = (platform || '').toLowerCase();
  const target = (targetType || '').toUpperCase();
  const act = (activityType || '').toUpperCase();

  // 1. Telegram
  if (net.includes('telegram') || net === 'tg') {
    if (target === 'PRIVATE_POST' || act.includes('PRIVATE_POST')) {
      return {
        targetType: 'PRIVATE_POST',
        placeholder: 'https://t.me/c/1234567890/1234',
        hint: 'Ссылка на публикацию в закрытом канале (формат t.me/c/...)',
        regex: '^https?:\\/\\/(?:t\\.me|telegram\\.me|telegram\\.dog)\\/(?:c\\/\\d+\\/|(?:s\\/)?[\\w-]+\\/)(?:topic\\/)?\\d+',
        clientRequirement: 'Бот или аккаунты сервиса должны состоять в данном закрытом канале',
        requiresBotAdmin: false,
        isMediaGroupAware: true,
        customDataType: 'NONE',
      };
    }
    if (target === 'CHANNEL' || act.includes('SUBSCRIBER') || act.includes('MEMBER') || act.includes('BOOST') || act.includes('GROUP')) {
      return {
        targetType: 'CHANNEL',
        placeholder: 'https://t.me/channel_name или https://t.me/+joinchat_hash',
        hint: 'Ссылка на публичный или закрытый Telegram канал/чат',
        regex: '^https?:\\/\\/(?:t\\.me|telegram\\.me|telegram\\.dog)\\/(?:joinchat\\/|\\+|s\\/|boost\\/)?(?:c\\/\\d+|@?[\\w-]+)',
        clientRequirement: 'Канал/группа должны быть доступны (если закрытый — ссылка с + или joinchat)',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NONE',
      };
    }
    if (target === 'STORY' || act.includes('STOR')) {
      return {
        targetType: 'STORY',
        placeholder: 'https://t.me/channel_name/s/12',
        hint: 'Ссылка на историю Telegram канала (действует 24–48 часов)',
        regex: '^https?:\\/\\/(?:t\\.me|telegram\\.me|telegram\\.dog)\\/[\\w-]+\\/s\\/\\d+',
        clientRequirement: 'История должна быть активна на момент запуска заказа',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NONE',
      };
    }
    if (target === 'POLL' || act.includes('POLL') || act.includes('VOTE')) {
      return {
        targetType: 'POLL',
        placeholder: 'https://t.me/channel_name/1234',
        hint: 'Ссылка на публикацию с опросом в Telegram (укажите номер варианта)',
        regex: '^https?:\\/\\/(?:t\\.me|telegram\\.me|telegram\\.dog)\\/(?:s\\/)?[\\w-]+\\/(?:topic\\/)?\\d+',
        clientRequirement: 'Опрос должен быть открытым для голосования',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NUMBER',
        customDataLabel: 'Номер варианта ответа (например: 1, 2 или 3)',
      };
    }
    if (target === 'COMMENT' || target === 'COMMENTS' || act.includes('COMMENT')) {
      return {
        targetType: 'COMMENTS',
        placeholder: 'https://t.me/channel_name/1234',
        hint: 'Ссылка на пост в Telegram для публикации комментариев',
        regex: '^https?:\\/\\/(?:t\\.me|telegram\\.me|telegram\\.dog)\\/(?:s\\/)?[\\w-]+\\/(?:topic\\/)?\\d+',
        clientRequirement: 'В канале должны быть включены комментарии/обсуждения',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'TEXTAREA',
        customDataLabel: 'Текст комментариев (каждый комментарий с новой строки)',
      };
    }
    if (target === 'BOT' || act.includes('BOT') || act.includes('REFERRAL')) {
      return {
        targetType: 'BOT',
        placeholder: 'https://t.me/my_bot или https://t.me/my_bot?start=ref123',
        hint: 'Ссылка на Telegram-бота (с реферальным кодом при необходимости)',
        regex: '^https?:\\/\\/(?:t\\.me|telegram\\.me|telegram\\.dog)\\/[\\w-]+_bot',
        clientRequirement: 'Бот должен быть активен и принимать команду /start',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NONE',
      };
    }
    return {
      targetType: 'POST',
      placeholder: 'https://t.me/channel_name/1234',
      hint: 'Прямая ссылка на пост или публикацию в Telegram',
      regex: '^https?:\\/\\/(?:t\\.me|telegram\\.me|telegram\\.dog)\\/(?:s\\/)?[\\w-]+\\/(?:topic\\/)?\\d+',
      clientRequirement: 'Пост должен быть опубликован в открытом канале/группе',
      requiresBotAdmin: false,
      isMediaGroupAware: true,
      customDataType: 'NONE',
    };
  }

  // 2. VKontakte
  if (net.includes('vk') || net === 'vkontakte') {
    if (target === 'PROFILE' || target === 'CHANNEL' || act.includes('SUBSCRIBER') || act.includes('FRIEND') || act.includes('GROUP')) {
      return {
        targetType: target === 'PROFILE' ? 'PROFILE' : 'CHANNEL',
        placeholder: 'https://vk.com/username или https://vk.com/public12345',
        hint: 'Ссылка на страницу, группу или паблик ВКонтакте',
        regex: '^https?:\\/\\/(?:m\\.)?vk\\.(?:com|ru)\\/(?:public\\d+|club\\d+|id\\d+|[a-zA-Z0-9_.]+)',
        clientRequirement: 'Профиль или сообщество должны быть открыты для всех',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NONE',
      };
    }
    return {
      targetType: target === 'VIDEO' ? 'VIDEO' : 'POST',
      placeholder: 'https://vk.com/wall-12345_67890 или https://vk.com/video-12345_67890',
      hint: 'Ссылка на конкретную запись, видео или клип ВКонтакте',
      regex: '^https?:\\/\\/(?:m\\.)?(?:vk\\.(?:com|ru)|vkvideo\\.ru)\\/(?:wall|video|clip|photo)-?\\d+_\\d+',
      clientRequirement: 'Запись должна быть публичной',
      requiresBotAdmin: false,
      isMediaGroupAware: false,
      customDataType: 'NONE',
    };
  }

  // 3. YouTube
  if (net.includes('youtube') || net === 'yt') {
    if (target === 'CHANNEL' || act.includes('SUBSCRIBER')) {
      return {
        targetType: 'CHANNEL',
        placeholder: 'https://youtube.com/@channel_name',
        hint: 'Ссылка на YouTube-канал (формат @handle или channel/UC...)',
        regex: '^https?:\\/\\/(?:www\\.|m\\.)?youtube\\.com\\/(@[a-zA-Z0-9_.-]+|channel\\/UC[a-zA-Z0-9_.-]+)',
        clientRequirement: 'Канал должен быть открыт для отображения подписчиков',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NONE',
      };
    }
    return {
      targetType: 'VIDEO',
      placeholder: 'https://youtube.com/watch?v=dQw4w9WgXcQ или https://youtube.com/shorts/dQw4w9WgXcQ',
      hint: 'Ссылка на видео, Shorts или трансляцию YouTube',
      regex: '^https?:\\/\\/(?:www\\.|m\\.)?(?:youtube\\.com\\/(?:watch\\?.*v=|shorts\\/|live\\/|embed\\/)|youtu\\.be\\/)[a-zA-Z0-9_-]+',
      clientRequirement: 'Видео должно быть доступно по открытой ссылке',
      requiresBotAdmin: false,
      isMediaGroupAware: false,
      customDataType: 'NONE',
    };
  }

  // 4. Instagram
  if (net.includes('instagram') || net === 'inst' || net === 'ig') {
    if (target === 'PROFILE' || target === 'CHANNEL' || act.includes('SUBSCRIBER')) {
      return {
        targetType: 'PROFILE',
        placeholder: 'https://instagram.com/username',
        hint: 'Ссылка на профиль Instagram',
        regex: '^https?:\\/\\/(?:www\\.|m\\.)?instagram\\.com\\/@?[a-zA-Z0-9_.]+',
        clientRequirement: 'Профиль Instagram должен быть открытым (не приватным)',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NONE',
      };
    }
    if (target === 'STORY' || act.includes('STOR')) {
      return {
        targetType: 'STORY',
        placeholder: 'https://instagram.com/stories/username/1234567890/',
        hint: 'Ссылка на историю Instagram',
        regex: '^https?:\\/\\/(?:www\\.|m\\.)?instagram\\.com\\/stories\\/[a-zA-Z0-9_.]+\\/\\d+',
        clientRequirement: 'История должна быть активна (24 часа с момента публикации)',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NONE',
      };
    }
    return {
      targetType: 'POST',
      placeholder: 'https://instagram.com/p/CODE/ или https://instagram.com/reel/CODE/',
      hint: 'Ссылка на публикацию или Reels в Instagram',
      regex: '^https?:\\/\\/(?:www\\.|m\\.)?instagram\\.com\\/(?:p|reel|reels|tv|share\\/[a-zA-Z0-9_-]+)\\/[a-zA-Z0-9_-]+',
      clientRequirement: 'Публикация должна быть в открытом профиле',
      requiresBotAdmin: false,
      isMediaGroupAware: false,
      customDataType: 'NONE',
    };
  }

  // 5. TikTok
  if (net.includes('tiktok') || net === 'tt') {
    if (target === 'PROFILE' || target === 'CHANNEL' || act.includes('SUBSCRIBER')) {
      return {
        targetType: 'PROFILE',
        placeholder: 'https://tiktok.com/@username',
        hint: 'Ссылка на профиль TikTok',
        regex: '^https?:\\/\\/(?:www\\.|m\\.)?tiktok\\.com\\/@?[a-zA-Z0-9_.]+',
        clientRequirement: 'Аккаунт TikTok должен быть открыт',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NONE',
      };
    }
    return {
      targetType: 'VIDEO',
      placeholder: 'https://tiktok.com/@user/video/1234567890 или https://vm.tiktok.com/CODE',
      hint: 'Ссылка на видео в TikTok',
      regex: '^https?:\\/\\/(?:www\\.|m\\.)?tiktok\\.com\\/@[a-zA-Z0-9_.]+\\/(?:video|photo)\\/\\d+|^https?:\\/\\/(?:vm|vt)\\.tiktok\\.com\\/[a-zA-Z0-9_]+',
      clientRequirement: 'Видео должно быть общедоступным',
      requiresBotAdmin: false,
      isMediaGroupAware: false,
      customDataType: 'NONE',
    };
  }

  // 6. Rutube
  if (net.includes('rutube')) {
    if (target === 'CHANNEL' || act.includes('SUBSCRIBER')) {
      return {
        targetType: 'CHANNEL',
        placeholder: 'https://rutube.ru/channel/123456/ или https://rutube.ru/u/channel_name/',
        hint: 'Ссылка на канал Rutube',
        regex: '^https?:\\/\\/(?:www\\.)?rutube\\.ru\\/(?:channel\\/\\d+|u\\/[a-zA-Z0-9_.-]+)',
        clientRequirement: 'Канал Rutube должен быть открыт',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NONE',
      };
    }
    return {
      targetType: 'VIDEO',
      placeholder: 'https://rutube.ru/video/CODE32/ или https://rutube.ru/shorts/CODE32/',
      hint: 'Ссылка на видеозапись или Shorts в Rutube',
      regex: '^https?:\\/\\/(?:www\\.)?rutube\\.ru\\/(?:video|shorts|play\\/embed)\\/[a-zA-Z0-9_-]+',
      clientRequirement: 'Видео должно быть доступно по прямой ссылке',
      requiresBotAdmin: false,
      isMediaGroupAware: false,
      customDataType: 'NONE',
    };
  }

  // 7. Dzen
  if (net.includes('dzen') || net.includes('zen')) {
    if (target === 'CHANNEL' || act.includes('SUBSCRIBER')) {
      return {
        targetType: 'CHANNEL',
        placeholder: 'https://dzen.ru/channel_name или https://dzen.ru/id/12345',
        hint: 'Ссылка на канал в Дзене',
        regex: '^https?:\\/\\/(?:www\\.)?(?:dzen\\.ru|zen\\.yandex\\.ru)\\/(?:id\\/[a-zA-Z0-9_-]+|channel\\/[a-zA-Z0-9_-]+|@?[a-zA-Z0-9_.-]+)',
        clientRequirement: 'Канал должен быть опубликован',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NONE',
      };
    }
    return {
      targetType: 'POST',
      placeholder: 'https://dzen.ru/a/CODE или https://dzen.ru/video/watch/CODE',
      hint: 'Ссылка на публикацию или видео в Дзене',
      regex: '^https?:\\/\\/(?:www\\.)?(?:dzen\\.ru|zen\\.yandex\\.ru)\\/(?:a\\/|b\\/|shorts\\/|video\\/watch\\/|media\\/)[a-zA-Z0-9_-]+',
      clientRequirement: 'Публикация должна быть открыта',
      requiresBotAdmin: false,
      isMediaGroupAware: false,
      customDataType: 'NONE',
    };
  }

  // 8. Likee
  if (net.includes('likee')) {
    if (target === 'PROFILE' || target === 'CHANNEL' || act.includes('SUBSCRIBER')) {
      return {
        targetType: 'PROFILE',
        placeholder: 'https://likee.video/@username или https://l.likee.video/p/CODE',
        hint: 'Ссылка на профиль в Likee',
        regex: '^https?:\\/\\/(?:l\\.likee\\.video\\/p\\/[\\w-]+|(?:likee\\.video|likee\\.com)\\/@[\\w.]+)',
        clientRequirement: 'Профиль должен быть общедоступным',
        requiresBotAdmin: false,
        isMediaGroupAware: false,
        customDataType: 'NONE',
      };
    }
    return {
      targetType: 'VIDEO',
      placeholder: 'https://likee.video/@user/video/12345 или https://l.likee.video/v/CODE',
      hint: 'Ссылка на видео в Likee',
      regex: '^https?:\\/\\/(?:l\\.likee\\.video\\/v\\/[\\w-]+|(?:likee\\.video|likee\\.com)\\/@[\\w.]+\\/video\\/\\d+)',
      clientRequirement: 'Видео должно быть открыто',
      requiresBotAdmin: false,
      isMediaGroupAware: false,
      customDataType: 'NONE',
    };
  }

  // 9. Discord
  if (net.includes('discord')) {
    return {
      targetType: 'CHANNEL',
      placeholder: 'https://discord.gg/invite_code',
      hint: 'Бессрочная ссылка-приглашение на Discord-сервер',
      regex: '^https?:\\/\\/(?:www\\.)?(?:discord\\.gg|discord\\.com\\/invite)\\/[a-zA-Z0-9_-]+',
      clientRequirement: 'Ссылка-приглашение должна быть активна и без лимита использований',
      requiresBotAdmin: false,
      isMediaGroupAware: false,
      customDataType: 'NONE',
    };
  }

  // Universal Fallback
  return {
    targetType: target || 'POST',
    placeholder: 'https://...',
    hint: 'Вставьте прямую публичную ссылку на объект продвижения',
    regex: '^https?:\\/\\/.+',
    clientRequirement: 'Объект продвижения должен быть общедоступным',
    requiresBotAdmin: false,
    isMediaGroupAware: false,
    customDataType: 'NONE',
  };
}

