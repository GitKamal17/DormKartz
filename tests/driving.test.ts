import { describe, expect, it } from 'vitest';
import { PHYS, secondsToTicks } from '../src/sim/config';
import { createRace, getTrack, input, place, run, skipCountdown, soloConfig, step } from './helpers';

// Meadow Loop's start straight is long and wide: a good test bench.
const STRAIGHT = 20;

describe('drift and mini-turbo', () => {
  it('reaches each spark tier in order and boosts on release by tier', () => {
    for (const tier of [1, 2, 3]) {
      const st = createRace(soloConfig(), 1);
      skipCountdown(st);
      const k = st.karts[0];
      place(st, k, STRAIGHT, -6, 28);
      const tiers: number[] = [];
      let ticks = 0;
      // Press drift while steering right, then hold until the wanted tier.
      while (k.driftTier < tier && ticks < 400) {
        step(st, new Map([[0, input({ throttle: 1, steer: ticks < 3 ? 1 : 0.6, drift: true })]]));
        for (const e of st.events) if (e.type === 'driftTier') tiers.push(e.tier);
        ticks++;
        // Keep the kart on a straight piece of road so walls never cancel the drift.
        if (ticks % 8 === 0) place(st, k, STRAIGHT, -6, Math.max(26, Math.hypot(k.vx, k.vz)));
      }
      expect(k.drift).toBe(1);
      expect(tiers).toEqual([1, 2, 3].slice(0, tier));
      step(st, new Map([[0, input({ throttle: 1 })]]));
      const turbo = st.events.find((e) => e.type === 'boost');
      expect(turbo).toMatchObject({ type: 'boost', kind: 'turbo' });
      expect(k.boostTicks).toBe(secondsToTicks(PHYS.miniTurboTime[tier - 1]));
    }
  });

  it('cancels the drift with no boost when released before tier 1', () => {
    const st = createRace(soloConfig(), 1);
    skipCountdown(st);
    const k = st.karts[0];
    place(st, k, STRAIGHT, 0, 28);
    run(st, 10, () => ({ throttle: 1, steer: 1, drift: true }));
    expect(k.drift).toBe(1);
    expect(k.driftTier).toBe(0);
    run(st, 1, () => ({ throttle: 1 }));
    expect(k.drift).toBe(0);
    expect(k.boostTicks).toBe(0);
  });

  it('boosts are faster than top speed', () => {
    const st = createRace(soloConfig(), 1);
    skipCountdown(st);
    const k = st.karts[0];
    const drive = (ticks: number) => {
      for (let i = 0; i < ticks; i += 10) {
        place(st, k, STRAIGHT, 6, Math.hypot(k.vx, k.vz));
        run(st, 10, () => ({ throttle: 1 }));
      }
    };
    place(st, k, STRAIGHT, 6, 0);
    drive(300);
    const cruise = Math.hypot(k.vx, k.vz);
    expect(cruise).toBeGreaterThan(28);
    k.boostTicks = 60;
    drive(40);
    expect(Math.hypot(k.vx, k.vz)).toBeGreaterThan(cruise * 1.15);
  });
});

describe('start boost', () => {
  function startWith(pressAtCountdown: number): number {
    const st = createRace(soloConfig(), 1);
    let boost = 0;
    while (st.phase === 'countdown') {
      step(st, new Map([[0, input({ throttle: st.countdown <= pressAtCountdown ? 1 : 0 })]]));
    }
    boost = st.karts[0].boostTicks;
    return boost + (st.karts[0].stallTicks > 0 ? -1 : 0);
  }
  it('rewards pressing just after "1" and punishes holding from the start', () => {
    expect(startWith(30)).toBeGreaterThan(0);
    expect(startWith(5)).toBe(0);
    expect(startWith(400)).toBe(-1);
  });
});

describe('wrong-way detection', () => {
  it('flags a kart driving backwards and clears when turned around', () => {
    const st = createRace(soloConfig(), 1);
    const track = getTrack(st.config.trackId);
    skipCountdown(st);
    const k = st.karts[0];
    place(st, k, 60, 0, 15, true);
    run(st, 70, () => ({ throttle: 1 }));
    expect(k.wrongWay).toBe(true);
    place(st, k, 60, 0, 15);
    run(st, 40, () => ({ throttle: 1 }));
    expect(k.wrongWay).toBe(false);
    expect(track.length).toBeGreaterThan(100);
  });
});

describe('falling and respawn', () => {
  it('respawns a kart that drives off an open edge, facing forward', () => {
    const st = createRace(soloConfig('starlight-ribbon'), 1);
    skipCountdown(st);
    const k = st.karts[0];
    place(st, k, 15, 0, 25);
    k.heading += Math.PI / 2; // Point straight off the side.
    let fell = false, respawned = false;
    for (let i = 0; i < 400 && !respawned; i++) {
      step(st, new Map([[0, input({ throttle: 1 })]]));
      for (const e of st.events) {
        if (e.type === 'fall') fell = true;
        if (e.type === 'respawn') respawned = true;
      }
    }
    expect(fell).toBe(true);
    expect(respawned).toBe(true);
    run(st, 60, () => ({ throttle: 1 }));
    expect(k.fallTicks).toBe(0);
    expect(Math.abs(k.d)).toBeLessThan(4);
    const track = getTrack(st.config.trackId);
    const along = k.vx * Math.sin(Math.atan2(track.tx[Math.round(k.s) % track.n], track.tz[Math.round(k.s) % track.n])) + k.vz * Math.cos(Math.atan2(track.tx[Math.round(k.s) % track.n], track.tz[Math.round(k.s) % track.n]));
    expect(along).toBeGreaterThan(3);
  });
});
