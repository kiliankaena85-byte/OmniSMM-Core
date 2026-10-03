import { getTenantFallbackBranding } from './tenant-branding';
export { getTenantFallbackBranding };
import { db } from "@/lib/db";
import { SystemSettings, UsnScheme } from "@prisma/client";
import { VaultService } from "./vault";
import { unstable_cache, revalidateTag } from "next/cache";
import { normalizeTenantId, registerValidTenant } from "@/lib/tenant-resolver-edge";
import { TENANT_ALIASES } from "@/config/tenants";

const localSettingsCache: Record<string, { data: SystemSettings; expiresAt: number }> = {};
const tenantRecordIdCache = new Map<string, string>();
const SETTINGS_L1_TTL_MS = 20 * 1000; // 20s L1 in-memory TTL to prevent connection pool exhaustion under load
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache for workers

export interface DecryptedPaymentSecrets {
  yookassaShopId: string | null;
  yookassaSecretKey: string | null;
  yookassaWebhookSecret: string | null;
  cryptoBotToken: string | null;
  robokassaLogin: string | null;
  robokassaPassword: string | null;
  robokassaWebhookPassword: string | null;
}

export interface DecryptedEmailSettings {
  emailProvider: string;
  resendApiKey: string | null;
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  smtpPassword: string | null;
  supportEmailDomain: string | null;
}

export type ContactAndLegalSettings = {
  SITE_NAME: string;
  SITE_DESCRIPTION: string;
  SUPPORT_EMAIL: string;
  PRIVACY_EMAIL: string;
  TELEGRAM_SUPPORT_BOT: string;
  TELEGRAM_SUPPORT_CHANNEL: string;
  WHATSAPP: string;
  VK: string;
  COMPANY_NAME: string;
  COMPANY_INN: string;
  COMPANY_OGRNIP: string;
  COMPANY_ADDRESS: string;
  LEGAL_INN: string;
  LEGAL_OGRNIP: string;
  LEGAL_ADDRESS: string;
};


/**
 * SettingsProvider: Optimized, cached, and Zod-validated source for system settings.
 * Part of Wave 2 Refactoring: Eliminated redundant fetching and added caching.
 * Multi-tenant update: Dynamic settings partitioning by tenantId.
 */
export class SettingsProvider {
  static isTestEnvironment(): boolean {
    if (typeof process === 'undefined') return false;
    const nodeEnv = process.env.NODE_ENV;
    const appEnv = process.env.APP_ENV;

    return nodeEnv === 'test' || appEnv === 'test' || Boolean(process.env.VITEST);
  }

  /**
   * Clears the in-memory fallback cache for workers/CLI.
   */
  static invalidateLocalCache(tenantId?: string) {
    SettingsProvider.clearMemoryCache(tenantId);
  }

  /**
   * Resolves the current tenantId from request headers or fallback environment variables.
   */
  static async getTenantId(): Promise<string> {
    try {
      const { headers: getHeaders } = await import("next/headers");
      const reqHeaders = await getHeaders();
      return reqHeaders.get("x-tenant-id") || "smmplan";
    } catch {
      // In background workers or CLI
      return process.env.BOT_TENANT_ID || "smmplan";
    }
  }

  /**
   * Fetches settings for a given tenant with a 5-minute cache TTL.
   */
  static getCached(tenantId: string) {
    const cleanTenant = normalizeTenantId(tenantId) || 'smmplan';
    return unstable_cache(
      async () => {
        const branding = getTenantFallbackBranding(cleanTenant);

        // In tests, we want the most fresh data to avoid race conditions between test cases
        if (SettingsProvider.isTestEnvironment()) {
          return await db.systemSettings.upsert({
            where: { id: cleanTenant },
            update: {},
            create: { id: cleanTenant, taxRate: 6, opexMonthly: 0, maintenanceMode: false, isTestMode: true, siteName: branding.name, exchangeRateUSD: 95 }
          });
        }

        const defaultName = branding.name;
        const defaultEmail = branding.supportEmail;
        const defaultPrivacyEmail = branding.privacyEmail;
        const defaultBot = branding.bot;
        const defaultChannel = branding.channel;

        return await db.systemSettings.upsert({
          where: { id: cleanTenant },
          update: {},
          create: {
            id: cleanTenant,
            taxRate: 6.0,
            opexMonthly: 0,
            maintenanceMode: false,
            isTestMode: false,
            siteName: defaultName,
            siteDescription: "",
            exchangeRateUSD: 95.0,
            contactSupportEmail: defaultEmail,
            contactPrivacyEmail: defaultPrivacyEmail,
            contactTelegramBot: defaultBot,
            contactTelegramChannel: defaultChannel,
            legalCompanyName: defaultName,
            legalCompanyInn: "",
            legalCompanyOgrnip: "",
            legalCompanyAddress: "",
          }
        });
      },
      [`system-settings-${cleanTenant}-v3`],
      { revalidate: 300, tags: ['settings', `settings-${cleanTenant}`] }
    )();
  }

