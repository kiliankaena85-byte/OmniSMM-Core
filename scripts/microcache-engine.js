// scripts/microcache-engine.js
/**
 * OmniSMM High-Concurrency Storefront RAM Microcache & TCP Hardening Engine (2026)
 * 
 * Provides:
 * 1. In-process L1 RAM Microcache for Guest Storefront (HTML / RSC)
 * 2. True Single-Flight Coalescing Mutex preventing Cache Stampede / Thundering Herd on cold misses
 * 3. Marketing query parameter normalization (strips utm_*, yclid, etc.)
 * 4. RFC-compliant Weak ETag 304 handling and Gzip/Identity compression isolation
 * 5. High-concurrency TCP socket configuration (backlog 65535, keepalive 65s)
 * 6. Set-Cookie isolation and referral query bypass
 * 7. Zero-dependency native socket Redis version synchronization fallback
 */

const http = require('http');

const DEFAULT_TTL_MS = 10 * 1000; // 10 seconds
const DEFAULT_STALE_TOLERANCE_MS = 30 * 1000; // 30 seconds
const MAX_CACHE_ENTRIES = 500;

// Internal cache store: Map<key, { statusCode, headers, body, createdAt }>
const memoryCache = new Map();
// In-flight state: Map<key, { waiters: Array<{ req, res }>, timer: any } | boolean>
const inFlightRequests = new Map();

let lastInvalidationTimestamp = 0;
let isInstalled = false;

// Allowed functional parameters that affect page HTML rendering
const FUNCTIONAL_PARAMS = new Set([
  'tenant',
  'contour',
  'flow',
  'mode',
  'serviceid',
  'network',
  'category',
  'tab',
]);

/**
 * Checks if incoming request is a guest storefront navigation eligible for RAM caching.
 */
function isGuestStorefrontRequest(req) {
  const method = req.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }

  const rawUrl = req.url || '/';
  const qIdx = rawUrl.indexOf('?');
  const pathname = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
  const search = qIdx === -1 ? '' : rawUrl.slice(qIdx + 1);

  // Bypass cache if referral query is present so referral cookie is uniquely assigned per user
  if (search && /(?:^|&)ref=/i.test(search)) {
    return false;
  }

  // Storefront guest paths
  const isStorefrontPath = 
    pathname === '/' || 
    pathname === '/services' || 
    pathname.startsWith('/services/') ||
    pathname === '/faq' ||
    pathname === '/reviews' ||
    pathname === '/contacts' ||
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname === '/refund' ||
    pathname === '/offer' ||
    pathname.startsWith('/legal/') ||
    pathname === '/api/storefront/v1/config' ||
    pathname === '/api/storefront/v1/catalog';

  if (!isStorefrontPath) {
    return false;
  }

  // Reject Server Actions
  if (req.headers && (req.headers['next-action'] || req.headers['next-action-id'])) {
    return false;
  }

  // Reject authenticated sessions (Zero-Leakage Invariant)
  const cookie = (req.headers && req.headers['cookie']) || '';
  if (
    cookie.includes('session_token') ||
    cookie.includes('__Host-session_token') ||
    cookie.includes('x_admin_tenant')
  ) {
    return false;
  }

  // Reject WebSocket / SSE
  const upgrade = (req.headers && req.headers['upgrade']) || '';
  const accept = (req.headers && req.headers['accept']) || '';
  if (upgrade.toLowerCase() === 'websocket' || accept.includes('text/event-stream')) {
    return false;
  }

  // Check explicit bypass
  const bypass = (req.headers && req.headers['x-stress-bypass']) || '';
  if (bypass === 'no-cache') {
    return false;
  }

  return true;
}

/**
 * Computes deterministic cache key with marketing query param normalization.
 */
