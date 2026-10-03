import { IntelligencePlatform, LINK_RULES } from '../analyzer/link-rules';
import { IntelligenceLinkAnalyzer, IntelligenceAnalysisResult, LinkAnalysisErrorCode } from '../analyzer/link-analyzer';
import { resolvePlatformByHostname } from './link-domain-router';
import { canonicalizeUrl } from './link-canonicalizer';
import { getUnifiedLinkValidator, getUnifiedCustomValidator } from './link-rules-registry';
import { resolveServiceTargetType, TargetTypeEnum, normalizeTargetType } from '@/utils/target-type';
import { isLinkServiceCompatible, getCompatibilityError, normalizeServiceTargetType } from '@/constants/link-service-compatibility';
import { isUrlSafeForFetch } from '@/lib/ssrf-guard';
import { validateProhibitedContent } from '@/validators/prohibited-content';
import { z } from 'zod';

export interface UnifiedValidationResult {
  isValid: boolean;
  canonicalUrl: string;
  platform: IntelligencePlatform;
  linkType: string;
  error?: string;
  errorCode?: LinkAnalysisErrorCode | 'INCOMPATIBLE_TARGET_TYPE' | 'SECURITY_BLOCKED' | 'PROHIBITED_CONTENT';
  userHint?: string;
}

export interface BatchItemInput {
  link: string;
  service?: {
    id?: string;
    numericId?: number;
    name?: string;
    targetType?: string | null;
    customDataType?: string | null;
    category?: {
      name?: string | null;
      network?: { slug?: string | null } | null;
    } | null;
  } | null;
  customData?: string | null;
}

export interface BatchItemResult {
  lineIndex: number;
  link: string;
  isValid: boolean;
  canonicalUrl: string;
  error?: string;
}

export function normalizePlatformSlug(slug: string | null | undefined): string {
  if (!slug) return '';
  const s = slug.trim().toUpperCase();
  if (s === 'TG' || s === 'TELEGRAM') return 'TELEGRAM';
  if (s === 'VK' || s === 'VKONTAKTE') return 'VK';
  if (s === 'IG' || s === 'INSTA' || s === 'INSTAGRAM') return 'INSTAGRAM';
  if (s === 'YT' || s === 'YOUTUBE') return 'YOUTUBE';
  if (s === 'TT' || s === 'TIKTOK') return 'TIKTOK';
  if (s === 'TW' || s === 'X' || s === 'TWITTER') return 'TWITTER';
  if (s === 'OK' || s === 'ODNOKLASSNIKI') return 'OK';
  if (s === 'FB' || s === 'FACEBOOK') return 'FACEBOOK';
  if (s === 'TH' || s === 'THREADS') return 'THREADS';
  return s;
}

