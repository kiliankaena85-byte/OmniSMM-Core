import { db } from '../src/lib/db';

async function main() {
  const targetEmails = ['nikita8888@inbox.ru', 'art@artmspektr.ru'];
  
  console.log('🔍 Checking target users:', targetEmails);

  const users = await db.user.findMany({
    where: {
      email: { in: targetEmails }
    },
    select: {
      id: true,
      email: true,
      role: true,
      balance: true,
      tenantId: true,
      passwordHash: true,
      createdAt: true
    }
  });

  console.log('Found users:', users);

  const missingEmails = targetEmails.filter(
    email => !users.some(u => u.email.toLowerCase() === email.toLowerCase())
  );

  console.log('Missing users:', missingEmails);

  const allOwners = await db.user.findMany({
    where: { role: 'OWNER' },
    select: { id: true, email: true, role: true, tenantId: true }
  });
  console.log('Current OWNER users in DB:', allOwners);
}

main().catch(console.error).finally(() => process.exit(0));
