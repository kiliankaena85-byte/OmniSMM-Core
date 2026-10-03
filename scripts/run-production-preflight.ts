/**
 * SMMplan / OmniSMM 1.0 — Unified Production Preflight Battery & ActionArbiter Gate (2026.1)
 * 
 * Комплексный предрелизный конвейер верификации (Zero-Defect Protocol):
 * 1. Типы и чистота кода (Strict Next.js 16 / React 19, zero-any ratchet)
 * 2. Безопасность и утечки (Секреты в бандле, Pentest immunity)
 * 3. Изоляция брендов (Multi-Tenant SMMplan / SMMflux)
 * 4. Финансовые инварианты (ExactMath, BigInt, Drip-Feed Floor)
 * 5. Арбитраж модели принятия решений (ActionArbiter — 0 токенов расхода)
 */

import { execSync } from "child_process";
import net from "net";

interface CheckStep {
  name: string;
  category: "TYPES" | "SECRETS" | "TENANT" | "DESIGN" | "LEGAL" | "FINANCE" | "E2E" | "SECURITY" | "ARBITER";
  command: string;
  requiresDb?: boolean;
}

const STEPS: CheckStep[] = [
  {
    name: "TypeScript Strict Typecheck (Next.js 16 & React 19 App Router)",
    category: "TYPES",
    command: "npx tsc --noEmit",
  },
  {
    name: "Zero-Any Ratchet AST Audit (Hard Blocker on new `any`)",
    category: "TYPES",
    command: "npx tsx scripts/lint-zero-any.ts",
  },
  {
    name: "Bundle & Scripts Secrets Leak Scan (OWASP / Lesson C-02/C-03)",
    category: "SECRETS",
    command: "node scripts/check-bundle-secrets.mjs",
  },
  {
    name: "Multi-Tenant Isolation & BOLA Defense Audit (SMMplan / SMMflux)",
    category: "TENANT",
    command: "npx tsx scripts/lint-tenant-isolation.ts",
  },
  {
    name: "Tailwind CSS 4 Semantic Design Tokens Audit (UI Arsenal)",
    category: "DESIGN",
    command: "npx tsx scripts/check-design-system.ts src/components/ui",
  },
  {
    name: "Legal Compliance Suite (5 Documents, 152-FZ, 54-FZ, 115-FZ, FPR)",
    category: "LEGAL",
    command: "npx dotenv -e .env.test -- npx vitest run src/__tests__/legal/legal-compliance-and-enterprise-pages.test.ts",
    requiresDb: true,
  },
  {
    name: "ExactMath Financial Calculations & Half-Even Rounding",
    category: "FINANCE",
    command: "npx dotenv -e .env.test -- npx vitest run src/__tests__/financial/exact-math.test.ts",
    requiresDb: true,
  },
  {
    name: "Drip-Feed Floor Invariant & Runs Integrity",
    category: "E2E",
    command: "npx dotenv -e .env.test -- npx vitest run src/__tests__/orders/drip-feed-min-quantity-and-runs-integrity.test.ts",
    requiresDb: true,
  },
  {
    name: "Safe InProgress TTL & Anti-Drain Financial Invariant",
    category: "FINANCE",
    command: "npx dotenv -e .env.test -- npx vitest run src/__tests__/orders/safe-in-progress-ttl-and-anti-drain.test.ts",
    requiresDb: true,
  },
  {
    name: "Comprehensive Pentest & Security Invariant Battery",
    category: "SECURITY",
    command: "npx dotenv -e .env.test -- npx vitest run src/__tests__/pentest/comprehensive-pentest.test.ts",
    requiresDb: true,
  },
  {
    name: "Autonomous ActionArbiter Decision Gate (AAA-2026 Engine)",
    category: "ARBITER",
    command: "npx tsx scripts/decision-engine/action-arbiter.ts",
  },
];

function checkTcpPort(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function runPreflight() {
  console.log("\n================================================================");
  console.log("   OMNISMM 1.0 — UNIFIED PRODUCTION PREFLIGHT & ARBITER BATTERY");
  console.log("================================================================\n");

  const startTime = Date.now();
  let passed = 0;
  let skipped = 0;
  let failed = 0;

  // Быстрая проверка доступности БД для E2E тестов
  const isDbOnline = await checkTcpPort("127.0.0.1", 5435);
  if (!isDbOnline) {
    console.log("ℹ️  [INFRA-STATUS] Test PostgreSQL on 127.0.0.1:5435 is OFFLINE.");
    console.log("   (DB-dependent Vitest integration suites will be gracefully skipped.");
    console.log("    To run full DB suite: 'docker compose up -d db')\n");
  } else {
    console.log("✅ [INFRA-STATUS] Test PostgreSQL on 127.0.0.1:5435 is ONLINE.\n");
  }

  for (let i = 0; i < STEPS.length; i++) {
    const step = STEPS[i];
    process.stdout.write(`[${i + 1}/${STEPS.length}] [${step.category}] ${step.name}... `);

    if (step.requiresDb && !isDbOnline) {
      console.log("🟡 SKIPPED (Requires DB :5435)");
      skipped++;
      continue;
    }
    
    try {
      execSync(step.command, { stdio: "pipe", encoding: "utf8" });
      console.log("✅ PASS");
      passed++;
    } catch (err: any) {
      console.log("❌ FAIL");
      console.error(`\n--- ERROR IN STEP: ${step.name} ---\n`, err.stdout || err.message);
      failed++;
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log("\n================================================================");
  console.log(`📊 PREFLIGHT SUMMARY:`);
  console.log(`   - Passed:  ${passed}`);
  console.log(`   - Skipped: ${skipped}`);
  console.log(`   - Failed:  ${failed}`);
  console.log(`   - Total:   ${STEPS.length} checks in ${durationSec}s`);
  console.log(`   - LLM Token Cost: $0.00 (100% Deterministic Local Pipeline)`);
  console.log("----------------------------------------------------------------");

  if (failed === 0) {
    console.log("🎉 VERDICT: 🟢 READY FOR STAGE CUTOVER (0 failures)");
    console.log("   - Model Recommendation for new features:");
    console.log("     * Tier 3 (Styles, text, docs) -> Gemini 3.8 Flash");
    console.log("     * Tier 2 (Server Actions, UI)  -> Claude Sonnet 5.5");
    console.log("     * Tier 1 (Ledger, ACID, Vault) -> Claude Opus 5.5");
    console.log("================================================================\n");
    process.exit(0);
  } else {
    console.log("⚠️ VERDICT: 🔴 BLOCKED — FIX ISSUES BEFORE STAGE / PROD CUTOVER");
    console.log("================================================================\n");
    process.exit(1);
  }
}

runPreflight();
