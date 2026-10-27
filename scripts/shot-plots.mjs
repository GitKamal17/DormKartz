// Renders plots/*.svg to PNG for quick viewing.
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const dir = resolve('plots');
const only = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
for (const f of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
  if (only.length && !only.some((o) => f.includes(o))) continue;
  const svg = readFileSync(resolve(dir, f), 'utf8').replace(/width="\d+" height="\d+"/, 'width="880" height="880" preserveAspectRatio="xMidYMid meet"');
  await page.setContent(`<body style="margin:0;background:#111">${svg}</body>`);
  await page.screenshot({ path: resolve(dir, f.replace('.svg', '.png')) });
}
await browser.close();