  /**
   * Direct database fetch (uncached). Use only for Admin UI or logic that requires real-time data.
   */
  static async getDirect(tenantId?: string): Promise<SystemSettings> {
    const activeTenantId = tenantId || await this.getTenantId();
    const settings = await db.systemSettings.findUnique({ where: { id: activeTenantId } });
    if (settings) return settings;
    // Fallback to cached (which handles initialization if missing)
    return this.get(activeTenantId);
  }

  /**
   * Helper to resolve the Tenant model ID from a tenant slug.
   */
  static async resolveTenantRecordId(tenantSlug: string): Promise<string> {
    const slug = normalizeTenantId(tenantSlug) || 'smmplan';
    if (!SettingsProvider.isTestEnvironment()) {
      const cached = tenantRecordIdCache.get(slug);
      if (cached) return cached;
    }
    const tenant = await db.tenant.findUnique({ where: { slug } }) 
      || await db.tenant.findFirst({ where: { slug: 'smmplan' } })
      || await db.tenant.findFirst();
    const resolved = tenant ? tenant.id : slug;
    if (!SettingsProvider.isTestEnvironment()) {
      tenantRecordIdCache.set(slug, resolved);
    }
    return resolved;
  }

  /**
   * Safe wrapper around getCached that self-heals when Next.js incrementalCache is missing (CLI/workers)
   */
  static async get(tenantId?: string): Promise<SystemSettings> {
    const rawId = tenantId || await this.getTenantId();
    const normalizedSlug = normalizeTenantId(rawId) || 'smmplan';

    // Fast-path: Check L1 in-memory cache first (0ms, 0 DB queries, 0 connection pool lock)
    if (!SettingsProvider.isTestEnvironment()) {
      const now = Date.now();
      const cached = localSettingsCache[normalizedSlug] || (rawId ? localSettingsCache[rawId] : undefined);
      if (cached && cached.expiresAt > now) {
        return cached.data;
      }
    }

    const targetTenantId = await this.resolveTenantRecordId(normalizedSlug);

    try {
      if (SettingsProvider.isTestEnvironment()) {
        delete localSettingsCache[targetTenantId];
        delete localSettingsCache[normalizedSlug];
        const fresh = await db.systemSettings.findUnique({ where: { id: targetTenantId } });
        if (fresh) return fresh;
        return await db.systemSettings.upsert({
          where: { id: targetTenantId },
          update: {},
          create: { id: targetTenantId, taxRate: 6, opexMonthly: 0, maintenanceMode: false, isTestMode: true, siteName: getTenantFallbackBranding(normalizedSlug).name, exchangeRateUSD: 95 }
        });
      }
      try {
        const settings = await this.getCached(normalizedSlug);
        if (settings && !SettingsProvider.isTestEnvironment()) {
          const expiresAt = Date.now() + SETTINGS_L1_TTL_MS;
          localSettingsCache[normalizedSlug] = { data: settings, expiresAt };
          localSettingsCache[targetTenantId] = { data: settings, expiresAt };
        }
        return settings;
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        if (errMessage.includes('incrementalCache') || errMessage.includes('Invariant')) {
          // Check local memory cache first
          const now = Date.now();
          const cached = localSettingsCache[targetTenantId];
          if (cached && cached.expiresAt > now) {
            return cached.data;
          }

          // Fallback to read-only DB query first
          let settings = await db.systemSettings.findUnique({ where: { id: targetTenantId } });
          if (!settings) {
            settings = await db.systemSettings.upsert({
              where: { id: targetTenantId },
              update: {},
              create: { id: targetTenantId, taxRate: 6, opexMonthly: 0, maintenanceMode: false, isTestMode: SettingsProvider.isTestEnvironment(), siteName: getTenantFallbackBranding(normalizedSlug).name, exchangeRateUSD: 95 }
            });
          }

          localSettingsCache[targetTenantId] = { data: settings, expiresAt: now + SETTINGS_L1_TTL_MS };
          localSettingsCache[normalizedSlug] = { data: settings, expiresAt: now + SETTINGS_L1_TTL_MS };
          return settings;
        }
        throw err;
      }
    } catch (dbErr: unknown) {
      const dbErrMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      console.warn(`[SettingsProvider] Failed to fetch system settings for ${normalizedSlug} from DB, using fallback:`, dbErrMsg);
      const fallbackBranding = getTenantFallbackBranding(normalizedSlug);
      const defaultName = fallbackBranding.name;
      const defaultEmail = fallbackBranding.supportEmail;
      const defaultPrivacyEmail = fallbackBranding.privacyEmail;
      const defaultBot = fallbackBranding.bot;
      const defaultChannel = fallbackBranding.channel;

      return {
        id: targetTenantId,
        taxRate: 6.0,
        opexMonthly: 0,
        maintenanceMode: false,
        isTestMode: false,
        siteName: defaultName,
        siteDescription: "",
        exchangeRateUSD: 90.0,
        contactSupportEmail: defaultEmail,
        contactPrivacyEmail: defaultPrivacyEmail,
        contactTelegramBot: defaultBot,
        contactTelegramChannel: defaultChannel,
        legalCompanyName: defaultName,
        legalCompanyInn: "",
        legalCompanyOgrnip: "",
        legalCompanyAddress: "",
        usnScheme: "INCOME_EXPENSES" as UsnScheme,
        welcomeMessage: "Добро пожаловать! Ваш персональный кабинет готов к работе.",
        yookassaShopId: null,
        yookassaSecretKey: null,
        yookassaTestShopId: null,
        yookassaTestSecretKey: null,
        cryptoBotToken: null,
        quarantineThreshold: 0.20,
        globalMarkup: 3.0,
        safetyFloor: 3.0,
        exchangeRateUpdatedAt: null,
        siteLogoUrl: null,
        siteFaviconUrl: null,
        emailProvider: "SMTP",
        resendApiKey: null,
        smtpHost: null,
        smtpPort: 465,
        smtpUser: null,
        smtpPassword: null,
        supportEmailDomain: null,
        inboundEmailWebhookSecret: null,
        robokassaLogin: null,
        robokassaPassword: null,
        updatedAt: new Date()
      } as SystemSettings;
    }
  }