class UnifiedLinkEngineImpl {
  private analyzer = new IntelligenceLinkAnalyzer();
  private cache = new Map<string, { result: IntelligenceAnalysisResult; expiresAt: number }>();
  private readonly MAX_CACHE_SIZE = 2000;
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  /**
   * Fast In-Memory Analysis with LRU Caching and Security Guard.
   */
  async analyze(rawUrl: string): Promise<IntelligenceAnalysisResult> {
    if (!rawUrl || rawUrl.trim() === '') {
      return {
        platform: IntelligencePlatform.OTHER,
        type: 'unknown',
        id: 'unknown',
        canonicalUrl: '',
        metadata: {},
        suggestedCategories: [],
        warnings: ['empty_input'],
        errorCode: 'EMPTY_INPUT',
        userHint: 'Введите ссылку на объект продвижения'
      };
    }

    const trimmed = rawUrl.trim();

    // Check cache
    const cached = this.cache.get(trimmed);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        return cached.result;
      }
      this.cache.delete(trimmed);
    }

    // Run underlying intelligence analyzer
    const analysis = await this.analyzer.analyze(trimmed);

    // Save to LRU cache
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(trimmed, { result: analysis, expiresAt: Date.now() + this.CACHE_TTL_MS });

    return analysis;
  }

  /**
   * End-to-End Validation & Mutation for a specific service.
   * Enforces SSRF guard, prohibited content check, canonical mutation,
   * Zod regex schema validation, and semantic targetType compatibility.
   */
  async validateForService(
    rawUrl: string,
    service: {
      id?: string;
      name?: string;
      targetType?: string | null;
      customDataType?: string | null;
      category?: {
        name?: string | null;
        network?: { slug?: string | null } | null;
      } | null;
    },
    customData?: string | null
  ): Promise<UnifiedValidationResult> {
    if (!rawUrl || !rawUrl.trim()) {
      return {
        isValid: false,
        canonicalUrl: '',
        platform: IntelligencePlatform.OTHER,
        linkType: 'unknown',
        error: 'Ссылка не может быть пустой',
        errorCode: 'EMPTY_INPUT'
      };
    }

    const trimmed = rawUrl.trim();

    // 1. Length Guard
    if (trimmed.length > 2048) {
      return {
        isValid: false,
        canonicalUrl: '',
        platform: IntelligencePlatform.OTHER,
        linkType: 'unknown',
        error: 'Длина ссылки превышает допустимый лимит (2048 символов)'
      };
    }

    // 2. Resolve Service Semantic TargetType (Zero False-Incompatibility Rule 4.1)
    const resolvedTargetTypeStr = resolveServiceTargetType(service);
    const resolvedTargetType = normalizeTargetType(
      resolvedTargetTypeStr || (service.category?.name ? service.category.name : 'ANY')
    );
    const serviceTargetType = normalizeServiceTargetType(resolvedTargetType);

    // 3. Custom / Non-Link target types
    if (resolvedTargetType === TargetTypeEnum.CUSTOM || resolvedTargetTypeStr === 'CUSTOM') {
      const customValidator = getUnifiedCustomValidator(service.customDataType);
      const customVal = customData || trimmed;
      const customParsed = customValidator.safeParse(customVal);
      if (!customParsed.success) {
        return {
          isValid: false,
          canonicalUrl: trimmed,
          platform: IntelligencePlatform.OTHER,
          linkType: 'custom',
          error: customParsed.error.errors[0].message
        };
      }
      return {
        isValid: true,
        canonicalUrl: trimmed,
        platform: IntelligencePlatform.OTHER,
        linkType: 'custom'
      };
    }

    // 4. Intelligence Analysis
    const analysis = await this.analyze(trimmed);
    if (analysis.errorCode) {
      return {
        isValid: false,
        canonicalUrl: trimmed,
        platform: analysis.platform,
        linkType: analysis.type,
        error: analysis.userHint || 'Некорректный формат ссылки',
        errorCode: analysis.errorCode,
        userHint: analysis.userHint
      };
    }

    // 5. SSRF Security Guard
    const canonicalLink = canonicalizeUrl(trimmed, analysis.platform, resolvedTargetType);
    if (!isUrlSafeForFetch(canonicalLink)) {
      return {
        isValid: false,
        canonicalUrl: canonicalLink,
        platform: analysis.platform,
        linkType: analysis.type,
        error: 'Указанный адрес заблокирован политикой сетевой безопасности',
        errorCode: 'SECURITY_BLOCKED'
      };
    }

    // 6. Prohibited Content Check
    const prohibitedCheck = validateProhibitedContent(canonicalLink, customData || undefined);
    if (!prohibitedCheck.isAllowed) {
      return {
        isValid: false,
        canonicalUrl: canonicalLink,
        platform: analysis.platform,
        linkType: analysis.type,
        error: prohibitedCheck.error || 'Продвижение данного контента запрещено правилами сервиса',
        errorCode: 'PROHIBITED_CONTENT'
      };
    }

    // 7. Platform Cross-Mismatch Check
    const rawPlatformSlug = service.category?.network?.slug;
    const servicePlatformSlug = normalizePlatformSlug(rawPlatformSlug);
    const detectedPlatform = normalizePlatformSlug(analysis.platform);
    if (servicePlatformSlug && detectedPlatform && detectedPlatform !== 'OTHER') {
      if (detectedPlatform !== servicePlatformSlug) {
        return {
          isValid: false,
          canonicalUrl: canonicalLink,
          platform: analysis.platform,
          linkType: analysis.type,
          error: `Указана ссылка для ${analysis.platform}, но выбранная услуга предназначена для ${servicePlatformSlug}`
        };
      }
    }

    // 8. Semantic Link/Service TargetType Compatibility Check
    if (!isLinkServiceCompatible(analysis.type, serviceTargetType)) {
      const compatError = getCompatibilityError(analysis.type, serviceTargetType, service.name || '');
      return {
        isValid: false,
        canonicalUrl: canonicalLink,
        platform: analysis.platform,
        linkType: analysis.type,
        error: compatError,
        errorCode: 'INCOMPATIBLE_TARGET_TYPE'
      };
    }

    // 9. Strict Zod Schema Format Validation
    const isPrivate = (service as { isPrivate?: boolean }).isPrivate === true || (service as { targetType?: string }).targetType === 'PRIVATE_POST' || resolvedTargetTypeStr === 'PRIVATE_POST';
    const schemaValidator = getUnifiedLinkValidator(analysis.platform, resolvedTargetType, { isPrivate });
    const parsed = schemaValidator.safeParse(canonicalLink);
    if (!parsed.success) {
      return {
        isValid: false,
        canonicalUrl: canonicalLink,
        platform: analysis.platform,
        linkType: analysis.type,
        error: parsed.error.errors[0].message
      };
    }

    return {
      isValid: true,
      canonicalUrl: canonicalLink,
      platform: analysis.platform,
      linkType: analysis.type
    };
  }

  /**
   * Fast canonical mutation according to platform and targetType rules.
   */
  mutate(rawUrl: string, platform?: string | null, targetType?: string | null): string {
    const normPlatform = platform ? (resolvePlatformByHostname(platform) || (platform as IntelligencePlatform)) : null;
    return canonicalizeUrl(rawUrl, normPlatform, targetType);
  }

  /**
   * High-throughput batch validation for mass orders and API v2 bulk endpoints.
   */
  async validateBatch(items: BatchItemInput[]): Promise<BatchItemResult[]> {
    const results: BatchItemResult[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.service) {
        results.push({
          lineIndex: i,
          link: item.link,
          isValid: false,
          canonicalUrl: item.link,
          error: 'Услуга не указана или не найдена'
        });
        continue;
      }
      const val = await this.validateForService(item.link, item.service, item.customData);
      results.push({
        lineIndex: i,
        link: item.link,
        isValid: val.isValid,
        canonicalUrl: val.canonicalUrl,
        error: val.error
      });
    }
    return results;
  }
}

export const unifiedLinkEngine = new UnifiedLinkEngineImpl();
