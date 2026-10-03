import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isGuestStorefrontRequest,
  computeCacheKey,
  createCachedListener,
  clearMicrocache,
  isEtagMatch,
  memoryCache,
  inFlightRequests,
} from '../../../scripts/microcache-engine';

describe('OmniSMM Storefront RAM Microcache Engine', () => {
  beforeEach(() => {
    clearMicrocache();
  });

  describe('isGuestStorefrontRequest', () => {
    it('allows guest GET requests to storefront root', () => {
      const req = {
        method: 'GET',
        url: '/',
        headers: {},
      };
      expect(isGuestStorefrontRequest(req)).toBe(true);
    });

    it('allows guest GET requests to /services and subcategories', () => {
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/services', headers: {} })).toBe(true);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/services/telegram', headers: {} })).toBe(true);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/services/vk/subscribers', headers: {} })).toBe(true);
    });

    it('allows guest GET requests to public informational and legal pages', () => {
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/faq', headers: {} })).toBe(true);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/reviews', headers: {} })).toBe(true);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/contacts', headers: {} })).toBe(true);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/terms', headers: {} })).toBe(true);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/privacy', headers: {} })).toBe(true);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/legal/terms', headers: {} })).toBe(true);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/legal/privacy', headers: {} })).toBe(true);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/legal/refund', headers: {} })).toBe(true);
    });

    it('bypasses microcache if referral query is present to ensure unique cookie assignment', () => {
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/?ref=alice', headers: {} })).toBe(false);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/services?ref=partner123', headers: {} })).toBe(false);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/?utm_source=vk&ref=bob', headers: {} })).toBe(false);
    });

    it('rejects non-GET/HEAD methods', () => {
      expect(isGuestStorefrontRequest({ method: 'POST', url: '/', headers: {} })).toBe(false);
      expect(isGuestStorefrontRequest({ method: 'PUT', url: '/', headers: {} })).toBe(false);
      expect(isGuestStorefrontRequest({ method: 'DELETE', url: '/', headers: {} })).toBe(false);
    });

    it('rejects protected and API routes', () => {
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/dashboard', headers: {} })).toBe(false);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/admin/orders', headers: {} })).toBe(false);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/operator', headers: {} })).toBe(false);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/api/v2?action=services', headers: {} })).toBe(false);
      expect(isGuestStorefrontRequest({ method: 'GET', url: '/api/health', headers: {} })).toBe(false);
    });

    it('rejects authenticated sessions to prevent data leakage', () => {
      expect(
        isGuestStorefrontRequest({
          method: 'GET',
          url: '/',
          headers: { cookie: 'session_token=jwt.abc.123' },
        })
      ).toBe(false);

      expect(
        isGuestStorefrontRequest({
          method: 'GET',
          url: '/',
          headers: { cookie: '__Host-session_token=jwt.abc.123' },
        })
      ).toBe(false);

      expect(
        isGuestStorefrontRequest({
          method: 'GET',
          url: '/',
          headers: { cookie: 'x_admin_tenant=smmplan' },
        })
      ).toBe(false);
    });

    it('rejects Server Actions and WebSockets', () => {
      expect(
        isGuestStorefrontRequest({
          method: 'GET',
          url: '/',
          headers: { 'next-action': 'some-action-id' },
        })
      ).toBe(false);

      expect(
        isGuestStorefrontRequest({
          method: 'GET',
          url: '/',
          headers: { upgrade: 'websocket' },
        })
      ).toBe(false);

      expect(
        isGuestStorefrontRequest({
          method: 'GET',
          url: '/',
          headers: { accept: 'text/event-stream' },
        })
      ).toBe(false);
    });

    it('respects x-stress-bypass: no-cache', () => {
      expect(
        isGuestStorefrontRequest({
          method: 'GET',
          url: '/',
          headers: { 'x-stress-bypass': 'no-cache' },
        })
      ).toBe(false);
    });
  });

  describe('computeCacheKey normalization', () => {
    it('normalizes marketing parameters so ad clicks hit the same cache', () => {
      const req1 = {
        method: 'GET',
        url: '/?utm_source=yandex&utm_medium=cpc&utm_campaign=boost&yclid=123456789',
        headers: { host: 'smmplan.pro' },
      };
      const req2 = {
        method: 'GET',
        url: '/?utm_source=vk&gclid=abcdef98765&_openstat=direct',
        headers: { host: 'smmplan.pro' },
      };
      const reqPure = {
        method: 'GET',
        url: '/',
        headers: { host: 'smmplan.pro' },
      };

      const key1 = computeCacheKey(req1);
      const key2 = computeCacheKey(req2);
      const keyPure = computeCacheKey(reqPure);

      expect(key1).toBe(keyPure);
      expect(key2).toBe(keyPure);
    });

    it('preserves functional rendering parameters in sorted order', () => {
      const reqA = {
        method: 'GET',
        url: '/?serviceId=42&contour=test&tenant=smmplan',
        headers: { host: 'localhost:3000' },
      };
      const reqB = {
        method: 'GET',
        url: '/?tenant=smmplan&contour=test&serviceId=42',
        headers: { host: 'localhost:3000' },
      };

      expect(computeCacheKey(reqA)).toBe(computeCacheKey(reqB));
    });

    it('distinguishes different tenants and domains', () => {
      const reqSmmplan = {
        method: 'GET',
        url: '/',
        headers: { host: 'smmplan.pro' },
      };
      const reqFlux = {
        method: 'GET',
        url: '/',
        headers: { host: 'smmflux.ru' },
      };

      expect(computeCacheKey(reqSmmplan)).not.toBe(computeCacheKey(reqFlux));
    });

    it('differentiates client compression support (gzip vs identity)', () => {
      const reqGzip = {
        method: 'GET',
        url: '/',
        headers: { host: 'smmplan.pro', 'accept-encoding': 'gzip, deflate, br' },
      };
      const reqPlain = {
        method: 'GET',
        url: '/',
        headers: { host: 'smmplan.pro', 'accept-encoding': 'identity' },
      };

      expect(computeCacheKey(reqGzip)).not.toBe(computeCacheKey(reqPlain));
    });

    it('isolates Next.js RSC requests from HTML, and distinguishes prefetch from full RSC', () => {
      const reqHtml = {
        method: 'GET',
        url: '/services',
        headers: { host: 'smmplan.pro' },
      };
      const reqRsc = {
        method: 'GET',
        url: '/services',
        headers: { host: 'smmplan.pro', rsc: '1' },
      };
      const reqPrefetch = {
        method: 'GET',
        url: '/services',
        headers: { host: 'smmplan.pro', rsc: '1', 'next-router-prefetch': '1' },
      };
      const reqSegPrefetch = {
        method: 'GET',
        url: '/services',
        headers: { host: 'smmplan.pro', rsc: '1', 'next-router-segment-prefetch': '1' },
      };

      const keyHtml = computeCacheKey(reqHtml);
      const keyRsc = computeCacheKey(reqRsc);
      const keyPref = computeCacheKey(reqPrefetch);
      const keySegPref = computeCacheKey(reqSegPrefetch);

      expect(keyHtml).toContain(':html');
      expect(keyRsc).toContain(':rsc');
      expect(keyPref).toContain(':rsc-pref');
      expect(keySegPref).toContain(':rsc-segpref');

      expect(keyHtml).not.toBe(keyRsc);
      expect(keyRsc).not.toBe(keyPref);
      expect(keyPref).not.toBe(keySegPref);
    });

    it('allows HEAD requests to share the GET cache key for zero-overhead header serving', () => {
      const reqGet = { method: 'GET', url: '/', headers: { host: 'smmplan.pro' } };
      const reqHead = { method: 'HEAD', url: '/', headers: { host: 'smmplan.pro' } };

      expect(computeCacheKey(reqGet)).toBe(computeCacheKey(reqHead));
    });
  });

  describe('isEtagMatch (RFC 9110 Section 13.1.2)', () => {
    it('matches exact ETags', () => {
      expect(isEtagMatch('"abc123"', '"abc123"')).toBe(true);
    });

    it('matches weak ETags against strong and weak tags', () => {
      expect(isEtagMatch('W/"abc123"', '"abc123"')).toBe(true);
      expect(isEtagMatch('"abc123"', 'W/"abc123"')).toBe(true);
      expect(isEtagMatch('W/"abc123"', 'W/"abc123"')).toBe(true);
    });

    it('matches wildcard asterisks', () => {
      expect(isEtagMatch('*', '"abc123"')).toBe(true);
      expect(isEtagMatch('*', 'W/"abc123"')).toBe(true);
    });

    it('matches among comma-separated lists of client ETags', () => {
      expect(isEtagMatch('"xyz", W/"abc123", "def"', '"abc123"')).toBe(true);
      expect(isEtagMatch('"xyz", "def"', '"abc123"')).toBe(false);
    });
  });

  describe('createCachedListener request flow', () => {
    it('intercepts cache miss, invokes handler, and caches the HTML response', async () => {
      let invocationCount = 0;
      const originalHandler = vi.fn((req, res) => {
        invocationCount++;
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'ETag': '"mock-etag-123"',
        });
        res.write('<!DOCTYPE html><html><body>');
        res.write('<h1>SMMplan Storefront</h1>');
        res.end('</body></html>');
      });

      const cachedListener = createCachedListener(originalHandler, { ttlMs: 5000 });

      // Request 1: Cold Cache (Miss)
      const resHeaders1: Record<string, string> = {};
      const resChunks1: Buffer[] = [];
      const res1 = {
        statusCode: 200,
        writeHead: vi.fn((code, h) => {
          res1.statusCode = code;
          if (h) Object.assign(resHeaders1, h);
        }),
        write: vi.fn((chunk) => {
          resChunks1.push(Buffer.from(chunk));
        }),
        end: vi.fn((chunk) => {
          if (chunk) resChunks1.push(Buffer.from(chunk));
        }),
        getHeaders: () => ({ ...resHeaders1 }),
      };

      cachedListener({ method: 'GET', url: '/', headers: { host: 'smmplan.pro' } }, res1 as any);

      expect(invocationCount).toBe(1);
      const html1 = Buffer.concat(resChunks1).toString();
      expect(html1).toContain('SMMplan Storefront');
      expect(memoryCache.size).toBe(1);

      // Request 2: Warm Cache (Hit)
      const resHeaders2: Record<string, string> = {};
      const resChunks2: Buffer[] = [];
      const res2 = {
        statusCode: 200,
        writeHead: vi.fn((code, h) => {
          res2.statusCode = code;
          if (h) Object.assign(resHeaders2, h);
        }),
        write: vi.fn((chunk) => {
          resChunks2.push(Buffer.from(chunk));
        }),
        end: vi.fn((chunk) => {
          if (chunk) resChunks2.push(Buffer.from(chunk));
        }),
        getHeaders: () => ({ ...resHeaders2 }),
      };

      cachedListener({ method: 'GET', url: '/', headers: { host: 'smmplan.pro' } }, res2 as any);

      // Original handler was NOT called again! Served purely from RAM in 0ms!
      expect(invocationCount).toBe(1);
      expect(resHeaders2['x-cache-status']).toBe('HIT-RAM');
      const html2 = Buffer.concat(resChunks2).toString();
      expect(html2).toBe(html1);
    });

    it('prevents cache stampede / thundering herd on cold cache misses via single-flight coalescing', async () => {
      let renderInvocationCount = 0;
      let completeRender: (() => void) | null = null;

      // Slow SSR renderer simulating heavy Next.js React 19 tree compilation
      const slowSsrHandler = vi.fn((req, res) => {
        renderInvocationCount++;
        // Hold the render until signal
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.write('<h1>Heavy Render Finished</h1>');
          res.end();
          if (completeRender) completeRender();
        }, 30);
      });

      const cachedListener = createCachedListener(slowSsrHandler, { ttlMs: 10000 });

      // Fire 5 concurrent requests simultaneously on an empty cache!
      const responses: any[] = [];

      for (let i = 0; i < 5; i++) {
        const chunks: Buffer[] = [];
        const headers: Record<string, string> = {};
        const resObj: any = {
          statusCode: 200,
          chunks,
          headers,
          writeHead: vi.fn((code: number, h: Record<string, string>) => {
            resObj.statusCode = code;
            if (h) Object.assign(headers, h);
          }),
          write: vi.fn((c: any) => {
            if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
          }),
          end: vi.fn((c: any) => {
            if (c) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
          }),
          getHeaders: () => ({ ...headers }),
        };
        responses.push(resObj);
      }

      await new Promise<void>((resolve) => {
        completeRender = resolve;
        // Trigger all 5 requests concurrently
        for (let i = 0; i < 5; i++) {
          cachedListener(
            { method: 'GET', url: '/', headers: { host: 'smmplan.pro' }, on: vi.fn() },
            responses[i]
          );
        }
      });

      // Crucial assertion: Next.js SSR renderer was invoked EXACTLY ONCE!
      expect(renderInvocationCount).toBe(1);

      // Verify that all 5 requests received the full HTML response without errors!
      for (let i = 0; i < 5; i++) {
        const body = Buffer.concat(responses[i].chunks).toString();
        expect(body).toBe('<h1>Heavy Render Finished</h1>');
      }
    });

    it('never caches 500 error responses and protects against error poisoning', async () => {
      let invocationCount = 0;
      // Handler returns 500 without writeHead (typical Next.js error path)
      const errorHandler = vi.fn((req, res) => {
        invocationCount++;
        if (invocationCount === 1) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Recovered 200</h1>');
        }
      });

      const cachedListener = createCachedListener(errorHandler, { ttlMs: 10000 });

      // First request fails with 500
      const res1: any = {
        statusCode: 200,
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        getHeaders: () => ({}),
      };
      cachedListener({ method: 'GET', url: '/', headers: { host: 'smmplan.pro' }, on: vi.fn() }, res1);

      expect(invocationCount).toBe(1);
      // Cache must NOT store the 500 error!
      expect(memoryCache.size).toBe(0);

      // Second request arrives: must NOT serve cached 500, but call handler again
      const chunks2: Buffer[] = [];
      const res2: any = {
        statusCode: 200,
        writeHead: vi.fn(),
        write: vi.fn((c) => chunks2.push(Buffer.from(c))),
        end: vi.fn((c) => { if (c) chunks2.push(Buffer.from(c)); }),
        getHeaders: () => ({}),
      };
      cachedListener({ method: 'GET', url: '/', headers: { host: 'smmplan.pro' }, on: vi.fn() }, res2);

      expect(invocationCount).toBe(2);
      expect(Buffer.concat(chunks2).toString()).toContain('Recovered 200');
    });

    it('strips Set-Cookie headers to prevent cross-user session/cookie leakage', () => {
      const handlerWithCookie = vi.fn((req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Set-Cookie': 'ref=affiliate_x; Path=/',
        });
        res.end('<h1>Welcome</h1>');
      });

      const cachedListener = createCachedListener(handlerWithCookie, { ttlMs: 10000 });

      const res1: any = {
        statusCode: 200,
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        getHeaders: () => ({ 'set-cookie': 'ref=affiliate_x; Path=/' }),
      };
      cachedListener({ method: 'GET', url: '/', headers: { host: 'smmplan.pro' }, on: vi.fn() }, res1);

      // Verify cached entry has Set-Cookie deleted
      const cached = memoryCache.values().next().value;
      expect(cached).toBeDefined();
      expect(cached.headers['set-cookie']).toBeUndefined();
    });

    it('serves HEAD requests directly from GET cached entry with zero body bytes', () => {
      const originalHandler = vi.fn((req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/html',
          'ETag': '"head-test-etag"',
        });
        res.end('<h1>Full HTML Body</h1>');
      });

      const cachedListener = createCachedListener(originalHandler, { ttlMs: 10000 });

      // 1. Warm GET request
      const resGet: any = {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        getHeaders: () => ({ 'etag': '"head-test-etag"' }),
      };
      cachedListener({ method: 'GET', url: '/faq', headers: { host: 'smmplan.pro' }, on: vi.fn() }, resGet);

      expect(originalHandler).toHaveBeenCalledTimes(1);

      // 2. HEAD request arrives
      const headChunks: Buffer[] = [];
      const headHeaders: Record<string, string> = {};
      const resHead: any = {
        writeHead: vi.fn((code, h) => {
          if (h) Object.assign(headHeaders, h);
        }),
        write: vi.fn((c) => headChunks.push(Buffer.from(c))),
        end: vi.fn((c) => { if (c) headChunks.push(Buffer.from(c)); }),
      };
      cachedListener({ method: 'HEAD', url: '/faq', headers: { host: 'smmplan.pro' }, on: vi.fn() }, resHead);

      // Handler was NOT called again for HEAD!
      expect(originalHandler).toHaveBeenCalledTimes(1);
      expect(headHeaders['x-cache-status']).toBe('HIT-RAM');
      expect(headChunks.length).toBe(0); // Zero body bytes sent on HEAD!
    });

    it('returns 304 Not Modified when client provides matching ETag', () => {
      const originalHandler = vi.fn((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html', 'ETag': '"stable-etag-999"' });
        res.end('<h1>Catalog</h1>');
      });

      const cachedListener = createCachedListener(originalHandler, { ttlMs: 5000 });

      // Populate cache
      const dummyRes = {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        getHeaders: () => ({ 'etag': '"stable-etag-999"' }),
      };
      cachedListener({ method: 'GET', url: '/services', headers: { host: 'smmplan.pro' }, on: vi.fn() }, dummyRes as any);

      // Second request with If-None-Match
      let capturedCode = 0;
      const res304 = {
        writeHead: vi.fn((code) => {
          capturedCode = code;
        }),
        end: vi.fn(),
      };

      cachedListener(
        {
          method: 'GET',
          url: '/services',
          headers: { host: 'smmplan.pro', 'if-none-match': 'W/"stable-etag-999"' },
          on: vi.fn(),
        },
        res304 as any
      );

      expect(capturedCode).toBe(304);
      expect(res304.end).toHaveBeenCalledTimes(1);
    });

    it('serves stale cache when refresh is in-flight to prevent cache stampede', () => {
      const originalHandler = vi.fn((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Initial Render</h1>');
      });

      const cachedListener = createCachedListener(originalHandler, {
        ttlMs: 10, // Short TTL
        staleToleranceMs: 5000,
      });

      // 1. Populate initial entry
      const res1 = {
        writeHead: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        getHeaders: () => ({}),
      };
      cachedListener({ method: 'GET', url: '/', headers: { host: 'smmplan.pro' }, on: vi.fn() }, res1 as any);

      // Wait 15ms so entry is expired but within stale tolerance
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const key = computeCacheKey({ method: 'GET', url: '/', headers: { host: 'smmplan.pro' } });
          // Simulate an active in-flight refresh
          inFlightRequests.set(key, true);

          const resStaleHeaders: Record<string, string> = {};
          const resStale = {
            writeHead: vi.fn((code, h) => {
              if (h) Object.assign(resStaleHeaders, h);
            }),
            end: vi.fn(),
          };

          cachedListener({ method: 'GET', url: '/', headers: { host: 'smmplan.pro' }, on: vi.fn() }, resStale as any);

          // Served STALE-RAM without waiting or throwing!
          expect(resStaleHeaders['x-cache-status']).toBe('STALE-RAM');
          resolve();
        }, 20);
      });
    });

    it('invalidates entries when clearMicrocache is called', () => {
      const originalHandler = vi.fn((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Cached Content</h1>');
      });

      const cachedListener = createCachedListener(originalHandler, { ttlMs: 10000 });

      const res1 = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), getHeaders: () => ({}) };
      cachedListener({ method: 'GET', url: '/', headers: { host: 'smmplan.pro' }, on: vi.fn() }, res1 as any);
      expect(originalHandler).toHaveBeenCalledTimes(1);

      // Clear cache
      clearMicrocache();

      const res2 = { writeHead: vi.fn(), write: vi.fn(), end: vi.fn(), getHeaders: () => ({}) };
      cachedListener({ method: 'GET', url: '/', headers: { host: 'smmplan.pro' }, on: vi.fn() }, res2 as any);
      // Handler was called again because cache was cleared
      expect(originalHandler).toHaveBeenCalledTimes(2);
    });
  });
});
