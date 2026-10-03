import { 
  BaseProvider, 
  OrderCreationParams, 
  ProviderBalanceDto, 
  ProviderMultiStatusResponse, 
  ProviderOrderResponseDto, 
  ProviderOrderStatusDto, 
  ProviderServiceDto,
  ProviderCancelResultDto
} from './base-provider';
import { ApiMappingDTO } from '../admin/provider.service';
import { CircuitBreaker } from '@/lib/circuit-breaker';
import { assertSafeUrl } from '@/utils/ssrf-guard';
import { proxiedFetch } from '@/lib/http/proxy-fetch';
import type { ProxyConfig } from '@/types/provider-proxy';
import { z } from 'zod';

export type { ApiMappingDTO };

/**
 * INV-GW-05 (SPEC-REDTEAM-GATEWAYS-2026): the request MAY have reached the provider and been accepted
 * (timeout, network failure, 5xx, unparsable 200). Callers must NOT fail over to another provider.
 * Messages are kept identical to the legacy plain Errors for backward compatibility.
 */
export class ProviderAmbiguousError extends Error {
  readonly isAmbiguous = true;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderAmbiguousError';
  }
}

const ProviderServiceSchema = z.object({
  service: z.union([z.string(), z.number()]).transform(String),
  name: z.string().optional().default("Unknown Service"),
  category: z.string().optional().default("Unknown Category"),
  rate: z.union([z.string(), z.number()]).transform(String),
  min: z.union([z.string(), z.number()]).transform(String),
  max: z.union([z.string(), z.number()]).transform(String),
  type: z.string().optional().default("Default"),
  desc: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  dripfeed: z.union([z.number(), z.boolean(), z.string()]).optional(),
  refill: z.union([z.number(), z.boolean(), z.string()]).optional(),
  cancel: z.union([z.number(), z.boolean(), z.string()]).optional(),
}).passthrough();

const ProviderServicesArraySchema = z.array(ProviderServiceSchema);

export class UniversalProvider implements BaseProvider {
  private apiUrl: string;
  private apiKey: string;
  private mapping: ApiMappingDTO | null = null;
  private proxyConfig: ProxyConfig | null = null;

