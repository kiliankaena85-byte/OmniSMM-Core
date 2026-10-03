import { db } from '../src/lib/db';

async function main() {
  console.log('👑 Configuring OWNER roles in database...');

  const ownersToSet = [
    { email: 'nikita8888@inbox.ru' },
    { email: 'art@artmspektr.ru' },
  ];

  for (const { email } of ownersToSet) {
    const cleanEmail = email.toLowerCase().trim();
    const existing = await db.user.findFirst({
      where: { email: cleanEmail }
    });

    if (existing) {
      const updated = await db.user.update({
        where: { id: existing.id },
        data: {
          role: 'OWNER',
          tenantId: 'smmplan',
          isActive: true,
          isEmailVerified: true
        }
      });
      console.log(`✅ Updated existing user to OWNER: ${updated.email} (id: ${updated.id}, role: ${updated.role})`);
    } else {
      const created = await db.user.create({
        data: {
          email: cleanEmail,
          role: 'OWNER',
          balance: 10000000n, // 100,000 ₽ initial test balance in kopecks
          tenantId: 'smmplan',
          isActive: true,
          isEmailVerified: true
        }
      });
      console.log(`🎉 Created new OWNER user: ${created.email} (id: ${created.id}, role: ${created.role})`);
    }
  }

  const allOwners = await db.user.findMany({
    where: { role: 'OWNER' },
    select: { id: true, email: true, role: true, balance: true, tenantId: true }
  });
  console.log('\n📋 All active OWNER users in DB:');
  console.table(allOwners.map(o => ({
    id: o.id,
    email: o.email,
    role: o.role,
    balanceRub: Number(o.balance) / 100,
    tenantId: o.tenantId
  })));
}

main()
  .catch((err) => {
    console.error('❌ Failed to set owners:', err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(0);
  });
