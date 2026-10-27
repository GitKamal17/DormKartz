// Dev helper: watch a full autopiloted race and screenshot moments + results.
// Usage: npm run build && node e2e/peek.mjs [trackIndex] [extraQuery]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';

mkdirSync('e2e/screenshots', { recursive: true });
const track = Number(process.argv[2] ?? 0);
const server = await serve('dist');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?autopilot${process.argv[3] ?? ''}`);
await page.waitForFunction(() => window.dormkartz?.status().screen === 'title');
const st = () => page.evaluate(() => window.dormkartz.status());
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(400); } };
await page.waitForTimeout(400);
await key('Enter'); await key('ArrowDown'); await key('Enter'); await key('ArrowRight'); await key('ArrowRight'); await key('Enter'); // 150cc? (right does nothing in list)
await key('Enter');
await key('ArrowDown', Math.floor(track / 2)); await key('ArrowRight', track % 2); await key('Enter');
await page.waitForFunction(() => window.dormkartz.status().racing, null, { timeout: 30000 });
let shot = 0;
const t0 = Date.now();
while (Date.now() - t0 < 20 * 60 * 1000) {
  const s = await st();
  if (s.screen === 'results') break;
  if (s.phase === 'racing' && (s.tick - 220) / 60 > shot * 15 && shot < 6) {
    await page.screenshot({ path: `e2e/screenshots/race-${track}-${shot}.png` });
    console.log('shot', shot, JSON.stringify(s.player), 'draws', s.draws);
    shot++;
  }
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(800);
await page.screenshot({ path: `e2e/screenshots/results-${track}.png` });
console.log('final', JSON.stringify(await st()));
await browser.close();
server.close();
