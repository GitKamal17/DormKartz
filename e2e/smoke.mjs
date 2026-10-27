// Browser smoke test. Builds must exist (npm run build). Usage: npm run test:e2e
// For every track: title -> Single Race -> 100cc -> character -> track, then
// drive with simulated keyboard input, screenshot, and require zero console errors.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { serve } from './serve.mjs';

const OUT = 'e2e/screenshots';
mkdirSync(OUT, { recursive: true });
const TRACKS = ['meadow-loop', 'dune-run', 'harbor-boardwalk', 'frostbite-pass', 'hollow-manor', 'neon-avenue', 'magma-keep', 'starlight-ribbon'];
const only = process.argv[2];

const server = await serve('dist');
const base = `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const failures = [];

function check(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.log('  FAIL:', msg);
  }
}

async function open(page, query = '') {
  await page.goto(base + query);
  await page.waitForFunction(() => window.dormkartz?.status().screen === 'title', null, { timeout: 30000 });
  await page.waitForTimeout(350);
}

const status = (page) => page.evaluate(() => window.dormkartz.status());

async function press(page, key, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  }
}

async function waitScreen(page, id) {
  await page.waitForFunction((s) => window.dormkartz.status().screen === s, id, { timeout: 15000 });
  // Menus ignore confirm/back for a moment after appearing.
  await page.waitForTimeout(350);
}

/** Menus from the title screen into a race on track index i. */
async function enterRace(page, i, mode = 'single') {
  await press(page, 'Enter');
  await waitScreen(page, 'main');
  if (mode === 'single') {
    await press(page, 'ArrowDown');
    await press(page, 'Enter');
    await waitScreen(page, 'cc');
    await press(page, 'Enter'); // 100cc
  } else {
    await press(page, 'ArrowDown', 3); // Time Trial (after Grand Prix, Single Race, Party Race)
    await press(page, 'Enter');
  }
  await waitScreen(page, 'character');
  await press(page, 'Enter');
  await waitScreen(page, 'track');
  await press(page, 'ArrowDown', Math.floor(i / 2));
  await press(page, 'ArrowRight', i % 2);
  await press(page, 'Enter');
  await page.waitForFunction(() => window.dormkartz.status().racing, null, { timeout: 30000 });
}

async function waitTicks(page, n, timeout = 120000) {
  const start = (await status(page)).tick;
  await page.waitForFunction((t) => window.dormkartz.status().tick >= t, start + n, { timeout, polling: 250 });
}

/** Drives with a crude keyboard autopilot that steers back toward the road. */
async function drive(page, ticks) {
  await page.keyboard.down('ArrowUp');
  const end = (await status(page)).tick + ticks;
  let maxSpeed = 0;
  let pulses = 0;
  while ((await status(page)).tick < end) {
    const st = await status(page);
    maxSpeed = Math.max(maxSpeed, st.player?.speed ?? 0);
    // Tap the drift button now and then to exercise hops and sparks.
    if (pulses++ % 6 === 0) {
      await page.keyboard.down('Space');
      await page.waitForTimeout(80);
      await page.keyboard.up('Space');
    }
    await page.waitForTimeout(200);
  }
  await page.keyboard.up('ArrowUp');
  return maxSpeed;
}

function collect(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return errors;
}

// --- Every track -----------------------------------------------------------------
for (let i = 0; i < TRACKS.length; i++) {
  if (only && (only === 'extras' || only === 'party' || !TRACKS[i].includes(only))) continue;
  const t0 = Date.now();
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = collect(page);
  console.log(`track ${TRACKS[i]}`);
  try {
    await open(page);
    await enterRace(page, i);
    const st = await status(page);
    check(st.track === TRACKS[i], `${TRACKS[i]}: expected track, got ${st.track}`);
    await page.waitForFunction(() => window.dormkartz.status().phase === 'racing', null, { timeout: 120000, polling: 250 });
    const maxSpeed = await drive(page, 240);
    const after = await status(page);
    await page.screenshot({ path: `${OUT}/${String(i + 1).padStart(2, '0')}-${TRACKS[i]}.png` });
    check(maxSpeed > 5, `${TRACKS[i]}: kart never got moving (max speed ${maxSpeed.toFixed(1)})`);
    check(after.tick > st.tick + 200, `${TRACKS[i]}: simulation did not advance`);
  } catch (e) {
    check(false, `${TRACKS[i]}: ${e.message}`);
    await page.screenshot({ path: `${OUT}/${String(i + 1).padStart(2, '0')}-${TRACKS[i]}-error.png` }).catch(() => {});
  }
  check(errors.length === 0, `${TRACKS[i]}: console errors: ${errors.slice(0, 5).join(' | ')}`);
  console.log(`  ok in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await page.close();
}

