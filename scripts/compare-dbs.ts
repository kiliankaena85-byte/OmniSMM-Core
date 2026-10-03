import { PrismaClient } from '@prisma/client';

async function inspect(url: string, label: string) {
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const catsCount = await p.category.count();
    const srvsCount = await p.service.count();
    const providersCount = await p.provider.count();
    const ordersCount = await p.order.count();
    const usersCount = await p.user.count();

    console.log(`\n=== Database: ${label} ===`);
    console.log(`URL: ${url}`);
    console.log(`Categories: ${catsCount}`);
    console.log(`Services: ${srvsCount}`);
    console.log(`Providers: ${providersCount}`);
    console.log(`Orders: ${ordersCount}`);
    console.log(`Users: ${usersCount}`);

    const cats = await p.category.findMany({
      take: 10,
      orderBy: { sort: 'asc' },
      include: { network: true }
    });
    console.log(`Sample categories in ${label}:`);
    for (const c of cats) {
      console.log(` - [${c.network?.name}] id=${c.id}, sort=${c.sort}, name="${c.name}", slug=${c.slug}`);
    }
  } catch (err: any) {
    console.error(`Error connecting to ${label}:`, err.message);
  } finally {
    await p.$disconnect();
  }
}

async function main() {
  await inspect('postgresql://postgres:postgres@127.0.0.1:5435/smmplan_lite?schema=public', 'smmplan_lite (PRODUCTION)');
  await inspect('postgresql://postgres:postgres@127.0.0.1:5435/smmplan_test?schema=public', 'smmplan_test (TEST)');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
