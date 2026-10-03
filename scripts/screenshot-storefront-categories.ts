import { chromium } from 'playwright';
import path from 'path';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 400, height: 900 } // mobile / narrow sidebar view matching user screenshot
  });
  const page = await context.newPage();

  console.log('Navigating to http://127.0.0.1:3000 ...');
  await page.goto('http://127.0.0.1:3000', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const screenshotPath = path.resolve('artifacts/01_storefront_categories_clean.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`Saved screenshot to ${screenshotPath}`);

  await browser.close();
}

main().catch(err => {
  console.error('Screenshot failed:', err);
  process.exit(1);
});