if (!only || only === 'extras') {
  // --- Split screen debug flag ----------------------------------------------------
  {
    console.log('viewports=2');
    const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
    const errors = collect(page);
    try {
      await open(page, '?viewports=2');
      await enterRace(page, 5);
      const st = await status(page);
      check(st.viewports === 2, `split screen: expected 2 viewports, got ${st.viewports}`);
      await page.waitForFunction(() => window.dormkartz.status().phase === 'racing', null, { timeout: 120000, polling: 250 });
      await drive(page, 150);
      await page.screenshot({ path: `${OUT}/09-split-screen.png` });
      check((await page.locator('.hud').count()) === 2, 'split screen: expected 2 HUDs');
    } catch (e) {
      check(false, `split screen: ${e.message}`);
    }
    check(errors.length === 0, `split screen: console errors: ${errors.slice(0, 5).join(' | ')}`);
    await page.close();
  }

  // --- Pause, time trial, quit ------------------------------------------------------
  {
    console.log('pause + time trial');
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const errors = collect(page);
    try {
      await open(page);
      await enterRace(page, 0, 'tt');
      await page.waitForFunction(() => window.dormkartz.status().phase === 'racing', null, { timeout: 120000, polling: 250 });
      await drive(page, 60);
      await press(page, 'Escape');
      await waitScreen(page, 'pause');
      const t1 = (await status(page)).tick;
      await page.waitForTimeout(1500);
      check((await status(page)).tick === t1, 'pause: simulation kept running while paused');
      await page.screenshot({ path: `${OUT}/10-pause.png` });
      await press(page, 'Enter'); // resume
      await page.waitForFunction(() => window.dormkartz.status().screen === null, null, { timeout: 5000 });
      await waitTicks(page, 30);
      await press(page, 'Escape');
      await waitScreen(page, 'pause');
      await press(page, 'ArrowDown', 2);
      await press(page, 'Enter'); // quit
      await waitScreen(page, 'main');
      check(!(await status(page)).racing, 'quit: still racing after quitting');
    } catch (e) {
      check(false, `pause/tt: ${e.message}`);
    }
    check(errors.length === 0, `pause/tt: console errors: ${errors.slice(0, 5).join(' | ')}`);
    await page.close();
  }
}

// --- Party (local multiplayer) ---------------------------------------------------
// Gamepads are faked by overriding navigator.getGamepads(); the test presses
// their buttons through window.__padSet(index, button, pressed).
const FAKE_PADS = () => {
  window.__pads = [];
  const snapshot = (p) => ({
    index: p.index,
    id: `Fake gamepad ${p.index + 1}`,
    connected: true,
    mapping: 'standard',
    timestamp: performance.now(),
    axes: p.axes.slice(),
    buttons: p.buttons.map((b) => ({ pressed: b, touched: b, value: b ? 1 : 0 })),
  });
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => {
      const out = [null, null, null, null];
      for (const p of window.__pads) out[p.index] = snapshot(p);
      return out;
    },
  });
  window.__padSet = (i, b, v) => {
    let p = window.__pads.find((x) => x.index === i);
    if (!p) {
      p = { index: i, axes: [0, 0, 0, 0], buttons: Array(17).fill(false) };
      window.__pads.push(p);
    }
    p.buttons[b] = v;
  };
};

async function padTap(page, pad, button) {
  await page.evaluate(([i, b]) => window.__padSet(i, b, true), [pad, button]);
  await page.waitForTimeout(450);
  await page.evaluate(([i, b]) => window.__padSet(i, b, false), [pad, button]);
  await page.waitForTimeout(350);
}

const lobby = (page) => page.evaluate(() => window.dormkartz.status().lobby ?? []);

/**
 * Runs a party race. devices: which devices join, in order ('L' = keyboard left,
 * 'R' = keyboard arrows, 0/1 = gamepad index).
 */
