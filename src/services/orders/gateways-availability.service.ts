/**
 * (c) 2024-2026 SMMplan. All rights reserved.
 * Payment gateways availability discovery service.
 */
import { headers } from 'next/headers';
import { normalizeTenantId } from "@/lib/tenant-resolver-edge";
import { SettingsProvider } from '@/lib/settings';

export class GatewaysAvailabilityService {
  static async getAvailable(explicitTenantId?: string) {
    let resolvedTenantId = explicitTenantId;
    if (!resolvedTenantId) {
      try {
        const reqHeaders = await headers();
        resolvedTenantId = normalizeTenantId(reqHeaders.get('x-tenant-id')) || 'smmplan';
      } catch {
        resolvedTenantId = 'smmplan';
      }
    }

    const secrets = await SettingsProvider.getPaymentSecrets(resolvedTenantId);
    const isTest = await SettingsProvider.isTestMode(resolvedTenantId);

    const hasValidYookassa = Boolean(
      secrets.yookassaShopId &&
      secrets.yookassaSecretKey &&
      secrets.yookassaShopId.trim().length > 0 &&
      secrets.yookassaSecretKey.trim().length > 0 &&
      (isTest || (
        secrets.yookassaShopId !== 'test_shop_id' &&
        secrets.yookassaShopId !== 'test_shop_id_test' &&
        secrets.yookassaSecretKey !== 'test_secret' &&
        secrets.yookassaSecretKey !== 'test_secret_key'
      ))
    );

    const legalDetails = await SettingsProvider.getContactAndLegalSettings(resolvedTenantId);
    const hasValidApi = Boolean(
      legalDetails.LEGAL_INN && 
      legalDetails.LEGAL_INN !== 'Укажите ИНН' && 
      legalDetails.LEGAL_INN.trim().length >= 10
    );

    // SPEC-TESTER-INVITES-2026 (INV-TESTER-05): YooKassa-exclusive gateway in current testing phase
    return {
      yookassa: hasValidYookassa,
      sbp: false,
      robokassa: false,
      cryptobot: false,
      api: hasValidApi,
      isTestMode: isTest
    };
  }
}