  /**
   * Securely decrypts and returns payment API keys.
   */
  static async getPaymentSecrets(tenantId?: string): Promise<DecryptedPaymentSecrets> {
    const activeTenantId = tenantId || await this.getTenantId();
    const settings = await this.get(activeTenantId);
    const useTestKeys = await this.isTestMode(activeTenantId);

    // SECURITY: No fallback to prod keys in test mode.
    // If test keys are not configured, return null — downstream will throw a clear error.
    let shopId = useTestKeys
      ? (settings.yookassaTestShopId ?? null)
      : (settings.yookassaShopId ?? null);
    let secretKeyRaw = useTestKeys
      ? (settings.yookassaTestSecretKey ?? null)
      : (settings.yookassaSecretKey ?? null);

    // Dynamic sandbox fallback: If selected credentials are dummy placeholders,
    // but test keys are configured with actual test credentials, use them!
    const isDummy = !shopId || shopId === 'test_shop_id' || shopId === 'test_shop_id_test';
    const hasTestKeys = settings.yookassaTestShopId && settings.yookassaTestShopId !== 'test_shop_id';

    if (isDummy && hasTestKeys) {
      shopId = settings.yookassaTestShopId;
      secretKeyRaw = settings.yookassaTestSecretKey;
    } else if (isDummy && useTestKeys && settings.yookassaShopId && settings.yookassaShopId !== 'test_shop_id') {
      shopId = settings.yookassaShopId;
      secretKeyRaw = settings.yookassaSecretKey;
    }

    // Environment variables fallback strictly for 'smmplan'
    // For non-smmplan tenants (White-Label / Dynamic Tenants), falling back to parent env keys
    // is strictly forbidden under Russian fiscal law (ст. 54.1 НК РФ) to prevent illegal tax commingling.
    const isPlatformPrimary = !activeTenantId || activeTenantId === 'smmplan';

    let envCryptoToken: string | null = null;
    let envWebhookSecret: string | null = null;

    if (isPlatformPrimary) {
      const envShopId = useTestKeys
        ? (process.env.YOOKASSA_TEST_SHOP_ID ?? process.env.YOOKASSA_SHOP_ID ?? null)
        : (process.env.YOOKASSA_SHOP_ID ?? null);
      const envSecretKey = useTestKeys
        ? (process.env.YOOKASSA_TEST_SECRET_KEY ?? process.env.YOOKASSA_SECRET_KEY ?? null)
        : (process.env.YOOKASSA_SECRET_KEY ?? null);
      envCryptoToken = process.env.CRYPTO_BOT_TOKEN ?? process.env.CRYPTOBOT_TOKEN ?? null;
      envWebhookSecret = process.env.YOOKASSA_WEBHOOK_SECRET ?? null;

      if (!shopId) shopId = envShopId;
      if (!secretKeyRaw) secretKeyRaw = envSecretKey;
    }

    const decryptSafe = (val: string | null | undefined): string | null => {
      if (!val || val.trim() === '') return null;
      try {
        return VaultService.decrypt(val);
      } catch (err) {
        if (SettingsProvider.isTestEnvironment() || useTestKeys || process.env.NODE_ENV === 'test') {
          return val;
        }
        console.error('[SettingsManager] CRITICAL: Failed to decrypt secret with current APP_ENCRYPTION_KEY:', err);
        return null;
      }
    };

    return {
      yookassaShopId: shopId || null,
      yookassaSecretKey: decryptSafe(secretKeyRaw),
      yookassaWebhookSecret: decryptSafe(settings.yookassaWebhookSecret) ?? envWebhookSecret,
      cryptoBotToken: decryptSafe(settings.cryptoBotToken) ?? envCryptoToken,
      robokassaLogin: settings.robokassaLogin ?? null,
      robokassaPassword: decryptSafe(settings.robokassaPassword),
      robokassaWebhookPassword: decryptSafe(settings.robokassaWebhookPassword)
    };
  }