function computeCacheKey(req) {
  const host = ((req.headers && (req.headers['x-forwarded-host'] || req.headers['host'])) || 'localhost')
    .split(':')[0]
    .toLowerCase();

  const rawUrl = req.url || '/';
  const qIdx = rawUrl.indexOf('?');
  const pathname = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx);
  const search = qIdx === -1 ? '' : rawUrl.slice(qIdx + 1);

  let normalizedSearch = '';
  if (search) {
    try {
      const sp = new URLSearchParams(search);
      const cleanSp = new URLSearchParams();
      for (const [key, val] of sp.entries()) {
        const lowerKey = key.toLowerCase();
        if (FUNCTIONAL_PARAMS.has(lowerKey)) {
          cleanSp.set(lowerKey, val);
        }
      }
      cleanSp.sort();
      const qs = cleanSp.toString();
      if (qs) normalizedSearch = '?' + qs;
    } catch {
      // Fallback on malformed query
    }
  }

  const tenantHeader = (req.headers && req.headers['x-tenant-id']) || '';
  const acceptEncoding = (req.headers && req.headers['accept-encoding']) || '';
  const gzipTag = acceptEncoding.includes('gzip') ? ':gzip' : ':identity';

  // Next.js RSC header isolation (RFC / Next.js Vary compliance)
  let rscTag = ':html';
  if (req.headers && req.headers['rsc']) {
    const isPrefetch = Boolean(req.headers['next-router-prefetch']);
    const isSegmentPrefetch = Boolean(req.headers['next-router-segment-prefetch']);
    rscTag = isPrefetch ? ':rsc-pref' : (isSegmentPrefetch ? ':rsc-segpref' : ':rsc');
  }

  // Unified method tag so HEAD requests can hit the GET cache entry without redundant rendering
  const methodTag = (req.method === 'HEAD' || req.method === 'GET') ? 'GET' : req.method;

  return `${methodTag}:${host}:${tenantHeader}:${pathname}${normalizedSearch}${gzipTag}${rscTag}`;
}

/**
 * RFC 9110 Section 13.1.2 weak ETag matching.
 */
function isEtagMatch(ifNoneMatch, responseEtag) {
  if (!ifNoneMatch || !responseEtag) return false;
  if (ifNoneMatch.trim() === '*') return true;

  const normalize = (tag) => tag.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  const cleanResp = normalize(responseEtag);

  const tokens = ifNoneMatch.split(',');
  for (const token of tokens) {
    if (normalize(token) === cleanResp) {
      return true;
    }
  }
  return false;
}

/**
 * Serves cached response directly from Buffer in < 0.2ms.
 */
function serveCachedResponse(req, res, cached, statusHeader, ageMs) {
  const ifNoneMatch = req.headers && req.headers['if-none-match'];
  if (ifNoneMatch && cached.headers['etag'] && isEtagMatch(ifNoneMatch, cached.headers['etag'])) {
    const headers304 = { ...cached.headers };
    delete headers304['content-length'];
    res.writeHead(304, {
      ...headers304,
      'x-cache-status': `${statusHeader}-304`,
      'x-cache-age': `${Math.round(ageMs / 1000)}s`,
      'x-cluster-pid': String(process.pid),
    });
    res.end();
    return;
  }

  const headers = {
    ...cached.headers,
    'x-cache-status': statusHeader,
    'x-cache-age': `${Math.round(ageMs / 1000)}s`,
    'x-cluster-pid': String(process.pid),
  };

  res.writeHead(cached.statusCode, headers);
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(cached.body);
  }
}

/**
 * Stores response into memoryCache with LRU bounding.
 */
function storeInCache(key, entry) {
  if (memoryCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) {
      memoryCache.delete(oldestKey);
    }
  }
  memoryCache.set(key, entry);
}

/**
 * Invalidates storefront cache (called on catalog updates).
 */
function clearMicrocache() {
  memoryCache.clear();
  inFlightRequests.clear();
  lastInvalidationTimestamp = Date.now();
}

/**
 * Normalizes in-flight entry for single-flight coalescing.
 */
function getInFlightEntry(key) {
  const entry = inFlightRequests.get(key);
  if (!entry) return null;
  if (entry === true) {
    const norm = { waiters: [], timer: null };
    inFlightRequests.set(key, norm);
    return norm;
  }
  return entry;
}

