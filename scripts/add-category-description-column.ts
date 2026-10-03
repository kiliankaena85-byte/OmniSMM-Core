import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  console.log('Adding description column to Category table...');
  await db.$executeRawUnsafe(`ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "description" TEXT;`);
  console.log('✅ Column Category.description added successfully!');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  });
