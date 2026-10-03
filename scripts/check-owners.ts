import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const users = await db.user.findMany({
    where: {
      email: {
        in: ['nikita8888@inbox.ru', 'art@artmspektr.ru']
      }
    },
    select: {
      id: true,
      email: true,
      role: true,
      balance: true,
      isActive: true
    }
  });
  console.log('Owners in DB:', users);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