/**
 * Intercepts request to capture Next.js SSR output.
 */
function interceptAndCache(req, res, key, next) {
  const chunks = [];
  const origWriteHead = res.writeHead;
  const origWrite = res.write;
  const origEnd = res.end;
  let statusCode = 200;

  res.writeHead = function(code, ...rest) {
    statusCode = code;
    try {
      if (typeof res.setHeader === 'function') {
        if (!res.getHeader('x-cache-status')) res.setHeader('x-cache-status', 'MISS');
        if (!res.getHeader('x-cache-age')) res.setHeader('x-cache-age', '0s');
        if (!res.getHeader('x-cluster-pid')) res.setHeader('x-cluster-pid', String(process.pid));
      }
    } catch {}
    return origWriteHead.call(res, code, ...rest);
  };

  res.write = function(chunk, encoding, callback) {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
    }
    return origWrite.call(res, chunk, encoding, callback);
  };

  res.end = function(chunk, encoding, callback) {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
    }

    try {
      if (typeof res.setHeader === 'function' && !res.headersSent) {
        if (!res.getHeader('x-cache-status')) res.setHeader('x-cache-status', 'MISS');
        if (!res.getHeader('x-cache-age')) res.setHeader('x-cache-age', '0s');
        if (!res.getHeader('x-cluster-pid')) res.setHeader('x-cluster-pid', String(process.pid));
      }
    } catch {}

    const inFlightEntry = getInFlightEntry(key);
    inFlightRequests.delete(key);
    if (inFlightEntry && inFlightEntry.timer) {
      clearTimeout(inFlightEntry.timer);
    }

    const effectiveStatus = (statusCode !== 200) ? statusCode : (res.statusCode || 200);
    const rawHeaders = res.getHeaders ? res.getHeaders() : {};

    // Check if response set any authentication or user-specific cookies
    const setCookie = rawHeaders['set-cookie'];
    const hasAuthCookie = Array.isArray(setCookie)
      ? setCookie.some(c => c.includes('session_token') || c.includes('x_admin_tenant'))
      : typeof setCookie === 'string' && (setCookie.includes('session_token') || setCookie.includes('x_admin_tenant'));

    let newCachedEntry = null;

    // Only cache genuine 200 OK responses with content, without auth cookies
    if (effectiveStatus === 200 && chunks.length > 0 && !hasAuthCookie) {
      const fullBody = Buffer.concat(chunks);
      const outHeaders = { ...rawHeaders };

      // Strip hop-by-hop headers and cookies to prevent cross-user leakage
      delete outHeaders['connection'];
      delete outHeaders['transfer-encoding'];
      delete outHeaders['set-cookie'];

      newCachedEntry = {
        statusCode: 200,
        headers: outHeaders,
        body: fullBody,
        createdAt: Date.now(),
      };

      storeInCache(key, newCachedEntry);
    }

    // Complete the primary response
    const endResult = origEnd.call(res, chunk, encoding, callback);

    // Resolve any waiting requests from the coalesced single-flight queue
    if (inFlightEntry && inFlightEntry.waiters && inFlightEntry.waiters.length > 0) {
      const waiters = inFlightEntry.waiters;
      for (const waiter of waiters) {
        if (waiter.res.writableEnded) continue;
        if (newCachedEntry) {
          serveCachedResponse(waiter.req, waiter.res, newCachedEntry, 'HIT-SINGLEFLIGHT', 0);
        } else {
          // If the primary request failed to cache (e.g. 500 or error), dispatch waiter to listener
          try {
            next(waiter.req, waiter.res);
          } catch (e) {
            waiter.res.statusCode = 500;
            waiter.res.end('Internal Server Error');
          }
        }
      }
    }

    return endResult;
  };

  // If request aborts before completion, clean up in-flight and dispatch waiters
  if (req && typeof req.on === 'function') {
    req.on('aborted', () => {
      const inFlightEntry = getInFlightEntry(key);
      inFlightRequests.delete(key);
      if (inFlightEntry) {
        if (inFlightEntry.timer) clearTimeout(inFlightEntry.timer);
        if (inFlightEntry.waiters) {
          for (const waiter of inFlightEntry.waiters) {
            if (!waiter.res.writableEnded) {
              try { next(waiter.req, waiter.res); } catch {}
            }
          }
        }
      }
    });
  }

  try {
    next(req, res);
  } catch (err) {
    const inFlightEntry = getInFlightEntry(key);
    inFlightRequests.delete(key);
    if (inFlightEntry && inFlightEntry.timer) clearTimeout(inFlightEntry.timer);
    throw err;
  }
}

