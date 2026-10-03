import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const url = 'https://prskill.ru/api';
  const key = '682ebc7ebd6fc4c432711b3658b8405c';
  const actions = [
    'balance', 'user_balance', 'get_balance', 'profile', 'status', 'add', 
    'order', 'create', 'account', 'info', 'me', 'rates', 'user', 'users',
    'wallet', 'client', 'getbalance', 'check_balance'
  ];

  for (const action of actions) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ key, action }),
        signal: AbortSignal.timeout(3000)
      });
      const text = await res.text();
      console.log(`action=${action} -> HTTP ${res.status}: ${text.slice(0, 120)}`);
    } catch (e: any) {
      console.log(`action=${action} -> error: ${e.message}`);
    }
  }
}

main().catch(console.error);
