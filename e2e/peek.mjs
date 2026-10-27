// Dev helper: open the built game and take screenshots of a few moments.
import { chromium } from 'playwright';
import { serve } from './serve.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('e2e/screenshots', { recursive: true });
const server = await serve('dist');
const port = server.address().port;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const track = process.argv[2] ?? '0';
await page.goto(`http://127.0.0.1:${port}/index.html${process.argv[3] ?? ''}`);
await page.waitForTimeout(2500);
await page.screenshot({ path: 'e2e/screenshots/peek-title.png' });
const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await page.waitForTimeout(150); } };
await key('Enter'); // title -> main
await key('ArrowDown'); await key('Enter'); // single race
await key('Enter'); // 100cc
await page.waitForTimeout(500);
await page.screenshot({ path: 'e2e/screenshots/peek-char.png' });
await key('Enter'); // character
await page.waitForTimeout(400);
for (let i = 0; i < Number(track); i++) await key('ArrowRight');
await page.screenshot({ path: 'e2e/screenshots/peek-track.png' });
await key('Enter');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'e2e/screenshots/peek-countdown.png' });
await page.keyboard.down('ArrowUp');
await page.waitForTimeout(6000);
await page.screenshot({ path: 'e2e/screenshots/peek-race.png' });
await page.waitForTimeout(4000);
await page.screenshot({ path: 'e2e/screenshots/peek-race2.png' });
console.log(JSON.stringify(await page.evaluate(() => window.dormkartz.status())));
console.log(errors.slice(0, 20).join('\n'));
await browser.close();
server.close();