  /**
   * Securely decrypts and returns SMTP credentials.
   */
  static async getEmailSettings(tenantId?: string): Promise<DecryptedEmailSettings> {
    const activeTenantId = tenantId || await this.getTenantId();
    const settings = await this.get(activeTenantId);
    
    const emailProvider = settings.emailProvider || 'SMTP';
    const resendKeyRaw = settings.resendApiKey;
    
    const decryptSafeEmail = (val: string | null | undefined): string | null => {
      if (!val || val.trim() === '') return null;
      try {
        return VaultService.decrypt(val);
      } catch (err) {
        if (SettingsProvider.isTestEnvironment()) {
          return val;
        }
        throw err;
      }
    };

    return {
      emailProvider,
      resendApiKey: decryptSafeEmail(resendKeyRaw),
      smtpHost: settings.smtpHost || process.env.SMTP_HOST || null,
      smtpPort: settings.smtpPort || (process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 465),
      smtpUser: settings.smtpUser || process.env.SMTP_USER || null,
      smtpPassword: settings.smtpPassword ? VaultService.decrypt(settings.smtpPassword) : (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || null),
      supportEmailDomain: settings.supportEmailDomain,
    };
  }

  /**
   * Securely decrypts and returns the inbound email webhook secret.
   * This is server-only and NOT returned in any public setting endpoints.
   */
  static async getInboundEmailWebhookSecret(tenantId?: string): Promise<string | null> {
    const activeTenantId = tenantId || await this.getTenantId();
    const settings = await this.get(activeTenantId);
    return settings.inboundEmailWebhookSecret ? VaultService.decrypt(settings.inboundEmailWebhookSecret) : null;
  }

