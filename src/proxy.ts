import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { 
  decryptSessionToken, 
  readSessionTokenFromCookies, 
  SESSION_COOKIE_NAME, 
  LEGACY_SESSION_COOKIE_NAME 
} from '@/lib/session-edge';
import { ROUTES } from '@/lib/routes';
import { resolveTenantFromHostEdge, normalizeTenantId, resolveContourFromHost, type ContourId } from '@/lib/tenant-resolver-edge';
import { DomainRegistryService } from '@/services/tenant/domain-registry.service';

function clearSessionCookiesOnResponse(response: NextResponse) {
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 0,
  };
  response.cookies.set(SESSION_COOKIE_NAME, '', cookieOptions);
  response.cookies.set(LEGACY_SESSION_COOKIE_NAME, '', cookieOptions);
}

// Map of legacy routes to new static routes
const legacyRedirects: Record<string, string> = {
  '/register': '/login?tab=register',
  '/auth/signin': ROUTES.AUTH.LOGIN,
  '/signin': ROUTES.AUTH.LOGIN,
  '/auth/login': ROUTES.AUTH.LOGIN,
  '/cabinet': ROUTES.DASHBOARD.HOME,
  '/add-funds': ROUTES.DASHBOARD.ADD_FUNDS,
  '/orders': ROUTES.DASHBOARD.ORDERS,
  '/catalog': ROUTES.SERVICES.INDEX,
  '/p/offer': ROUTES.LEGAL.TERMS,
  '/p/terms': ROUTES.LEGAL.TERMS,
  '/p/privacy': ROUTES.LEGAL.PRIVACY,
  '/p/refund': ROUTES.LEGAL.REFUND,
  '/p/faq': ROUTES.FAQ,
  '/boost': '/services/telegram/busty',
  '/telegram/boost': '/services/telegram/busty',
};

// N-10.3: Strict Trusted Contour Domain Allowlist
const TRUSTED_CONTOUR_MAP: Record<ContourId, Set<string>> = {
  test: new Set([
    'test.smmplan.pro',
    'test-flux.smmplan.pro',
    'flux.smmplan.pro',
    'flux.smmplan.ru',
    'smmflux.ru',
    'www.smmflux.ru',
    'smmplan.pro',
    'www.smmplan.pro',
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    'host.docker.internal',
  ]),
  prod: new Set([
    'smmplan.pro',
    'www.smmplan.pro',
    'test.smmplan.pro',
    'flux.smmplan.pro',
    'smmflux.ru',
    'www.smmflux.ru',
  ]),
  flux: new Set([
    'smmflux.ru',
    'www.smmflux.ru',
    'flux.smmplan.pro',
    'flux.smmplan.ru',
    'test-flux.smmplan.pro',
    'smmflux.local',
    'flux.local',
  ]),
};

// Base Known Root Domains
const KNOWN_ROOT_DOMAINS = [
  'smmplan.pro',
  'smmflux.ru',
  'smmplan.ru',
];

// Dynamic Tunnel & Testing Suffixes (Permanent Tailscale & Cloudflare tunnels only)
const ALLOWED_TUNNEL_SUFFIXES = [
  '.ts.net',
  '.trycloudflare.com',
];

const ALLOWED_CONTOUR_DOMAINS = new Set([
  'smmplan.pro',
  'www.smmplan.pro',
  'test.smmplan.pro',
  'test-flux.smmplan.pro',
  'smmflux.ru',
  'www.smmflux.ru',
  'flux.smmplan.pro',
  'flux.smmplan.ru',
  'smmflux.local',
  'flux.local',
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'host.docker.internal'
]);

export const INTERNAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'host.docker.internal',
  'web',
  'smmplan_web',
  'tunnel',
  'smmplan_tunnel'
]);

export function cleanHostString(h: string | null | undefined): string {
  if (!h) return '';
  let clean = h.split(',')[0].trim().toLowerCase();
  if (clean.endsWith('.')) clean = clean.slice(0, -1);
  if (clean.startsWith('[') && clean.includes(']')) {
    const closing = clean.indexOf(']');
    clean = clean.slice(1, closing);
  } else {
    const colons = (clean.match(/:/g) || []).length;
    if (colons === 1) {
      clean = clean.split(':')[0];
    }
  }
  return clean.trim();
}

export function isPureLocalhost(h: string | null | undefined): boolean {
  if (!h) return false;
  const clean = cleanHostString(h);
  return clean === 'localhost' || clean === '127.0.0.1' || clean === '::1' || clean === '0.0.0.0' || clean.endsWith('.local');
}

