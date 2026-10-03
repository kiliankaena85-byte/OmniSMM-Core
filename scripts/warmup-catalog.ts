/**
 * scripts/warmup-catalog.ts
 * Pre-warms all 48 active categories and services into Redis and L1 RAM cache.
 * Eliminates cold-start latency for all storefront service selections.
 */

// Mock server-only before imports
try {
  const serverOnlyPath = require.resolve('server-only');
  require.cache[serverOnlyPath] = {
    id: serverOnlyPath,
    filename: serverOnlyPath,
    loaded: true,
    exports: {}
  } as any;
} catch {}

import { db } from '../src/lib/db';
import { getServicesByCategoryAction, getPublicCatalogAction } from '../src/actions/order/catalog';
import { logger } from '../src/lib/logger';

async function warmupCatalog() {
  const startTime = Date.now();
  console.log('🚀 [WARMUP] Starting complete catalog and services warmup...');

  const catalogRes = await getPublicCatalogAction('smmplan');
  if (!catalogRes.success || !catalogRes.data) {
    console.error('❌ Failed to fetch public catalog');
    process.exit(1);
  }

  const networks = catalogRes.data;
  console.log(`📦 Found ${networks.length} active networks`);

  let totalCategories = 0;
  let totalServices = 0;

  for (const net of networks) {
    console.log(`\n🌐 Network: ${net.name} (${net.categories.length} categories)`);
    for (const cat of net.categories) {
      totalCategories++;
      const catStart = Date.now();
      const svcs = await getServicesByCategoryAction(cat.id, 'smmplan');
      totalServices += svcs.length;
      console.log(`   └─ 📁 [${cat.name}]: ${svcs.length} services cached in ${Date.now() - catStart}ms`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✅ [WARMUP COMPLETE] ${totalNetworks(networks)} networks, ${totalCategories} categories, ${totalServices} services pre-cached in ${duration}s!`);
  process.exit(0);
}

function totalNetworks(nets: any[]) {
  return nets.length;
}

warmupCatalog().catch((err) => {
  console.error('❌ Warmup failed:', err);
  process.exit(1);
});