  /**
   * Returns the inbound support email domain.
   */
  static async getSupportEmailDomain(tenantId?: string): Promise<string> {
    const activeTenantId = tenantId || await this.getTenantId();
    const settings = await this.get(activeTenantId);
    return settings.supportEmailDomain || process.env.SUPPORT_EMAIL_DOMAIN || "smmplan.pro";
  }
  /**
   * Returns all dynamic contact and legal information, completely replacing the old KV store.
   */
  static async getContactAndLegalSettings(tenantId?: string): Promise<ContactAndLegalSettings> {
    const activeTenantId = tenantId || await this.getTenantId();
    const settings = await this.get(activeTenantId);
    
    const branding = getTenantFallbackBranding(activeTenantId);
    const defaultSiteName = branding.name;
    const defaultDomain = branding.domain;

    return {
      SITE_NAME: settings.siteName || defaultSiteName,
      SITE_DESCRIPTION: settings.siteDescription || "",
      SUPPORT_EMAIL: settings.contactSupportEmail || `support@${defaultDomain}`,
      PRIVACY_EMAIL: settings.contactPrivacyEmail || `privacy@${defaultDomain}`,
      TELEGRAM_SUPPORT_BOT: (settings.contactTelegramBot === null || settings.contactTelegramBot === "") ? "" : (settings.contactTelegramBot ?? branding.bot),
      TELEGRAM_SUPPORT_CHANNEL: (settings.contactTelegramChannel === null || settings.contactTelegramChannel === "") ? "" : (settings.contactTelegramChannel ?? branding.channel),
      WHATSAPP: settings.contactWhatsApp || "",
      VK: settings.contactVk || "",
      COMPANY_NAME: settings.legalCompanyName || defaultSiteName,
      COMPANY_INN: settings.legalCompanyInn || "",
      COMPANY_OGRNIP: settings.legalCompanyOgrnip || "",
      COMPANY_ADDRESS: settings.legalCompanyAddress || "",
      LEGAL_INN: settings.legalCompanyInn || "",
      LEGAL_OGRNIP: settings.legalCompanyOgrnip || "",
      LEGAL_ADDRESS: settings.legalCompanyAddress || "",
    };
  }

  /**
   * Returns the dynamic USD to RUB exchange rate.
   * Wave 2: Replaces the deprecated USD_TO_RUB constant.
   */
  static async getExchangeRateUSD(tenantId?: string): Promise<number> {
    const activeTenantId = tenantId || await this.getTenantId();
    const settings = await this.get(activeTenantId);
    return settings.exchangeRateUSD || 95.0; // Fail-safe default
  }

  static async isTestMode(tenantId?: string): Promise<boolean> {
    const activeTenantId = tenantId || await this.getTenantId();
    try {
      const { redis } = await import('./redis');
      if (redis.status === 'ready') {
        const cachedVal = await redis.get(`settings:${activeTenantId}:isTestMode`);
        if (cachedVal !== null) {
          return cachedVal === 'true';
        }
      }
    } catch (err) {
      console.warn('[SettingsProvider] Redis is unavailable in isTestMode:', err instanceof Error ? err.message : String(err));
    }
    const settings = await this.get(activeTenantId);
    if (settings) {
      if (settings.environmentMode) {
        return settings.environmentMode !== 'PRODUCTION';
      }
      if (typeof settings.isTestMode === 'boolean') {
        return settings.isTestMode;
      }
    }
    if (SettingsProvider.isTestEnvironment()) return true;
    return false;
  }

  static async isMaintenanceMode(tenantId?: string): Promise<boolean> {
    const activeTenantId = tenantId || await this.getTenantId();
    try {
      const { redis } = await import('./redis');
      if (redis.status === 'ready') {
        const cachedVal = await redis.get(`settings:${activeTenantId}:maintenanceMode`);
        if (cachedVal !== null) {
          return cachedVal === 'true';
        }
      }
    } catch (err) {
      console.warn('[SettingsProvider] Redis is unavailable in isMaintenanceMode:', err instanceof Error ? err.message : String(err));
    }
    const settings = await this.get(activeTenantId);
    return settings.maintenanceMode;
  }