export function isInternalHost(h: string | null | undefined): boolean {
  if (!h) return false;
  const clean = cleanHostString(h);

  if (INTERNAL_HOSTS.has(clean)) return true;
  if (clean.endsWith('.ts.net') || clean.includes('tailscale')) return true;
  if (ALLOWED_TUNNEL_SUFFIXES.some(suffix => clean.endsWith(suffix))) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(clean)) return true;
  if (/^10\.\d+\.\d+\.\d+$/.test(clean)) return true;
  if (/^192\.168\.\d+\.\d+$/.test(clean)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d+\.\d+$/.test(clean)) return true;
  if (/^26\.\d+\.\d+\.\d+$/.test(clean)) return true;
  return false;
}

/**
 * Validates whether an incoming host is authorized (via root domain wildcard, tunnel suffix, internal network, or ENV).
 */
export function isKnownOrAllowedHost(h: string | null | undefined): boolean {
  if (!h) return false;
  const clean = cleanHostString(h);
  
  if (isInternalHost(clean)) return true;

  // 1. Check root domains and all their subdomains (*.smmplan.pro, *.smmflux.ru, etc.)
  for (const root of KNOWN_ROOT_DOMAINS) {
    if (clean === root || clean.endsWith('.' + root)) {
      return true;
    }
  }

  // 2. Check tunnel suffixes (*.ts.net, *.trycloudflare.com, etc.)
  for (const suffix of ALLOWED_TUNNEL_SUFFIXES) {
    if (clean.endsWith(suffix)) {
      return true;
    }
  }

  // 3. Check explicit list
  if (ALLOWED_CONTOUR_DOMAINS.has(clean)) return true;

  // 4. Check dynamic environment variables
  const envList = [
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.BASE_URL,
    process.env.TUNNEL_DOMAIN,
    process.env.ALLOWED_ORIGINS,
  ].filter(Boolean).join(',');

  if (envList) {
    const customHosts = envList.split(',').map(s => {
      try {
        return s.includes('://') ? cleanHostString(new URL(s.trim()).host) : cleanHostString(s.trim());
      } catch {
        return cleanHostString(s.trim());
      }
    });
    if (customHosts.includes(clean)) return true;
  }

  // 5. Check dynamic L1 domain registry cache and registered tenant root domains
  if (DomainRegistryService.isKnownRootOrSubdomain(clean)) {
    return true;
  }

  return false;
}

/**
 * Checks whether an incoming request qualifies for stress-test bypass or represents trusted internal traffic.
 * Valid stress header: x-stress-bypass === process.env.INTERNAL_API_SECRET || x-stress-bypass === 'omni-load-2026'
 * Trusted internal: x-internal-traffic === 'true' or direct local/internal request without external x-forwarded-for.
 */
export function checkStressOrInternalBypass(request: NextRequest, rawHostClean: string, clientIp: string): boolean {
  const stressBypassHeader = request.headers.get('x-stress-bypass');
  if (stressBypassHeader) {
    const internalSecret = process.env.INTERNAL_API_SECRET;
    if ((internalSecret && stressBypassHeader === internalSecret) || stressBypassHeader === 'omni-load-2026') {
      return true;
    }
  }
  // Trusted internal traffic: direct connection to internal host without external proxy forwarding (x-forwarded-for)
  if (!request.headers.has('x-forwarded-for') && isInternalHost(rawHostClean)) {
    return true;
  }
  return false;
}

/**
 * Strict CORS origin validator (CORS-01 / OWASP ASVS 4.0.3).
 * In production: strictly whitelist smmplan.pro, smmflux.ru, and all registered dynamic tenant domains.
 * Blocks localhost, private IPs, and arbitrary domains from cross-origin credential sharing.
 */
