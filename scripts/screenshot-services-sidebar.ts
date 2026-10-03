import { chromium } from 'playwright';
import path from 'path';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 420, height: 900 }
  });
  const page = await context.newPage();

  console.log('Navigating to http://127.0.0.1:3000/services ...');
  await page.goto('http://127.0.0.1:3000/services', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const screenshotPath = path.resolve('artifacts/02_services_categories_sidebar.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Saved screenshot to ${screenshotPath}`);

  // Also click Telegram to see its categories
  const tgTab = await page.$('text=Telegram');
  if (tgTab) {
    await tgTab.click();
    await page.waitForTimeout(1000);
    const screenshotTgPath = path.resolve('artifacts/03_services_telegram_categories.png');
    await page.screenshot({ path: screenshotTgPath, fullPage: false });
    console.log(`Saved Telegram screenshot to ${screenshotTgPath}`);
  }

  await browser.close();
}

main().catch(err => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
