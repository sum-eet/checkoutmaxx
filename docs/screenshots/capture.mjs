import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const files = [
  'screenshot-1-sessions.html',
  'screenshot-2-timeline.html',
  'screenshot-3-discounts.html',
  'screenshot-4-checkout-recovery.html',
];

const dir = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1600, height: 900 });

for (const f of files) {
  const filePath = path.join(dir, f);
  await page.goto(`file://${filePath}`);
  await page.waitForTimeout(200);
  const outPath = path.join(dir, f.replace('.html', '.png'));
  await page.screenshot({ path: outPath, fullPage: false });
  console.log('✓', f, '→', outPath);
}

await browser.close();
console.log('\nDone. 4 × 1600×900 PNGs ready in docs/screenshots/');