export function isAllowedCorsOrigin(origin: string | null | undefined): boolean {
  if (!origin || origin === 'null') return false;
  try {
    const originHost = new URL(origin).host.toLowerCase().split(':')[0];
    const isProd = process.env.NODE_ENV === 'production';

    // In production, strictly reject localhost and internal loopback from CORS whitelist
    if (isProd && (originHost === 'localhost' || originHost === '127.0.0.1' || originHost === '0.0.0.0' || originHost.endsWith('.local'))) {
      return false;
    }

    // Check root domains (*.smmplan.pro, *.smmflux.ru, *.smmplan.ru)
    for (const root of KNOWN_ROOT_DOMAINS) {
      if (originHost === root || originHost.endsWith('.' + root)) {
        return true;
      }
    }

    // Check dynamic L1 domain registry cache and registered tenant root domains
    if (DomainRegistryService.isKnownRootOrSubdomain(originHost)) {
      return true;
    }

    // In non-production, allow internal/test hosts
    if (!isProd && isInternalHost(originHost)) {
      return true;
    }

    if (ALLOWED_CONTOUR_DOMAINS.has(originHost)) {
      if (isProd && isInternalHost(originHost)) return false;
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function getActiveServerContour(): ContourId {
  if (process.env.CONTOUR === 'test' || process.env.CONTOUR === 'prod' || process.env.CONTOUR === 'flux') {
    return process.env.CONTOUR;
  }
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || process.env.BASE_URL || '';
  if (appUrl) {
    try {
      return resolveContourFromHost(new URL(appUrl).host);
    } catch {
      // Ignore malformed appUrl fallback
    }
  }
  if (process.env.NODE_ENV === 'development') {
    return 'test';
  }
  return 'prod';
}

/**
 * Builds W3C Level 3 CSP header with Strict-Dynamic Nonce (SEC-002 / OWASP ASVS 4.0.3 / PCI DSS 4.0).
 * Strictly excludes 'unsafe-inline' and 'unsafe-eval' from script-src!
 */
export function buildCspHeader(nonce: string, isHttps: boolean, rawIncomingHost: string): string {
  const isDirectIpOrLocal = /^(localhost|127\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|26\.\d+\.\d+\.\d+|0\.0\.0\.0)(:\d+)?$/i.test(rawIncomingHost);
  const shouldUpgradeInsecure = isHttps && !isDirectIpOrLocal;
  const isDev = process.env.NODE_ENV === 'development';

  // Strict-Dynamic Nonce Migration (SEC-002):
  // In production: Strictly NO 'unsafe-inline' and NO 'unsafe-eval'!
  // In development: Allow 'unsafe-eval' solely for React 19 DevTools callstack reconstruction.
  const devEval = isDev ? " 'unsafe-eval'" : '';
  const scriptSrcDirective = `'self' 'nonce-${nonce}' 'strict-dynamic'${devEval} 'sha256-wVBvCaOMJQL3BzklAV+hEw47mOS7LEEOsvxoGI+Kdg4=' https://challenges.cloudflare.com https://static.cloudflareinsights.com https://yookassa.ru https://auth.robokassa.ru https://mc.yandex.ru https://smartcaptcha.yandexcloud.net`;
  const styleSrcDirective = `'self' 'unsafe-inline' https://fonts.googleapis.com`;

  return `
    default-src 'self';
    script-src ${scriptSrcDirective};
    style-src ${styleSrcDirective};
    img-src 'self' blob: data: https:;
    font-src 'self' data: https://fonts.gstatic.com;
    object-src 'none';
    base-uri 'self';
    form-action 'self' https://yookassa.ru https://auth.robokassa.ru https://*.yoomoney.ru;
    frame-ancestors 'self' https://web.telegram.org https://*.telegram.org;
    frame-src 'self' https://t.me https://telegram.org https://*.telegram.org https://challenges.cloudflare.com https://yookassa.ru https://auth.robokassa.ru https://pay.crypt.bot https://smartcaptcha.yandexcloud.net https://*.sberbank.ru https://*.nspk.ru https://*.tinkoff.ru https://*.vtb.ru https://*.yoomoney.ru;
    connect-src 'self' https://challenges.cloudflare.com https://yookassa.ru https://auth.robokassa.ru https://api.cryptobot.org https://api.telegram.org https://pay.crypt.bot https://mc.yandex.ru https://smartcaptcha.yandexcloud.net https://*.sberbank.ru https://*.nspk.ru https://*.tinkoff.ru https://*.vtb.ru;
    report-uri /api/telemetry/csp-report;
    ${shouldUpgradeInsecure ? 'upgrade-insecure-requests;' : ''}
  `.replace(/\s{2,}/g, ' ').trim();
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 0. Strip any client-supplied x-tenant-id to prevent spoofing
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-tenant-id');

  const hostHeader = request.headers.get('host');
  // Take ONLY the first value to defeat duplicate-header concat attacks
  const fwdHostRaw = request.headers.get('x-forwarded-host');
  const fwdHost = fwdHostRaw?.split(',')[0]?.trim() || null;
  const fwdProtoRaw = request.headers.get('x-forwarded-proto');
  const fwdProto = fwdProtoRaw?.split(',')[0]?.trim() || null;

  const rawHostClean = cleanHostString(hostHeader);
  const rawFwdClean = cleanHostString(fwdHost);
  const isSecurityTxt = pathname === '/.well-known/security.txt' || pathname === '/security.txt';

  // Check dynamic domain registry for incoming external host (prioritize external X-Forwarded-Host if behind reverse proxy/docker, else Host)
  const candidateDynamicHost = (rawFwdClean && !isInternalHost(rawFwdClean)) ? rawFwdClean : rawHostClean;
  let dynamicDomainEntry: import('@/services/tenant/domain-registry.service').DomainRegistryEntry | null = null;
  if (candidateDynamicHost && !isInternalHost(candidateDynamicHost)) {
    dynamicDomainEntry = await DomainRegistryService.resolveDomain(candidateDynamicHost);
  } else if (rawHostClean && !isInternalHost(rawHostClean)) {
    dynamicDomainEntry = await DomainRegistryService.resolveDomain(rawHostClean);
  }

  // CORS Whitelist for API routes (CORS-01)
  const origin = request.headers.get('origin');
  let isAllowedOrigin = isAllowedCorsOrigin(origin);
  if (!isAllowedOrigin && origin) {
    try {
      const originHost = cleanHostString(new URL(origin).host);
      if (originHost && !isInternalHost(originHost)) {
        const originEntry = await DomainRegistryService.resolveDomain(originHost);
        if (originEntry && originEntry.isActive) {
          isAllowedOrigin = true;
        }
      }
    } catch {
      // Invalid origin URL
    }
  }

  const isStorefrontApi = pathname.startsWith('/api/storefront/');

  // Handle CORS preflight requests for API routes
  if (pathname.startsWith('/api') && request.method === 'OPTIONS') {
    const preflightHeaders = new Headers();
    if (isStorefrontApi) {
      if (isAllowedOrigin && origin) {
        preflightHeaders.set('Access-Control-Allow-Origin', origin);
        preflightHeaders.set('Access-Control-Allow-Credentials', 'true');
      } else {
        preflightHeaders.set('Access-Control-Allow-Origin', '*');
        // Do not set credentials on public wildcard
      }
      preflightHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      preflightHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id, idempotency-key, x-storefront-key');
      preflightHeaders.set('Access-Control-Max-Age', '86400');
      return new NextResponse(null, { status: 204, headers: preflightHeaders });
    }

    if (isAllowedOrigin && origin) {
      preflightHeaders.set('Access-Control-Allow-Origin', origin);
      preflightHeaders.set('Access-Control-Allow-Credentials', 'true');
      preflightHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      preflightHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id, idempotency-key, x-storefront-key');
      preflightHeaders.set('Access-Control-Max-Age', '86400');
      return new NextResponse(null, { status: 204, headers: preflightHeaders });
    }
    return new NextResponse(null, { status: 204 });
  }

  // EARLY REJECTION — before any host is used for redirects/cookies
  if (!isStorefrontApi && !isSecurityTxt) {
    const isHostAllowed = isKnownOrAllowedHost(rawHostClean) || Boolean(dynamicDomainEntry && dynamicDomainEntry.isActive);
    if (rawHostClean && !isHostAllowed) {
      const allowed = await DomainRegistryService.isDynamicDomainAllowed(rawHostClean);
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden: Invalid Host header' }, { status: 403 });
      }
    }
    const isFwdAllowed = !rawFwdClean || isKnownOrAllowedHost(rawFwdClean) || Boolean(dynamicDomainEntry && dynamicDomainEntry.isActive && (rawFwdClean === dynamicDomainEntry.domain || rawFwdClean === dynamicDomainEntry.customDomain || rawFwdClean === dynamicDomainEntry.slug || rawFwdClean === `www.${dynamicDomainEntry.domain}`)) || (await DomainRegistryService.isDynamicDomainAllowed(rawFwdClean));
    if (rawFwdClean && !isFwdAllowed) {
      return NextResponse.json({ error: 'Forbidden: Invalid X-Forwarded-Host header' }, { status: 403 });
    }
  }

  let host = (fwdHost && !isInternalHost(fwdHost))
    ? fwdHost
    : (hostHeader?.split(',')[0]?.trim() || '');

  const isLocalhost = isPureLocalhost(host);

  if (!isLocalhost && (isInternalHost(host) || !host)) {
    host = process.env.APP_URL ? new URL(process.env.APP_URL).host : 'test.smmplan.pro';
  }
  if (host.includes('0.0.0.0')) {
    host = host.replace('0.0.0.0', 'localhost');
  }

  const proto = fwdProto || (process.env.NODE_ENV === 'production' && !isInternalHost(host) ? 'https' : 'http');
  const originBase = `${proto}://${host}`;

  const resolveRedirectUrl = (target: string | URL): URL => {
    if (target instanceof URL) {
      if (isInternalHost(target.hostname)) {
        return new URL(`${target.pathname}${target.search}${target.hash}`, originBase);
      }
      return target;
    }
    return new URL(target, originBase);
  };

  const LOVABLE_HOSTS = new Set(['lovable.pro', 'www.lovable.pro', 'flux.lovable.pro']);
  const cleanHost = cleanHostString(host);
  if (LOVABLE_HOSTS.has(cleanHost)) {
    const targetUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, 'https://smmflux.ru');
    return NextResponse.redirect(targetUrl, 302);
  }

  const fromQuery = normalizeTenantId(request.nextUrl.searchParams.get('tenant'));
  const fromCookie = normalizeTenantId(request.cookies.get('x_tenant')?.value);
  const fromAdminCookie = normalizeTenantId(request.cookies.get('x_admin_tenant')?.value);
  const fromDynamic = dynamicDomainEntry?.isActive ? dynamicDomainEntry.tenantId : null;
  const fromHost = fromDynamic || normalizeTenantId(resolveTenantFromHostEdge(host));

  let finalTenantId = 'smmplan';
  let isExplicitTenant = false;

  const activeContour = getActiveServerContour();

  const isTailscaleHost = cleanHost.endsWith('.ts.net') || cleanHost.includes('tailscale');
  let isAllowedQueryTenant = true;
  if (fromQuery && activeContour !== 'test' && process.env.NODE_ENV === 'production' && !isLocalhost && !isTailscaleHost) {
    const sessionToken = readSessionTokenFromCookies(request.cookies);
    if (!sessionToken) {
      isAllowedQueryTenant = false;
    } else {
      const payload = await decryptSessionToken(sessionToken);
      if (!payload || payload.role === 'USER') {
        isAllowedQueryTenant = false;
      }
    }
  }

  const isAdminOrOperator = pathname.startsWith('/admin') || pathname.startsWith('/operator');

  // 1. Explicit query parameter override (permitted for staff on prod, or unrestricted on test/localhost)
  if (fromQuery && isAllowedQueryTenant) {
    finalTenantId = fromQuery;
    isExplicitTenant = true;
  }
  // 2. Global Site Switcher for Admin/Operator panels
  else if (fromAdminCookie && isAdminOrOperator && Boolean(readSessionTokenFromCookies(request.cookies))) {
    finalTenantId = fromAdminCookie;
  }
  // 3. Dedicated Domain Resolution (test.smmplan.pro -> smmplan, flux.smmplan.pro -> flux) - ABSOLUTE PRIORITY OVER STALE COOKIES
  else if (fromHost && !isLocalhost && !isTailscaleHost) {
    finalTenantId = fromHost;
  }
  // 4. Local Development / Generic Tunnel Node Cookie Fallback (only on localhost:3000 / 127.0.0.1 or Tailscale)
  else if ((isLocalhost || isTailscaleHost) && fromCookie && !isAdminOrOperator) {
    finalTenantId = fromCookie;
    isExplicitTenant = true;
  }
  // 5. Default Fallback
  else {
    finalTenantId = fromHost || 'smmplan';
  }

  requestHeaders.set('x-tenant-id', finalTenantId);

  // SEC: Authoritative site-mode signal based on proven-valid incoming host
  const originalIncomingHost = cleanHostString(host);
  const isHoldingDomain = originalIncomingHost === 'smmplan.pro' || originalIncomingHost === 'www.smmplan.pro';
  requestHeaders.set('x-site-mode', isHoldingDomain ? 'holding' : 'live');

  const applyStickyCookie = (res: NextResponse) => {
    res.headers.set('x-tenant-id', finalTenantId);
    if (isExplicitTenant) {
      if (isAdminOrOperator) {
        // Staff site selection is saved exclusively in x_admin_tenant, preserving storefront x_tenant
        res.cookies.set('x_admin_tenant', finalTenantId, {
          path: '/',
          httpOnly: false,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 365, // 1 year
        });
      } else {
        // Storefront client cookie
        res.cookies.set('x_tenant', finalTenantId, {
          path: '/',
          httpOnly: false, // Allow client-side QA Dock to switch brands
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 30, // 30 days
        });
      }
    }
    return res;
  };

  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
  const isStressBypass = checkStressOrInternalBypass(request, rawHostClean, clientIp);

  // Webhook Rate Limiter Guard (IP + tenant-scoped for /api/webhooks/*)
  if (pathname.startsWith('/api/webhooks') && !isStressBypass) {
    const webhookPoolKey = `webhook:${clientIp}:${pathname}`;
    const { checkFingerprintPoolLimit } = await import('@/lib/security/ddos-shield/token-bucket-pool');

    const rateLimit = await checkFingerprintPoolLimit(webhookPoolKey, finalTenantId, 60, 60);
    if (!rateLimit.isAllowed) {
      return NextResponse.json(
        { error: 'Webhook rate limit exceeded. Please retry later.' },
        {
          status: 429,
          headers: {
            'Retry-After': '60',
            'X-RateLimit-Limit': '60',
            'X-RateLimit-Remaining': '0',
          },
        }
      );
    }
  }

  // 0.5. Echelon DDoS Shield & Anomaly Inspection (SPEC-2026-09-11 / AUDIT-2026-09-23)
  const isExcludedFromShield = 
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/api/storefront/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/security.txt' ||
    pathname === '/.well-known/security.txt' ||
    pathname === '/api/v1/internal-sync' || // honeypot itself
    pathname === '/api/security/challenge' ||
    pathname === '/api/maintenance-status' ||
    pathname === '/api/health';

  if (!isExcludedFromShield && process.env.DDOS_SHIELD_ENABLED !== 'false') {
    const hasSession = Boolean(readSessionTokenFromCookies(request.cookies));

    // Authorized users with valid session, stress-test bypass, or trusted internal traffic bypass DDoS challenge
    if (!hasSession && !isStressBypass) {
      const { computeHeaderFingerprint, checkClientHintsAnomaly, isWhitelistedGoodBot } = await import('@/lib/security/ddos-shield/fingerprint');
      const isBotWhitelisted = isWhitelistedGoodBot(request.headers);

      if (!isBotWhitelisted) {
        const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '127.0.0.1';
        const fingerprint = computeHeaderFingerprint(request.headers, clientIp);
        const { isBlacklistedDdosTarget } = await import('@/lib/security/ddos-shield/honeypot-service');

        // 1. Blacklist check (Honeypot trap hit)
        const isBlocked = await isBlacklistedDdosTarget(clientIp, fingerprint);
        if (isBlocked) {
          return new NextResponse('Access Blocked by Anti-DDoS Perimeter', { status: 403, headers: { 'Retry-After': '86400' } });
        }

        // 2. Gatekeeper token check
        const gatekeeperCookie = request.cookies.get('__Host-gatekeeper')?.value || request.cookies.get('gatekeeper')?.value;
        let hasValidGatekeeper = false;
        if (gatekeeperCookie) {
          try {
            const { verifyGatekeeperToken } = await import('@/lib/security/ddos-shield/pow-engine');
            const { getShieldSecret } = await import('@/lib/security/ddos-shield/shield-secret');
            const shieldSecret = getShieldSecret();
            const payload = verifyGatekeeperToken(gatekeeperCookie, shieldSecret);
            if (payload) {
              hasValidGatekeeper = true;
            }
          } catch {
            hasValidGatekeeper = false;
          }
        }

        if (!hasValidGatekeeper) {
          const isRscOrAction = request.headers.has('rsc') || request.headers.has('next-action') || request.headers.has('next-router-prefetch');
          const isDocument = request.method === 'GET' && (request.headers.get('sec-fetch-dest') === 'document' || (request.headers.get('accept') || '').includes('text/html'));

          // Only apply browser PoW challenge / pool limits to document navigations.
          // RSC, Server Actions, and prefetch must NOT return 429 JSON/HTML as it triggers Next.js MPA hard reload.
          if (isDocument) {
            const anomaly = checkClientHintsAnomaly(request.headers);
            const { checkFingerprintPoolLimit } = await import('@/lib/security/ddos-shield/token-bucket-pool');
            const poolKey = `${clientIp}:${fingerprint}`;
            const poolStatus = await checkFingerprintPoolLimit(poolKey, finalTenantId, 120, 60);

            if (anomaly.isAnomalous || !poolStatus.isAllowed) {
              const { renderPowChallengeHtml } = await import('@/lib/security/ddos-shield/challenge-page');
              return new NextResponse(renderPowChallengeHtml(), {
                status: 429,
                headers: {
                  'Content-Type': 'text/html; charset=utf-8',
                  'Retry-After': '5',
                },
              });
            }
          } else if (isRscOrAction) {
            // For RSC and Server Actions, apply a high burst per-IP rate limit (300 req/min) to prevent flooding without breaking SPA navigation
            const { checkFingerprintPoolLimit } = await import('@/lib/security/ddos-shield/token-bucket-pool');
            const actionPoolKey = `rsc:${clientIp}:${fingerprint}`;
            const actionPool = await checkFingerprintPoolLimit(actionPoolKey, finalTenantId, 300, 60);
            if (!actionPool.isAllowed) {
              return NextResponse.json(
                { error: 'Rate limit exceeded. Please wait a moment.' },
                { status: 429, headers: { 'Retry-After': '10' } }
              );
            }
          }
        }
      }
    }
  }

  // Strict validation against current active server contour (TRUSTED_CONTOUR_MAP)
  const allowedForContour = TRUSTED_CONTOUR_MAP[activeContour];
  const effectiveHost = (rawFwdClean && !isInternalHost(rawFwdClean)) ? rawFwdClean : rawHostClean;
  const isVerifiedDynamicDomain = Boolean(dynamicDomainEntry && dynamicDomainEntry.isActive);

  if (!isStorefrontApi && effectiveHost && allowedForContour && !isInternalHost(effectiveHost) && !allowedForContour.has(effectiveHost) && !isVerifiedDynamicDomain && !isSecurityTxt) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Forbidden: Host not permitted for active server contour' },
        { status: 403 }
      );
    }
  }

  // 1. Instant UI Logout Interception (/logout or /api/auth/logout)
  if (pathname === '/logout' || pathname === '/api/auth/logout') {
    const isApi = pathname.startsWith('/api/');
    const isFetch = request.headers.get('sec-fetch-mode') === 'cors' || 
                    request.headers.get('accept')?.includes('application/json') ||
                    request.headers.get('content-type')?.includes('application/json') ||
                    request.method === 'POST';

    if (!isApi || !isFetch) {
      const res = NextResponse.redirect(resolveRedirectUrl(ROUTES.AUTH.LOGIN), 307);
      res.cookies.set('explicit_logout', 'true', {
        path: '/',
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 5, // 5 minutes
      });
      clearSessionCookiesOnResponse(res);
      return applyStickyCookie(res);
    }
  }

  // 1.5 Production Maintenance Gate
  // Activated strictly only if MAINTENANCE_MODE is explicitly set to 'true' in env
  const isMaintenanceActive = process.env.MAINTENANCE_MODE === 'true';

  if (isMaintenanceActive) {
    const isAllowedMaintenancePath = 
      pathname === '/' ||
      pathname === '/prelaunch' ||
      pathname === '/robots.txt' ||
      pathname === '/sitemap.xml' ||
      pathname === '/security.txt' ||
      pathname.startsWith('/.well-known/') ||
      pathname === '/api/health' ||
      pathname === '/api/maintenance-status' ||
      pathname === '/api/prelaunch/subscribe' ||
      pathname === '/api/webhooks' ||
      pathname.startsWith('/api/webhooks/') ||
      pathname.startsWith('/_next/') ||
      pathname.startsWith('/images/') ||
      pathname === '/favicon.ico';

    if (!isAllowedMaintenancePath) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Service Unavailable - Platform under maintenance' },
          { status: 503, headers: { 'Retry-After': '3600' } }
        );
      }
      return applyStickyCookie(NextResponse.redirect(resolveRedirectUrl('/')));
    }
  }

  // 2. Check legacy redirects
  const normalizedPath = pathname.length > 1 && pathname.endsWith('/') ? pathname.replace(/\/+$/, '') : pathname;
  const newPath = legacyRedirects[pathname] || legacyRedirects[normalizedPath];
  if (newPath) {
    const redirectUrl = resolveRedirectUrl(newPath);
    if (newPath.includes('#')) {
      const [pathPart, hashPart] = newPath.split('#');
      redirectUrl.pathname = pathPart;
      redirectUrl.hash = hashPart;
    }
    return NextResponse.redirect(redirectUrl, 301); // 301 Permanent Redirect
  }

  // 4. Auth Route Protection & N-10.5 Strict Redirection
  const protectedPaths = ['/admin', '/dashboard', '/operator'];
  if (protectedPaths.some(p => pathname.startsWith(p))) {
    const sessionToken = readSessionTokenFromCookies(request.cookies);
    const isRSC = request.headers.has('rsc') || request.headers.has('next-action');
    if (!sessionToken) {
      if (isRSC) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const res = NextResponse.redirect(resolveRedirectUrl(ROUTES.AUTH.LOGIN), 307);
      clearSessionCookiesOnResponse(res);
      return applyStickyCookie(res);
    }

    const payload = await decryptSessionToken(sessionToken);
    const isCustomer = payload?.role === 'USER';
    const isStaffRole = !isCustomer && Boolean(payload?.userId);
    const isAdminPath = pathname.startsWith('/admin');
    const isOperatorPath = pathname.startsWith('/operator');

    const payloadAllowedTenants = Array.isArray(payload?.allowedTenants)
      ? payload.allowedTenants.map((t: unknown) => normalizeTenantId(t as string))
      : [normalizeTenantId(payload?.tenantId as string)];

    // Enforce tenant isolation for regular users
    const isTenantMismatch = isCustomer && !isStaffRole && !isAdminPath && !isOperatorPath && (!payload || normalizeTenantId(payload.tenantId as string) !== finalTenantId);

    // Enforce tenant isolation for staff (block access if tenant not in allowedTenants, except for global OWNER)
    const isStaffTenantMismatch = isStaffRole && (isAdminPath || isOperatorPath) && payload?.role !== 'OWNER' && !payloadAllowedTenants.includes(finalTenantId);

    // Enforce contour matching in JWT (tokens issued in test contour cannot be used in prod contour)
    const currentContour = resolveContourFromHost(host);
    const tokenContour = (payload?.contour as ContourId) || (normalizeTenantId(payload?.tenantId as string) === 'flux' ? 'flux' : 'test');
    const isContourMismatch = !isLocalhost && tokenContour !== currentContour && (tokenContour === 'prod' || currentContour === 'prod' || tokenContour === 'flux' || currentContour === 'flux');

    if (!payload || isTenantMismatch || isContourMismatch || isStaffTenantMismatch) {
      if (isRSC) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const response = NextResponse.redirect(resolveRedirectUrl(ROUTES.AUTH.LOGIN), 307);
      clearSessionCookiesOnResponse(response);
      return applyStickyCookie(response);
    }

    // Role verification for /admin and /operator:
    // Fast-reject explicit customers at edge; staff (role: undefined per P2-10) passes to Server Component for DB-backed RBAC
    if (isAdminPath) {
      if (isCustomer) {
        if (isRSC) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        return applyStickyCookie(NextResponse.redirect(resolveRedirectUrl(ROUTES.DASHBOARD.HOME), 307));
      }
    }

    if (isOperatorPath) {
      if (isCustomer) {
        if (isRSC) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        return applyStickyCookie(NextResponse.redirect(resolveRedirectUrl(ROUTES.DASHBOARD.HOME), 307));
      }
    }
  }

  // Set headers for layout detection and tenant isolation
  const rawIncomingHost = fwdHost || hostHeader || cleanHost;
  requestHeaders.set('x-pathname', pathname);
  requestHeaders.set('x-host', rawIncomingHost);
  requestHeaders.set('x-forwarded-host', rawIncomingHost);

  const incomingProto = request.headers.get('x-forwarded-proto') || request.nextUrl.protocol || '';
  const isHttps = incomingProto.includes('https');
  const isDirectIpOrLocal = /^(localhost|127\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|26\.\d+\.\d+\.\d+|0\.0\.0\.0)(:\d+)?$/i.test(rawIncomingHost);
  const shouldUpgradeInsecure = isHttps && !isDirectIpOrLocal;

  // Generate cryptographic Nonce for strict-dynamic CSP (V-05 / SEC-002) for non-API requests
  let nonce = '';
  let cspHeader = '';
  if (!pathname.startsWith('/api/')) {
    nonce = Buffer.from(crypto.randomUUID()).toString('base64');
    requestHeaders.set('x-nonce', nonce);
    cspHeader = buildCspHeader(nonce, isHttps, rawIncomingHost);
    requestHeaders.set('Content-Security-Policy', cspHeader);
  }

  // Handle ref cookie if present in URL query
  const ref = request.nextUrl.searchParams.get('ref');
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Inject CORS headers for API routes when requested with an allowed origin
  if (isStorefrontApi) {
    if (isAllowedOrigin && origin) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    } else {
      response.headers.set('Access-Control-Allow-Origin', '*');
      // Do not set credentials on public wildcard
    }
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id, idempotency-key, x-storefront-key');
  } else if (pathname.startsWith('/api') && isAllowedOrigin && origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-tenant-id, idempotency-key, x-storefront-key');
  }

  response.headers.set('x-tenant-id', finalTenantId);
  if (nonce) {
    response.headers.set('x-nonce', nonce);
  }
  if (cspHeader) {
    response.headers.set('Content-Security-Policy', cspHeader);
  }
  if (shouldUpgradeInsecure) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  response.headers.set('X-DNS-Prefetch-Control', 'on');

  // Inject X-Robots-Tag for sensitive routes to prevent indexing
  if (['/admin', '/dashboard', '/operator', '/api'].some(p => pathname.startsWith(p))) {
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  if (ref) {
    response.cookies.set('ref', ref, {
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
  }

  return applyStickyCookie(response);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