async function partyRace(name, devices, { cpus = true, track = 0, shot }) {
  console.log(`party: ${name}`);
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.addInitScript(FAKE_PADS);
  const errors = collect(page);
  try {
    await open(page);
    await press(page, 'Enter');
    await waitScreen(page, 'main');
    await press(page, 'ArrowDown', 2); // Party Race
    await press(page, 'Enter');
    await waitScreen(page, 'lobby');
    const confirm = async (d) => (d === 'L' ? press(page, 'Space') : d === 'R' ? press(page, 'Enter') : padTap(page, d, 0));
    for (const d of devices) await confirm(d); // join
    check((await lobby(page)).length === devices.length, `${name}: expected ${devices.length} players to join, got ${(await lobby(page)).length}`);
    for (const d of devices) await confirm(d); // lock in racer
    const seats = await lobby(page);
    check(seats.every((x) => x.ready), `${name}: not everyone is ready: ${JSON.stringify(seats)}`);
    check(new Set(seats.map((x) => x.characterId)).size === seats.length, `${name}: two players got the same racer`);
    await page.screenshot({ path: `${OUT}/party-${shot}-lobby.png` });
    await confirm(devices[0]); // everyone ready: continue
    await waitScreen(page, 'party-setup');
    if (!cpus) {
      await press(page, 'ArrowDown', 2);
      await press(page, 'Enter'); // CPU racers: off
      await press(page, 'ArrowUp', 2);
    }
    await press(page, 'Enter'); // VS Race
    await waitScreen(page, 'cc');
    await press(page, 'Enter'); // 100cc
    await waitScreen(page, 'track');
    await press(page, 'ArrowDown', Math.floor(track / 2));
    await press(page, 'ArrowRight', track % 2);
    await press(page, 'Enter');
    await page.waitForFunction(() => window.dormkartz.status().racing, null, { timeout: 30000 });
    const st = await status(page);
    check(st.viewports === devices.length, `${name}: expected ${devices.length} viewports, got ${st.viewports}`);
    check(st.players.length === devices.length, `${name}: expected ${devices.length} human karts`);
    check(st.karts === (cpus ? 8 : devices.length), `${name}: expected ${cpus ? 8 : devices.length} karts, got ${st.karts}`);
    check((await page.locator('.hud.player').count()) === devices.length, `${name}: expected one tagged HUD per player`);
    await page.waitForFunction(() => window.dormkartz.status().phase === 'racing', null, { timeout: 180000, polling: 250 });
    // Everyone holds accelerate on their own device.
    const hold = async (down) => {
      for (const d of devices) {
        if (d === 'L') await (down ? page.keyboard.down('KeyW') : page.keyboard.up('KeyW'));
        else if (d === 'R') await (down ? page.keyboard.down('ArrowUp') : page.keyboard.up('ArrowUp'));
        else await page.evaluate(([i, v]) => window.__padSet(i, 0, v), [d, down]);
      }
    };
    await hold(true);
    const maxSpeed = devices.map(() => 0);
    const end = (await status(page)).tick + 150;
    while ((await status(page)).tick < end) {
      const ps = (await status(page)).players;
      ps.forEach((p, i) => (maxSpeed[i] = Math.max(maxSpeed[i], p.speed)));
      await page.waitForTimeout(250);
    }
    await page.screenshot({ path: `${OUT}/party-${shot}-race.png` });
    console.log(`  draw calls per viewport: ${(await status(page)).draws}`);
    await hold(false);
    maxSpeed.forEach((v, i) => check(v > 5, `${name}: player ${i + 1} (${devices[i]}) never got moving (max ${v.toFixed(1)})`));
    // Any player can pause; Esc on the keyboard here.
    await press(page, 'Escape');
    await waitScreen(page, 'pause');
    await press(page, 'ArrowDown', 2);
    await press(page, 'Enter');
    await waitScreen(page, 'main');
  } catch (e) {
    check(false, `${name}: ${e.message}`);
    await page.screenshot({ path: `${OUT}/party-${shot}-error.png` }).catch(() => {});
  }
  check(errors.length === 0, `${name}: console errors: ${errors.slice(0, 5).join(' | ')}`);
  await page.close();
}

if (!only || only === 'party') {
  await partyRace('2 players, one keyboard, no CPUs', ['L', 'R'], { cpus: false, track: 5, shot: '2p' });
  await partyRace('3 players', ['L', 'R', 0], { track: 3, shot: '3p' });
  await partyRace('4 players: keyboard x2 + 2 gamepads', ['L', 'R', 0, 1], { track: 6, shot: '4p' });
}

await browser.close();
server.close();
if (failures.length) {
  console.log(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log('\nsmoke test passed');