/**
 * Creates wrapped request listener with RAM microcache.
 */
function createCachedListener(originalListener, options = {}) {
  const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
  const staleToleranceMs = options.staleToleranceMs || DEFAULT_STALE_TOLERANCE_MS;

  return function wrappedListener(req, res) {
    if (!isGuestStorefrontRequest(req)) {
      return originalListener(req, res);
    }

    const key = computeCacheKey(req);
    const cached = memoryCache.get(key);
    const now = Date.now();

    if (cached) {
      // Invalidation check
      if (cached.createdAt < lastInvalidationTimestamp) {
        memoryCache.delete(key);
      } else {
        const age = now - cached.createdAt;
        if (age < ttlMs) {
          // FRESH HIT
          serveCachedResponse(req, res, cached, 'HIT-RAM', age);
          return;
        }

        // STALE CACHE WITH IN-FLIGHT REFRESH: serve stale immediately
        if (age < staleToleranceMs && inFlightRequests.has(key)) {
          serveCachedResponse(req, res, cached, 'STALE-RAM', age);
          return;
        }
      }
    }

    // Single-Flight Coalescing: Check if an in-flight request is already rendering this key
    const currentInFlight = getInFlightEntry(key);
    if (currentInFlight) {
      // Coalesce: queue this request to receive the rendered buffer instead of stampeding Next.js SSR
      currentInFlight.waiters.push({ req, res });
      return;
    }

    // First request: initiate in-flight render with single-flight mutex
    const inFlightEntry = {
      waiters: [],
      timer: null,
    };

    // Safety timeout: if initial request hangs > 10s, flush waiters to direct handler
    inFlightEntry.timer = setTimeout(() => {
      const entry = getInFlightEntry(key);
      if (entry) {
        inFlightRequests.delete(key);
        while (entry.waiters.length > 0) {
          const waiter = entry.waiters.shift();
          try {
            originalListener(waiter.req, waiter.res);
          } catch {}
        }
      }
    }, 10000);
    if (inFlightEntry.timer.unref) inFlightEntry.timer.unref();

    inFlightRequests.set(key, inFlightEntry);
    interceptAndCache(req, res, key, originalListener);
  };
}

/**
 * Hooks into http.createServer to inject microcache and high-concurrency TCP socket settings.
 */
function installMicrocacheEngine(options = {}) {
  if (isInstalled) return;
  isInstalled = true;

  const originalCreateServer = http.createServer;

  http.createServer = function(...args) {
    let serverOptions = {};
    let requestListener = null;

    if (typeof args[0] === 'function') {
      requestListener = args[0];
    } else if (typeof args[1] === 'function') {
      serverOptions = args[0] || {};
      requestListener = args[1];
    }

    if (!requestListener) {
      return originalCreateServer.apply(http, args);
    }

    const wrappedListener = createCachedListener(requestListener, options);
    const server = Object.keys(serverOptions).length > 0
      ? originalCreateServer.call(http, serverOptions, wrappedListener)
      : originalCreateServer.call(http, wrappedListener);

    // High-concurrency TCP Socket Tuning
    server.maxConnections = 65535;
    server.keepAliveTimeout = 65000; // 65 seconds
    server.headersTimeout = 66000;   // 66 seconds
    server.requestTimeout = 30000;   // 30 seconds

    // Wrap server.listen to inject backlog 65535
    const origListen = server.listen;
    server.listen = function(port, hostname, ...rest) {
      if (typeof port === 'number') {
        const backlog = 65535;
        const cb = rest[rest.length - 1];
        if (typeof hostname === 'string') {
          return typeof cb === 'function'
            ? origListen.call(server, port, hostname, backlog, cb)
            : origListen.call(server, port, hostname, backlog);
        } else {
          return typeof cb === 'function'
            ? origListen.call(server, port, backlog, cb)
            : origListen.call(server, port, backlog);
        }
      }
      return origListen.apply(server, [port, hostname, ...rest]);
    };

    return server;
  };

  initRedisSync();
  console.log('[OmniSMM Microcache] RAM Microcache & TCP Backlog (65535) Engine installed successfully.');
}

