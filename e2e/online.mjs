// End-to-end online test: starts the real game server; a host (a bare
// WebSocket client, so only one page has to render) creates a room, and an
// emulated Android phone joins it over a simulated slow connection (?lag).
// Checks that the phone's kart reacts to touch steering right away
// (client-side prediction) rather than a round trip later.
// Usage: npm run build && node e2e/online.mjs   (LAG=250 to change the round trip)

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const OUT = 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const LAG = Number(process.env.LAG ?? 250);
const PORT = 18000 + Math.floor(Math.random() * 1000);
const failures = [];
const check = (cond, msg) => {
  if (!cond) {
    failures.push(msg);
    console.log('  FAIL:', msg);
  }
};

const server = spawn(process.execPath, ['dist-server/server.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('server on') && resolve());
  server.on('exit', (c) => reject(new Error(`server exited (${c})`)));
});

const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
// Prefer Playwright's Chromium; fall back to an installed Chrome.
const browser = await chromium.launch({ args }).catch(() => chromium.launch({ args, channel: 'chrome' }));
const base = `http://127.0.0.1:${PORT}/`;
const errors = [];

async function open(context, query, label) {
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(base + query);
  await page.waitForFunction(() => window.dormkartz?.status().screen === 'title', null, { timeout: 30000 });
  await page.waitForTimeout(400);
  return page;
}
const status = (page) => page.evaluate(() => window.dormkartz.status());

try {
  const host = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const fromHost = [];
  host.onmessage = (e) => fromHost.push(JSON.parse(e.data));
  await new Promise((r) => (host.onopen = r));
  host.send(JSON.stringify({ type: 'create', v: 2, name: 'Host' }));
  const phoneCtx = await browser.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  const phone = await open(phoneCtx, `?lag=${LAG}&jitter=30`, 'phone');

  const code = fromHost.find((m) => m.type === 'joined').room.code;
  console.log(`room ${code}, simulated round trip ${LAG} ms`);

  await phone.tap('[data-id="start"]');
  await phone.waitForTimeout(350);
  await phone.tap('[data-id="online"]');
  await phone.waitForTimeout(350);
  await phone.fill('.net-name', 'Phone');
  await phone.fill('.net-code', code.toLowerCase());
  await phone.tap('[data-id="join"]');
  await phone.waitForFunction(() => window.dormkartz.status().screen === 'room', null, { timeout: 10000 });
  check((await status(phone)).online.players === 2, 'phone did not join the room');

  host.send(JSON.stringify({ type: 'start' }));
  await phone.waitForFunction(() => window.dormkartz.status().phase === 'racing', null, { timeout: 20000 });
  await phone.waitForTimeout(2500);
  const pace = await phone.evaluate(async () => {
    const a = window.dormkartz.status().tick;
    let frames = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 1000) {
      await new Promise((r) => requestAnimationFrame(r));
      frames++;
    }
    return { fps: frames, ticksPerSec: window.dormkartz.status().tick - a };
  });
  console.log(`phone: ${pace.fps} fps, ${pace.ticksPerSec} sim ticks/s`);
  const moving = await status(phone);
  check(moving.player.speed > 5, `phone kart not moving after the start (speed ${moving.player.speed.toFixed(1)})`);

  // Steer with the touch pad and time how long until the kart turns on screen.
  // Up to three tries: a kart that's spinning out or respawning can't steer.
  const steer = () => phone.evaluate(async () => {
    const pad = document.querySelector('.tc-steer');
    const r = pad.getBoundingClientRect();
    const x = r.left + 100, y = r.top + r.height * 0.6;
    const ev = (t, cx) => pad.dispatchEvent(new PointerEvent(t, { pointerId: 5, pointerType: 'touch', clientX: cx, clientY: y, bubbles: true }));
    const heading = () => window.dormkartz.status().player.heading;
    const h0 = heading();
    const t0 = performance.now();
    ev('pointerdown', x);
    ev('pointermove', x + 120);
    let ms = -1;
    while (performance.now() - t0 < 2000) {
      await new Promise((res) => requestAnimationFrame(res));
      if (Math.abs(heading() - h0) > 0.02) {
        ms = performance.now() - t0;
        break;
      }
    }
    ev('pointerup', x + 120);
    return ms;
  });
  let reaction = -1;
  for (let tries = 0; tries < 3 && reaction < 0; tries++) {
    reaction = await steer();
    if (reaction < 0) await phone.waitForTimeout(1500);
  }
  console.log(`phone kart reacted to steering after ${reaction.toFixed(0)} ms (round trip ${LAG} ms)`);
  check(reaction >= 0 && reaction < LAG / 2, `steering reacted after ${reaction.toFixed(0)} ms; prediction should make it faster than half the round trip`);

  // Race a while and watch how far predictions get corrected.
  const corrections = [];
  for (let i = 0; i < 20; i++) {
    await phone.waitForTimeout(250);
    const s = await status(phone);
    if (s.online.correction !== null) corrections.push(s.online.correction);
  }
  corrections.sort((a, b) => a - b);
  const med = corrections[corrections.length >> 1] ?? 0;
  console.log(`prediction error: median ${med.toFixed(3)} m, worst ${(corrections.at(-1) ?? 0).toFixed(2)} m, clock rate ${(await status(phone)).online.rate}`);
  check(med < 0.5, `median prediction error ${med.toFixed(2)} m`);
  await phone.screenshot({ path: `${OUT}/online-phone.png` });
  host.close();
} catch (e) {
  check(false, e.message);
} finally {
  await browser.close();
  server.kill();
}

for (const e of errors) check(false, `console error: ${e}`);
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nonline e2e OK');
process.exit(failures.length ? 1 : 0);
