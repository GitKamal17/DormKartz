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

async function open(context, query, label, screen = 'title') {
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${label}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(base + query);
  await page.waitForFunction((s) => window.dormkartz?.status().screen === s, screen, { timeout: 30000 });
  await page.waitForTimeout(400);
  return page;
}
const status = (page) => page.evaluate(() => window.dormkartz.status());

try {
  const host = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const fromHost = [];
  host.onmessage = (e) => fromHost.push(JSON.parse(e.data));
  await new Promise((r) => (host.onopen = r));
  host.send(JSON.stringify({ type: 'create', v: 3, name: 'Host' })); // PROTOCOL_VERSION in src/net/protocol.ts
  const phoneCtx = await browser.newContext({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });

  const code = fromHost.find((m) => m.type === 'joined').room.code;
  console.log(`room ${code}, simulated round trip ${LAG} ms`);

  // The friend opens the invite link: straight to Join with the code filled in.
  const phone = await open(phoneCtx, `?lag=${LAG}&jitter=30&room=${code}`, 'phone', 'online');
  check((await phone.inputValue('.net-code')) === code, 'invite link should fill in the room code');
  check(!(await phone.evaluate(() => location.search.includes('room='))), 'invite code should be removed from the address after use');
  await phone.fill('.net-name', 'Phone');
  await phone.tap('[data-id="join"]');
  await phone.waitForFunction(() => window.dormkartz.status().screen === 'room', null, { timeout: 10000 });
  check((await status(phone)).online.players === 2, 'phone did not join the room');
  await phone.waitForFunction(() => document.querySelectorAll('.room-players .ping').length === 1, null, { timeout: 8000 }).catch(() => {});
  const pings = await phone.locator('.room-players .ping').allTextContents();
  console.log(`room shows pings: ${pings.join(', ') || 'none'} (the host here is a bare socket that doesn't report one)`);
  check(pings.length === 1 && parseInt(pings[0]) >= LAG * 0.8, `phone's own ping should show in the room (~${LAG} ms), got ${JSON.stringify(pings)}`);
  await phone.screenshot({ path: `${OUT}/online-phone-room.png` });

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
    let ms = -1, frames = 0;
    while (performance.now() - t0 < 2000) {
      await new Promise((res) => requestAnimationFrame(res));
      frames++;
      if (Math.abs(heading() - h0) > 0.02) {
        ms = performance.now() - t0;
        break;
      }
    }
    ev('pointerup', x + 120);
    return { ms, frames };
  });
  // Up to three tries: a kart that's spinning out or respawning can't steer.
  let reaction = { ms: -1, frames: 0 };
  for (let tries = 0; tries < 3 && reaction.ms < 0; tries++) {
    reaction = await steer();
    if (reaction.ms < 0) await phone.waitForTimeout(1500);
  }
  console.log(`phone kart reacted to steering after ${reaction.ms.toFixed(0)} ms, ${reaction.frames} frame(s) (round trip ${LAG} ms)`);
  // Headless software rendering can drop to a few fps, so a frame count is the fair measure.
  check(reaction.ms >= 0 && (reaction.frames <= 2 || reaction.ms < LAG / 2), `steering took ${reaction.ms.toFixed(0)} ms / ${reaction.frames} frames; prediction should turn the kart on the next frame`);

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

  // Split screen online: one computer, two players (W A S D + I J K L), each with their own seat.
  await phoneCtx.close();
  host.close();
  console.log('split screen: two players on one computer');
  const pc = await open(await browser.newContext({ viewport: { width: 960, height: 600 } }), '', 'pc');
  await pc.click('[data-id="start"]');
  await pc.waitForTimeout(350);
  await pc.click('[data-id="online"]');
  await pc.waitForTimeout(350);
  await pc.fill('.net-name', 'Kamal');
  await pc.click('[data-id="create"]');
  await pc.waitForFunction(() => window.dormkartz.status().screen === 'room', null, { timeout: 10000 });
  await pc.click('[data-id="add"]');
  await pc.waitForFunction(() => window.dormkartz.status().screen === 'online-add', null, { timeout: 5000 });
  await pc.fill('.net-name', 'Sam');
  await pc.click('[data-id="add-confirm"]');
  await pc.waitForFunction(() => window.dormkartz.status().online.you.length === 2, null, { timeout: 5000 });
  await pc.waitForFunction(() => window.dormkartz.status().screen === 'room', null, { timeout: 5000 });
  await pc.screenshot({ path: `${OUT}/online-split-room.png` });
  check((await pc.locator('.room-players li').count()) === 2, 'split: room should list both players');
  await pc.click('[data-id="start"]');
  await pc.waitForFunction(() => window.dormkartz.status().phase === 'racing', null, { timeout: 30000 });
  const split = await status(pc);
  check(split.viewports === 2, `split: expected 2 viewports, got ${split.viewports}`);
  check(split.players.length === 2, `split: expected 2 local karts, got ${split.players.length}`);
  check((await pc.locator('.hud.player').count()) === 2, 'split: expected a tagged HUD per player');
  await pc.keyboard.down('KeyW');
  await pc.keyboard.down('KeyI');
  // Hold for 2.5 s of race time (headless rendering is slow, so wall time says little).
  const top = [0, 0];
  const until = (await status(pc)).tick + 150;
  for (let st = await status(pc); st.tick < until; st = await status(pc)) {
    st.players.forEach((p, n) => (top[n] = Math.max(top[n], p.speed)));
    await pc.waitForTimeout(250);
  }
  await pc.keyboard.up('KeyW');
  await pc.keyboard.up('KeyI');
  console.log(`split: top speeds P1 ${top[0].toFixed(1)}, P2 ${top[1].toFixed(1)}`);
  check(top[0] > 5 && top[1] > 5, `split: both players should drive (P1 W: ${top[0].toFixed(1)}, P2 I: ${top[1].toFixed(1)})`);
  await pc.screenshot({ path: `${OUT}/online-split-race.png` });
} catch (e) {
  check(false, e.message);
} finally {
  await browser.close();
  server.kill();
}

for (const e of errors) check(false, `console error: ${e}`);
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nonline e2e OK');
process.exit(failures.length ? 1 : 0);