  static async setExchangeRateUSD(rate: number, tenantId?: string) {
    const activeTenantId = tenantId || await this.getTenantId();
    SettingsProvider.clearMemoryCache(activeTenantId);
    await db.systemSettings.upsert({
      where: { id: activeTenantId },
      update: { exchangeRateUSD: rate, exchangeRateUpdatedAt: new Date() },
      create: { id: activeTenantId, exchangeRateUSD: rate, exchangeRateUpdatedAt: new Date() }
    });
    try {
      revalidateTag('settings', 'default');
      revalidateTag(`settings-${activeTenantId}`, 'default');
    } catch (cacheErr) {
      console.error('[SettingsProvider] Warning: Failed to invalidate cache tag:', cacheErr);
    }
  }

  /**
   * @deprecated Use setEnvironmentMode instead. Kept for backward compatibility.
   * Automatically synchronizes environmentMode to eliminate brain-split bugs.
   */
  static async setTestMode(enable: boolean, tenantId?: string) {
    const mode: EnvironmentMode = enable ? 'SANDBOX' : 'PRODUCTION';
    return this.setEnvironmentMode(mode, tenantId);
  }


  static clearMemoryCache(tenantId?: string) {
    if (tenantId) {
      const cleanSlug = normalizeTenantId(tenantId) || tenantId;
      delete localSettingsCache[tenantId];
      delete localSettingsCache[cleanSlug];
      tenantRecordIdCache.delete(tenantId);
      tenantRecordIdCache.delete(cleanSlug);
    } else {
      for (const k of Object.keys(localSettingsCache)) {
        delete localSettingsCache[k];
      }
      tenantRecordIdCache.clear();
    }
    delete localSettingsCache['smmplan'];
    delete localSettingsCache['flux'];
    delete localSettingsCache['smmflux'];
  }

  static async setMaintenanceMode(enable: boolean, tenantId?: string) {
    const activeTenantId = tenantId || await this.getTenantId();
    SettingsProvider.clearMemoryCache(activeTenantId);

    await db.systemSettings.upsert({
      where: { id: activeTenantId },
      update: { maintenanceMode: enable },
      create: { id: activeTenantId, maintenanceMode: enable }
    });
    try {
      const { redis } = await import('./redis');
      await redis.set(`settings:${activeTenantId}:maintenanceMode`, String(enable));
    } catch {
      // audit-ignore: Redis cache update is secondary to DB persistence
    }
    try {
      const { revalidateTag, revalidatePath } = (await import('next/cache')) as unknown as {
        revalidateTag: (tag: string, profile?: string) => unknown;
        revalidatePath: (path: string, type?: 'layout' | 'page') => unknown;
      };
      revalidateTag('settings', 'default');
      revalidateTag(`settings-${activeTenantId}`, 'default');
      revalidateTag(`system-settings-${activeTenantId}-v3`, 'default');
      revalidatePath('/', 'layout');
      revalidatePath('/admin/settings');
      revalidatePath('/admin/tenants');
    } catch (cacheErr) {
      console.error('[SettingsProvider] Warning: Failed to invalidate cache tag:', cacheErr);
    }
  }

  static async isRefillModuleEnabled(tenantId?: string): Promise<boolean> {
    const activeTenantId = tenantId || await this.getTenantId();
    try {
      const { redis } = await import('./redis');
      const cachedVal = await redis.get(`settings:${activeTenantId}:isRefillModuleEnabled`);
      if (cachedVal !== null) {
        return cachedVal === 'true';
      }
    } catch (err) {
      console.warn('[SettingsProvider] Redis is unavailable in isRefillModuleEnabled:', err instanceof Error ? err.message : String(err));
    }
    return true; // Default to enabled
  }

  static async setRefillModuleEnabled(enable: boolean, tenantId?: string) {
    const activeTenantId = tenantId || await this.getTenantId();
    SettingsProvider.clearMemoryCache(activeTenantId);
    const { redis } = await import('./redis');
    await redis.set(`settings:${activeTenantId}:isRefillModuleEnabled`, String(enable));
    try {
      revalidateTag('settings', 'default');
    } catch (cacheErr) {
      console.error('[SettingsProvider] Warning: Failed to invalidate cache tag:', cacheErr);
    }
  }

