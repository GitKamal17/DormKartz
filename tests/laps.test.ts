import { describe, expect, it } from 'vitest';
import { raceProgress } from '../src/sim/race';
import { createRace, getTrack, multiConfig, place, run, skipCountdown, soloConfig, step } from './helpers';

/** Moves a kart along the centerline (fast, continuous) so every checkpoint is crossed. */
function driveTo(st: ReturnType<typeof createRace>, targetDistance: number, reverse = false): void {
  const track = getTrack(st.config.trackId);
  const k = st.karts[0];
  let travelled = 0;
  while (travelled < targetDistance) {
    const before = k.s;
    place(st, k, k.s, 0, 120, reverse);
    run(st, 1);
    const moved = Math.abs(((k.s - before + track.length * 1.5) % track.length) - track.length / 2);
    travelled += Math.max(moved, 0.5);
  }
}

describe('lap counting', () => {
  it('starts on lap 0 behind the line and enters lap 1 on crossing', () => {
    const st = createRace(soloConfig(), 1);
    skipCountdown(st);
    expect(st.karts[0].lap).toBe(0);
    driveTo(st, 20);
    expect(st.karts[0].lap).toBe(1);
  });

  it('counts a lap only after every checkpoint, and finishes after the last lap', () => {
    const st = createRace(soloConfig(), 1);
    const track = getTrack(st.config.trackId);
    skipCountdown(st);
    driveTo(st, 20);
    driveTo(st, track.length);
    expect(st.karts[0].lap).toBe(2);
    expect(st.karts[0].lapTimes.length).toBe(1);
    driveTo(st, track.length * 2);
    expect(st.karts[0].finished).toBe(true);
    expect(st.karts[0].lapTimes.length).toBe(3);
    expect(st.finishOrder).toEqual([0]);
  });
});

describe('checkpoint anti-cheat', () => {
  it('does not count a lap when you reverse over the line and come back', () => {
    const st = createRace(soloConfig(), 1);
    const track = getTrack(st.config.trackId);
    skipCountdown(st);
    driveTo(st, 20); // lap 1
    const k = st.karts[0];
    expect(k.lap).toBe(1);
    // Back over the line...
    driveTo(st, k.s + 15, true);
    expect(k.s).toBeGreaterThan(track.length - 20);
    expect(k.lap).toBe(1);
    // ...and forward again.
    driveTo(st, 40);
    expect(k.lap).toBe(1);
  });

  it('does not count a lap when checkpoints are skipped', () => {
    const st = createRace(soloConfig(), 1);
    const track = getTrack(st.config.trackId);
    skipCountdown(st);
    driveTo(st, 20);
    const k = st.karts[0];
    // Jump straight to just before the line, skipping the lap, and drive over it.
    place(st, k, track.length - 1, 0, 120);
    run(st, 1);
    expect(k.s).toBeLessThan(5);
    driveTo(st, 10);
    expect(k.lap).toBe(1);
  });
});

describe('position ranking', () => {
  it('ranks by lap, then by distance along the track', () => {
    const st = createRace(multiConfig(3), 1);
    const track = getTrack(st.config.trackId);
    skipCountdown(st);
    const [a, b, c] = st.karts;
    for (const k of st.karts) {
      k.lap = 1;
      k.nextCp = 0;
    }
    place(st, a, 100, -5);
    place(st, b, 300, 0);
    place(st, c, 50, 5);
    c.lap = 2;
    run(st, 1);
    expect(c.place).toBe(1);
    expect(b.place).toBe(2);
    expect(a.place).toBe(3);
    expect(raceProgress(track, c)).toBeGreaterThan(raceProgress(track, b));
  });

  it('keeps finished karts ahead in finishing order', () => {
    const st = createRace(multiConfig(2), 1);
    skipCountdown(st);
    const [a, b] = st.karts;
    b.finished = true;
    b.finishTick = st.tick;
    st.finishOrder.push(b.id);
    a.lap = 3;
    place(st, a, 500);
    step(st, new Map());
    expect(b.place).toBe(1);
    expect(a.place).toBe(2);
  });
});
