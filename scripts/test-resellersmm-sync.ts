import dotenv from 'dotenv';
dotenv.config();

import { db } from '../src/lib/db';
import { providerService } from '../src/services/providers/provider.service';

async function main() {
  const provider = await db.provider.findFirst({
    where: { name: 'ResellerSMM' }
  });

  if (!provider) {
    console.error('ResellerSMM provider not found in DB!');
    process.exit(1);
  }

  console.log('Testing provider instance for:', provider.name, provider.id);
  const instance = await providerService.getProviderInstance(provider);

  console.log('Fetching balance via provider instance...');
  const balance = await instance.getBalance();
  console.log('Balance result:', balance);

  console.log('Fetching services via provider instance...');
  const services = await instance.getServices();
  console.log('Services count:', Array.isArray(services) ? services.length : 'not array');
  if (Array.isArray(services) && services.length > 0) {
    console.log('Sample service:', JSON.stringify(services[0], null, 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
