import 'dotenv/config';
import { CatalogLockGuard } from '../src/lib/catalog-lock';
import { db } from '../src/lib/db';

async function main() {
  const args = process.argv.slice(2);
  const action = args[0] || 'status';

  // Support --by=email parameter
  const byArg = args.find(a => a.startsWith('--by='));
  const operatorEmail = byArg ? byArg.replace('--by=', '') : 'admin@smmplan.pro';

  if (action === 'lock') {
    await CatalogLockGuard.lockCatalog(operatorEmail);
    console.log(`🔒 Catalog and Database have been successfully LOCKED (INVIOLABLE) by ${operatorEmail}.`);
    console.log('   Administrators (roles ADMIN and OWNER) retain full control via the Admin Panel.');
    console.log('   Automated seeders, reset scripts, and background worker category mutations are BLOCKED.');
  } else if (action === 'unlock') {
    const nonFlagArgs = args.slice(1).filter(a => !a.startsWith('--'));
    const reason = nonFlagArgs.join(' ') || 'Manual administrator override';
    await CatalogLockGuard.unlockCatalog(operatorEmail, reason);
    console.log(`🔓 Catalog has been UNLOCKED by ${operatorEmail}. Reason: ${reason}`);
    console.log('   Remember to re-lock the catalog after completing maintenance: npx tsx scripts/lock-database.ts lock');
  } else {
    const isLocked = await CatalogLockGuard.isLocked();
    const catCount = await db.category.count();
    const srvCount = await db.service.count();
    console.log('=== DATABASE INVIOLABILITY & CATALOG LOCK STATUS ===');
    console.log(`Status: ${isLocked ? '🔒 LOCKED (INVIOLABLE)' : '🔓 UNLOCKED'}`);
    console.log(`Configured Categories: ${catCount}`);
    console.log(`Configured Services: ${srvCount}`);
    console.log(`Authorized Managers: ADMIN, OWNER, and staff with CATALOG edit permissions`);
    console.log(`Protected from: Automated seeders, test resets, background worker category wipes`);
    console.log('====================================================');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
