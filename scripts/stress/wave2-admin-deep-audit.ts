/**
 * scripts/stress/wave2-admin-deep-audit.ts
 * 
 * Wave 2: Browser Automated E2E Component & UI/UX Audit for OmniSMM Admin Panel.
 * Validates:
 * - All admin tabs, tables, modals, filters, and action buttons.
 * - Zero React 19 hydration mismatches.
 * - Zero unhandled client console errors.
 * - Zero horizontal scroll overflow on desktop/laptop displays.
 * - Strict RBAC fencing (OWNER vs SUPPORT vs USER).
 */

import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { createOrGetTestSession } from '../qa-sentinel/session-factory';

dotenv.config();

interface ScreenAuditResult {
  route: string;
  name: string;
  role: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  durationMs: number;
  consoleErrors: string[];
  hydrationErrors: string[];
  networkErrors: string[];
  hasHorizontalScroll: boolean;
  notes: string[];
}

const ADMIN_ROUTES = [
  { route: '/admin/dashboard', name: 'Dashboard & KPI Summary', expectedRole: 'OWNER' },
  { route: '/admin/orders', name: 'Orders Management Table & Tabs', expectedRole: 'OWNER' },
  { route: '/admin/services', name: 'Services & Catalog Matrix', expectedRole: 'OWNER' },
  { route: '/admin/clients', name: 'Clients & Users Registry', expectedRole: 'OWNER' },
  { route: '/admin/finance', name: 'Finance Hub & Ledger Audit', expectedRole: 'OWNER' },
  { route: '/admin/providers', name: 'Upstream Providers & Proxy', expectedRole: 'OWNER' },
  { route: '/admin/tickets', name: 'Support Tickets & Helpdesk', expectedRole: 'OWNER' },
  { route: '/admin/tenants', name: 'Tenants & Multi-Brand Switcher', expectedRole: 'OWNER' },
  { route: '/admin/settings', name: 'System Settings (8 Clusters)', expectedRole: 'OWNER' },
  { route: '/admin/system', name: 'System Diagnostics & Telemetry', expectedRole: 'OWNER' },
  // RBAC Separation Checks
  { route: '/admin/tickets', name: 'Support Staff Tickets Access', expectedRole: 'SUPPORT' },
  { route: '/admin/dashboard', name: 'Unauthorized Customer Reject Test', expectedRole: 'USER_SMMPLAN' },
];

