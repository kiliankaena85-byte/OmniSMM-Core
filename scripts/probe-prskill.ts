import dotenv from 'dotenv';
dotenv.config();

async function probeUrl(url: string, key: string) {
  console.log(`\nTesting URL: ${url}`);
  
  // Test balance
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key, action: 'balance' }),
      signal: AbortSignal.timeout(10000)
    });
    console.log(`Balance status: ${res.status}`);
    const text = await res.text();
    console.log(`Balance body: ${text.slice(0, 300)}`);
  } catch (err: any) {
    console.error(`Balance error on ${url}:`, err.message);
  }

  // Test services
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key, action: 'services' }),
      signal: AbortSignal.timeout(15000)
    });
    console.log(`Services status: ${res.status}`);
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (Array.isArray(json)) {
        console.log(`Services array length: ${json.length}`);
        if (json.length > 0) {
          console.log(`Sample service:`, JSON.stringify(json[0], null, 2));
        }
      } else {
        console.log(`Services non-array JSON:`, JSON.stringify(json).slice(0, 300));
      }
    } catch {
      console.log(`Services raw text: ${text.slice(0, 300)}`);
    }
  } catch (err: any) {
    console.error(`Services error on ${url}:`, err.message);
  }
}

async function main() {
  const key = '682ebc7ebd6fc4c432711b3658b8405c';
  await probeUrl('https://prskill.ru/api', key);
  await probeUrl('https://prskill.ru/api/v2', key);
}

main().catch(console.error);