function initRedisSync() {
  if (!process.env.REDIS_URL || process.env.NODE_ENV === 'test') return;

  // 1. Try ioredis if installed
  try {
    const { Redis } = require('ioredis');
    const redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });

    redisClient.on('error', () => {
      // Fail-open
    });

    redisClient.connect().then(() => {
      const interval = setInterval(async () => {
        try {
          const ver = await redisClient.get('storefront:cache_version');
          if (ver && Number(ver) > lastInvalidationTimestamp) {
            clearMicrocache();
            lastInvalidationTimestamp = Number(ver);
          }
        } catch {
          // Non-fatal
        }
      }, 3000);
      interval.unref();
      return;
    }).catch(() => {
      startNativeRedisSync();
    });
    return;
  } catch {
    // ioredis not available in standalone bundle -> use zero-dependency native TCP sync
  }

  startNativeRedisSync();
}

/**
 * Zero-dependency native TCP socket sync with Redis.
 * Works universally in Docker alpine, standalone runners, and restricted environments.
 */
function startNativeRedisSync() {
  if (!process.env.REDIS_URL || process.env.NODE_ENV === 'test') return;
  const net = require('net');

  try {
    const parsed = new URL(process.env.REDIS_URL);
    const host = parsed.hostname || '127.0.0.1';
    const port = parseInt(parsed.port, 10) || 6379;
    const password = parsed.password ? decodeURIComponent(parsed.password) : null;

    let socket = null;
    let pollInterval = null;

    function connect() {
      if (socket) {
        try { socket.destroy(); } catch {}
      }
      socket = net.createConnection({ host, port }, () => {
        if (password) {
          socket.write(`AUTH ${password}\r\n`);
        }
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = setInterval(() => {
          if (socket && !socket.destroyed && socket.writable) {
            socket.write(`GET storefront:cache_version\r\n`);
          }
        }, 3000);
        if (pollInterval.unref) pollInterval.unref();
      });

      if (socket.unref) socket.unref();

      socket.on('data', (data) => {
        const text = data.toString('utf-8');
        // Parse Redis RESP bulk string response: "$13\r\n1727871234567\r\n"
        const match = text.match(/\$(\d+)\r\n([^\r\n]+)\r\n/);
        if (match && match[2]) {
          const ver = Number(match[2]);
          if (!isNaN(ver) && ver > lastInvalidationTimestamp) {
            clearMicrocache();
            lastInvalidationTimestamp = ver;
          }
        }
      });

      socket.on('error', () => {
        if (pollInterval) clearInterval(pollInterval);
        setTimeout(connect, 5000).unref();
      });

      socket.on('close', () => {
        if (pollInterval) clearInterval(pollInterval);
        setTimeout(connect, 5000).unref();
      });
    }

    connect();
  } catch {
    // Non-fatal
  }
}

module.exports = {
  installMicrocacheEngine,
  createCachedListener,
  isGuestStorefrontRequest,
  computeCacheKey,
  serveCachedResponse,
  storeInCache,
  clearMicrocache,
  isEtagMatch,
  memoryCache,
  inFlightRequests,
  DEFAULT_TTL_MS,
};