  constructor(apiUrl: string, apiKey: string, metadata?: Record<string, unknown> | null, proxyConfig?: ProxyConfig | null) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    if (metadata && typeof metadata === 'object' && metadata.mapping) {
      this.mapping = metadata.mapping as ApiMappingDTO;
    }
    if (proxyConfig) {
      this.proxyConfig = proxyConfig;
    }
  }

  private extractNested(obj: unknown, path: string): unknown {
    if (!path || path === '$') return obj;
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      if (typeof current === 'object' && current !== null && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current;
  }

  async request<T>(paramsOrPayload: Record<string, unknown>, retries = 2): Promise<T> {
    await assertSafeUrl(this.apiUrl);
    await CircuitBreaker.check(this.apiUrl);

    let httpMethod: 'GET' | 'POST' = 'POST';
    let contentType: 'form' | 'json' = 'form';
    let authType: 'body' | 'query' | 'header' = 'body';
    let authField = 'key';
    let authPrefix = '';

    if (this.mapping) {
      httpMethod = this.mapping.httpMethod || 'POST';
      contentType = this.mapping.contentType || 'form';
      if (this.mapping.auth) {
        authType = this.mapping.auth.type || 'body';
        authField = this.mapping.auth.field || 'key';
        authPrefix = this.mapping.auth.prefix || '';
      }
    }

    const authValue = authPrefix ? `${authPrefix}${this.apiKey}` : this.apiKey;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        let finalUrl = this.apiUrl;
        const headers: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        };

        if (contentType === 'json') {
          headers['Content-Type'] = 'application/json';
        } else {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
        }

        const params = new URLSearchParams();

        if (authType === 'header') {
          headers[authField] = authValue;
        } else if (authType === 'query') {
          params.append(authField, authValue);
        } else {
          params.append(authField, authValue);
        }

        for (const [key, value] of Object.entries(paramsOrPayload)) {
          if (value !== undefined && value !== null) {
            params.append(key, String(value));
          }
        }

        let body: string | undefined = undefined;

        if (httpMethod === 'GET') {
          const qs = params.toString();
          if (qs) {
            finalUrl = finalUrl.includes('?') ? `${finalUrl}&${qs}` : `${finalUrl}?${qs}`;
          }
        } else {
          if (contentType === 'json') {
            const jsonObj: Record<string, unknown> = {};
            params.forEach((value, key) => { jsonObj[key] = value; });
            body = JSON.stringify(jsonObj);
          } else {
            body = params.toString();
          }
        }

        const response = await proxiedFetch(finalUrl, {
          method: httpMethod,
          headers,
          body,
          redirect: 'error',
          signal: controller.signal,
          proxy: this.proxyConfig,
        });

        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
           throw new Error('Provider response exceeds size limit (10MB)');
        }

        if (response.status === 429) {
          if (attempt < retries) {
            const retryAfter = response.headers.get('Retry-After');
            const parsed = parseInt(retryAfter || '', 10);
            const waitTime = (!isNaN(parsed) && parsed > 0) ? Math.min(parsed * 1000, 60000) : 30000;
            console.warn(`[API] 429 Rate Limit from ${this.apiUrl}. Waiting ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          throw new Error('Provider Rate Limit Exceeded (429)');
        }

        if (!response.ok) {
          if (response.status >= 500 && attempt < retries) {
             const backoff = Math.pow(2, attempt) * 1500;
             console.warn(`[API] ${response.status} Error from ${this.apiUrl}. Retrying in ${backoff}ms...`);
             await new Promise(resolve => setTimeout(resolve, backoff));
             continue;
          }
          
          const text = await response.text();
          let parsedError: string | null = null;
          try {
            const data = JSON.parse(text);
            if (data && typeof data === 'object' && 'error' in data) {
              parsedError = String(data.error);
            }
          } catch {
            // Ignore JSON parse error, fall back to default HTTP error
          }
          // INV-GW-05: a 5xx may be returned after the provider already accepted the request
          const HttpErr = response.status >= 500 ? ProviderAmbiguousError : Error;
          if (parsedError) {
             throw new HttpErr(parsedError);
          }
          throw new HttpErr(`Provider HTTP Error: ${response.status}`);
        }

        const text = await response.text();
        try {
          const data = JSON.parse(text) as T;
          // 🛡️ Circuit Breaker Guard: Do NOT record success if provider returned an error payload disguised as HTTP 200
          if (data && typeof data === 'object' && 'error' in data && (data as { error?: unknown }).error) {
            const errStr = String((data as { error?: unknown }).error).toLowerCase();
            const isSystemic = errStr.includes('balance') || errStr.includes('maintenance') || errStr.includes('down') || errStr.includes('busy');
            if (isSystemic) {
              await CircuitBreaker.recordFailure(this.apiUrl);
            }
            return data;
          }
          await CircuitBreaker.recordSuccess(this.apiUrl);
          return data;
        } catch (jsonErr: unknown) {
          throw new ProviderAmbiguousError(`Provider returned invalid JSON: ${text.substring(0, 100)}...`, { cause: jsonErr });
        }

      } catch (error: unknown) {
        const errName = error instanceof Error ? error.name : '';
        if (errName === 'AbortError') {
           if (attempt < retries) {
              console.warn(`[API] Timeout from ${this.apiUrl}. Retrying...`);
              continue;
           }
           await CircuitBreaker.recordFailure(this.apiUrl);
           throw new ProviderAmbiguousError('Provider Request Timeout (15s)', { cause: error });
        }
        
        if (errName !== 'CircuitBreakerOpenException' && attempt === retries) {
          await CircuitBreaker.recordFailure(this.apiUrl);
        }

        // INV-GW-05: network-level failure (undici TypeError 'fetch failed') — request may have reached the provider
        if (attempt === retries) {
          throw (error instanceof TypeError) ? new ProviderAmbiguousError(error.message, { cause: error }) : error;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }
    throw new Error('Max retries exceeded');
  }

  async getBalance(): Promise<ProviderBalanceDto> {
    const res = await this.request<Record<string, unknown>>({ action: 'balance' });
    
    if (this.mapping && this.mapping.balance) {
      const bPath = this.mapping.balance.balancePath || 'balance';
      const cPath = this.mapping.balance.currencyPath || 'currency';
      
      const balanceVal = this.extractNested(res, bPath);
      const currencyVal = this.extractNested(res, cPath);
      
      if (balanceVal === undefined) {
         throw new Error(`Schema Drift Error: Ожидался ключ баланса '${bPath}', но он не найден в ответе.`);
      }

      return {
        balance: String(balanceVal || '0'),
        currency: String(currencyVal || 'USD')
      };
    }

    if (res.error) throw new Error(String(res.error));
    return {
      balance: String(res.balance || '0'),
      currency: String(res.currency || 'USD')
    };
  }

  async getServices(): Promise<ProviderServiceDto[]> {
    const res = await this.request<unknown>({ action: 'services' }, 3);
    let servicesArray: unknown[];

    if (this.mapping && this.mapping.catalog) {
      const c = this.mapping.catalog;
      const extracted = this.extractNested(res, c.itemsPath || '');
      
      if (!Array.isArray(extracted)) {
         const possibleArray = (typeof res === 'object' && res !== null) ? Object.values(res).find(Array.isArray) : undefined;
         if (possibleArray) {
             servicesArray = possibleArray as unknown[];
         } else {
             throw new Error(`Schema Drift Error: Ожидался массив услуг по пути '${c.itemsPath || '$'}', но получен ${typeof extracted}`);
         }
      } else {
         servicesArray = extracted;
      }

      servicesArray = servicesArray.map(item => ({
         service: this.extractNested(item, c.serviceIdField || 'service'),
         name: this.extractNested(item, c.nameField || 'name'),
         category: this.extractNested(item, c.typeField || 'category'),
         rate: this.extractNested(item, c.priceField || 'rate'),
         min: this.extractNested(item, c.minField || 'min'),
         max: this.extractNested(item, c.maxField || 'max'),
         type: this.extractNested(item, c.typeField || 'type'),
         desc: this.extractNested(item, c.descField || 'desc'),
         description: this.extractNested(item, c.descField || 'description'),
      }));

      if (servicesArray.length > 0 && (servicesArray[0] as Record<string, unknown>).service === undefined) {
         throw new Error(`Schema Drift Error: Ожидался ключ ID услуги '${c.serviceIdField || 'service'}', но он не найден.`);
      }

    } else {
      if (typeof res === 'object' && res !== null && 'error' in res) throw new Error(String((res as Record<string, unknown>).error));
      if (!Array.isArray(res)) throw new Error('Invalid services payload');
      servicesArray = res;
    }
    
    try {
      const parsed = ProviderServicesArraySchema.parse(servicesArray);
      return parsed.map(s => ({
         ...s,
         desc: s.desc || s.description || ""
      })) as ProviderServiceDto[];
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[API] Zod parsing failed for getServices:", errMsg);
      throw new Error(`Provider schema validation failed: ${errMsg}`, { cause: err });
    }
  }

  async createOrder(params: OrderCreationParams): Promise<ProviderOrderResponseDto> {
    let payload: Record<string, unknown>;
    
    if (this.mapping && this.mapping.order) {
      payload = { action: 'add' };
      payload[this.mapping.order.serviceField || 'service'] = params.service;
      payload[this.mapping.order.linkField || 'link'] = params.link;
      payload[this.mapping.order.quantityField || 'quantity'] = params.quantity;
      for (const [k, v] of Object.entries(params)) {
         if (!['service', 'link', 'quantity'].includes(k) && v !== undefined) {
             payload[k] = v;
         }
      }
    } else {
      payload = { action: 'add', ...params };
    }

    const res = await this.request<Record<string, unknown>>(payload, 0);
    
    if (this.mapping && this.mapping.response) {
       const err = this.extractNested(res, this.mapping.response.errorField);
       if (err) throw new Error(String(err));
       
       const orderId = this.extractNested(res, this.mapping.response.orderIdField);
       if (!orderId) throw new ProviderAmbiguousError("Order ID not found in provider response");
       
       return { order: String(orderId) };
    } else {
       if (res.error) throw new Error(String(res.error));
       return res as unknown as ProviderOrderResponseDto;
    }
  }

  async getOrderStatus(orderId: string | number): Promise<ProviderOrderStatusDto> {
    const res = await this.request<Record<string, unknown>>({ action: 'status', order: orderId });
    if (res.error) throw new Error(String(res.error));
    if (typeof res === 'string') throw new Error(res);
    return res as unknown as ProviderOrderStatusDto;
  }

  async getMultiOrderStatus(orderIds: (string | number)[]): Promise<ProviderMultiStatusResponse> {
    if (orderIds.length === 0) return {};
    const res = await this.request<Record<string, unknown>>({ action: 'status', orders: orderIds.join(',') });
    if (res.error) throw new Error(String(res.error));
    return res as unknown as ProviderMultiStatusResponse;
  }

  async cancelOrder(orderId: string | number): Promise<ProviderCancelResultDto> {
    try {
      const res = await this.request<unknown>({ action: 'cancel', orders: String(orderId) }, 0);
      
      if (Array.isArray(res) && res.length > 0) {
        const item = res[0];
        if (item && typeof item === 'object') {
          if (item.cancel === 1 || item.cancel === true || item.status === 'canceled' || item.status === 'Canceled') {
            return { success: true, raw: res };
          }
          if (item.cancel && typeof item.cancel === 'object' && item.cancel.error) {
            return { success: false, error: String(item.cancel.error), raw: res };
          }
          if (item.error) {
            return { success: false, error: String(item.error), raw: res };
          }
        }
      }

      if (res && typeof res === 'object') {
        const obj = res as Record<string, unknown>;
        if (obj.cancel === 1 || obj.cancel === true || obj.status === 'canceled' || obj.status === 'Canceled') {
          return { success: true, raw: res };
        }
        if (obj.error) {
          return { success: false, error: String(obj.error), raw: res };
        }
      }

      return { success: true, raw: res };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: errMsg };
    }
  }

  async refill(orderId: string | number): Promise<{ refill?: string | number; error?: string }> {
    const res = await this.request<any>({ action: 'refill', order: orderId }, 0);
    if (!res) return { error: 'Empty response from provider' };
    if (res.error) return { error: String(res.error) };
    if (res.refill && typeof res.refill === 'object' && res.refill.error) {
      return { error: String(res.refill.error) };
    }
    if (res.status === 'fail' && (res.message || res.error)) {
      return { error: String(res.message || res.error) };
    }
    return res;
  }

  async getRefillStatus(refillId: string | number): Promise<{ status?: string; error?: string }> {
    const res = await this.request<any>({ action: 'refill_status', refill: refillId });
    if (!res) return { error: 'Empty response from provider' };
    if (res.error) return { error: String(res.error) };
    if (res.status && typeof res.status === 'object' && res.status.error) {
      return { error: String(res.status.error) };
    }
    return res;
  }
}