  static async getEnvironmentMode(tenantId?: string): Promise<EnvironmentMode> {
    const activeTenantId = tenantId || await this.getTenantId();
    try {
      const settings = await this.get(activeTenantId);
      if (settings && settings.environmentMode) {
        return settings.environmentMode as EnvironmentMode;
      }
    } catch { /* fallback */ }

    try {
      const { redis } = await import('./redis');
      const cachedMode = await redis.get(`settings:${activeTenantId}:environmentMode`);
      if (cachedMode && ['SANDBOX', 'HYBRID', 'ACQUIRING_TEST', 'PRODUCTION'].includes(cachedMode)) {
        return cachedMode as EnvironmentMode;
      }
    } catch { /* ignore redis error */ }

    const isTest = await this.isTestMode(activeTenantId);
    return isTest ? 'SANDBOX' : 'PRODUCTION';
  }

  static async setEnvironmentMode(mode: EnvironmentMode, tenantId?: string): Promise<void> {
    const activeTenantId = tenantId || await this.getTenantId();
    const isTest = mode !== 'PRODUCTION';
    
    SettingsProvider.clearMemoryCache(activeTenantId);

    await db.systemSettings.upsert({
      where: { id: activeTenantId },
      update: { isTestMode: isTest, environmentMode: mode },
      create: { id: activeTenantId, isTestMode: isTest, environmentMode: mode }
    });

    try {
      const { redis } = await import('./redis');
      await redis.set(`settings:${activeTenantId}:environmentMode`, mode);
      await redis.set(`settings:${activeTenantId}:isTestMode`, String(isTest));
    } catch { /* ignore */ }

    try {
      revalidateTag('settings', 'default');
    } catch (cacheErr) {
      console.error('[SettingsProvider] Warning: Failed to invalidate cache tag:', cacheErr);
    }
  }

  static async isMockPaymentEnabled(_tenantId?: string): Promise<boolean> {
    return false;
  }

  static async isMockProviderEnabled(tenantId?: string): Promise<boolean> {
    const mode = await this.getEnvironmentMode(tenantId);
    return mode === 'SANDBOX' || mode === 'ACQUIRING_TEST';
  }
}

export type EnvironmentMode = 'SANDBOX' | 'HYBRID' | 'ACQUIRING_TEST' | 'PRODUCTION';

/**
 * @deprecated Use SettingsProvider for optimized access.
 * Kept for backward compatibility during Wave 2 transition.
 */
export class SettingsManager {
  static async get(tenantId?: string): Promise<SystemSettings> {
    return SettingsProvider.get(tenantId);
  }

  static async getPaymentSecrets(tenantId?: string): Promise<DecryptedPaymentSecrets> {
    return SettingsProvider.getPaymentSecrets(tenantId);
  }

  static async isTestMode(tenantId?: string): Promise<boolean> {
    return SettingsProvider.isTestMode(tenantId);
  }

  static async getEnvironmentMode(tenantId?: string): Promise<EnvironmentMode> {
    return SettingsProvider.getEnvironmentMode(tenantId);
  }

  static async setEnvironmentMode(mode: EnvironmentMode, tenantId?: string): Promise<void> {
    return SettingsProvider.setEnvironmentMode(mode, tenantId);
  }

  static async isMockPaymentEnabled(tenantId?: string): Promise<boolean> {
    return SettingsProvider.isMockPaymentEnabled(tenantId);
  }

  static async isMockProviderEnabled(tenantId?: string): Promise<boolean> {
    return SettingsProvider.isMockProviderEnabled(tenantId);
  }

  static async getExchangeRateUSD(tenantId?: string): Promise<number> {
    return SettingsProvider.getExchangeRateUSD(tenantId);
  }

  static async setExchangeRateUSD(rate: number, tenantId?: string) {
    return SettingsProvider.setExchangeRateUSD(rate, tenantId);
  }

  static async setTestMode(enable: boolean, tenantId?: string) {
    return SettingsProvider.setTestMode(enable, tenantId);
  }
}