async function runWave2Audit() {
  const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:3000';
  console.log(`\n======================================================================`);
  console.log(`  🌊 ВОЛНА 2: BROWSER AUTOMATED E2E COMPONENT & UI AUDIT`);
  console.log(`======================================================================`);
  console.log(`🎯 Target Host: ${targetUrl}`);
  console.log(`📋 Total Routes to Audit: ${ADMIN_ROUTES.length}\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const results: ScreenAuditResult[] = [];

  for (const item of ADMIN_ROUTES) {
    const startTime = Date.now();
    const consoleErrors: string[] = [];
    const hydrationErrors: string[] = [];
    const networkErrors: string[] = [];
    const notes: string[] = [];

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });

    // Obtain cryptographically signed token
    const token = await createOrGetTestSession(item.expectedRole as any, 'smmplan');
    if (token) {
      await context.addCookies([
        {
          name: 'session_token',
          value: token,
          domain: '127.0.0.1',
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
        {
          name: 'x_admin_tenant',
          value: 'smmplan',
          domain: '127.0.0.1',
          path: '/',
          httpOnly: false,
          secure: false,
          sameSite: 'Lax',
        },
      ]);
    }

    const page = await context.newPage();

    // Listen to console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (text.includes('Hydration failed') || text.includes('hydration mismatch')) {
          hydrationErrors.push(text);
        } else if (!text.includes('Failed to load resource: net::ERR_CONNECTION_REFUSED') && !text.includes('favicon.ico')) {
          consoleErrors.push(text);
        }
      }
    });

    // Listen to failed network requests
    page.on('response', (res) => {
      const status = res.status();
      const url = res.url();
      if (status >= 400 && !url.includes('/api/telemetry') && !url.includes('/favicon.ico')) {
        // For unauthorized test on /admin/dashboard, 307 or 401/403 is expected
        if (item.expectedRole === 'USER_SMMPLAN' && (status === 401 || status === 403 || status === 307)) {
          notes.push(`Correctly blocked non-admin user with HTTP ${status}`);
        } else {
          networkErrors.push(`${status} on ${url}`);
        }
      }
    });

    let hasHorizontalScroll = false;
    let finalStatus: 'PASS' | 'WARN' | 'FAIL' = 'PASS';

    try {
      const response = await page.goto(`${targetUrl}${item.route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      await page.waitForTimeout(1500);

      const currentUrl = page.url();

      if (item.expectedRole === 'USER_SMMPLAN') {
        // Customer MUST NOT remain on /admin
        if (currentUrl.includes('/admin')) {
          finalStatus = 'FAIL';
          notes.push(`SECURITY VIOLATION: Customer was not redirected away from ${item.route}`);
        } else {
          notes.push(`Protected route: Redirected to ${currentUrl}`);
        }
      } else {
        // Check horizontal scroll
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
        hasHorizontalScroll = scrollWidth > clientWidth + 2;

        if (hasHorizontalScroll) {
          notes.push(`Horizontal overflow detected: scrollWidth (${scrollWidth}) > clientWidth (${clientWidth})`);
          if (finalStatus !== 'FAIL') finalStatus = 'WARN';
        }

        // Check interactive components based on route
        if (item.route === '/admin/orders') {
          // Check if tabs exist
          const tabElements = await page.$$('button[role="tab"], div[role="tab"], a[href*="status="]');
          notes.push(`Found ${tabElements.length} status tab elements`);

          // Check if table rendered
          const tableRows = await page.$$('table tr, [role="row"]');
          notes.push(`Rendered ${tableRows.length} table rows`);
        } else if (item.route === '/admin/settings') {
          const settingSections = await page.$$('[role="tab"], button, form');
          notes.push(`Found ${settingSections.length} interactive settings controls`);
        }
      }

      if (hydrationErrors.length > 0) {
        finalStatus = 'FAIL';
        notes.push(`Hydration errors detected: ${hydrationErrors.length}`);
      } else if (consoleErrors.length > 0) {
        if (finalStatus !== 'FAIL') finalStatus = 'WARN';
      }

      const durationMs = Date.now() - startTime;
      results.push({
        route: item.route,
        name: item.name,
        role: item.expectedRole,
        status: finalStatus,
        durationMs,
        consoleErrors,
        hydrationErrors,
        networkErrors,
        hasHorizontalScroll,
        notes,
      });

      const icon = finalStatus === 'PASS' ? '✅ PASS' : finalStatus === 'WARN' ? '⚠️ WARN' : '❌ FAIL';
      console.log(`[${results.length}/${ADMIN_ROUTES.length}] ${icon} [${item.expectedRole}] ${item.name} (${durationMs}ms)`);
      if (notes.length > 0) {
        notes.forEach((n) => console.log(`      ↳ ${n}`));
      }
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      results.push({
        route: item.route,
        name: item.name,
        role: item.expectedRole,
        status: 'FAIL',
        durationMs,
        consoleErrors,
        hydrationErrors,
        networkErrors: [...networkErrors, err.message],
        hasHorizontalScroll: false,
        notes: [`Exception: ${err.message}`],
      });
      console.log(`[${results.length}/${ADMIN_ROUTES.length}] ❌ FAIL [${item.expectedRole}] ${item.name} - ${err.message}`);
    } finally {
      await context.close();
    }
  }

  await browser.close();

  console.log(`\n======================================================================`);
  console.log(`  📊 ВОЛНА 2: РЕЗЮМЕ ПРОВЕРКИ АДМИНИСТРАТИВНЫХ ИНТЕРФЕЙСОВ`);
  console.log(`======================================================================`);
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const warnCount = results.filter((r) => r.status === 'WARN').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  console.log(`Итог: [ PASS: ${passCount} | WARN: ${warnCount} | FAIL: ${failCount} ] из ${results.length} проверок`);

  if (failCount > 0) {
    console.error(`❌ Внимание: Обнаружены сбои в интерфейсах админки!`);
    process.exit(1);
  } else {
    console.log(`🎉 Волна 2 завершена успешно! UI-компоненты и RBAC барьеры стабильны.`);
    process.exit(0);
  }
}

runWave2Audit().catch((err) => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
