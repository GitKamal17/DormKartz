import { describe, expect, it } from 'vitest';
import { AIInput } from '../src/input/ai';
import { createRace, step } from '../src/sim/race';
import { getTrack } from '../src/sim/tracks';
import type { FrameInput, RaceState } from '../src/sim/types';
import { multiConfig } from './helpers';

/** Scripted, state-independent inputs: a deterministic wiggle per kart. */
function scripted(tick: number, id: number): FrameInput {
  const t = tick + id * 37;
  return {
    steer: Math.sin(t / 23) * 0.8,
    throttle: t % 300 < 280 ? 1 : 0,
    brake: t % 300 >= 290 ? 1 : 0,
    drift: t % 180 > 120,
    useItem: t % 97 < 3,
    lookBack: t % 400 > 380,
  };
}

function runScripted(st: RaceState, ticks: number): void {
  const m = new Map<number, FrameInput>();
  for (let i = 0; i < ticks; i++) {
    for (const k of st.karts) m.set(k.id, scripted(st.tick, k.id));
    step(st, m);
  }
}

describe('determinism', () => {
  it('same seed + same inputs gives an identical state after 3,000 ticks', () => {
    const cfg = multiConfig(8, 'neon-avenue', { items: true });
    const a = createRace(cfg, 1234);
    const b = createRace(cfg, 1234);
    runScripted(a, 3000);
    runScripted(b, 3000);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('CPU-driven races are reproducible too', () => {
    const cfg = multiConfig(8, 'magma-keep', { items: true });
    const play = () => {
      const st = createRace(cfg, 77);
      const track = getTrack(cfg.trackId);
      const ais = cfg.karts.map((k) => new AIInput(0.8, `seed-${k.id}`));
      const m = new Map<number, FrameInput>();
      for (let i = 0; i < 3000; i++) {
        cfg.karts.forEach((k, j) => m.set(k.id, ais[j].poll({ state: st, track }, k.id)));
        step(st, m);
      }
      return JSON.stringify(st);
    };
    expect(play()).toBe(play());
  });

  it('different seeds diverge (item rolls use the seed)', () => {
    const cfg = multiConfig(8, 'meadow-loop', { items: true });
    const a = createRace(cfg, 1);
    const b = createRace(cfg, 2);
    runScripted(a, 3000);
    runScripted(b, 3000);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe('serialization', () => {
  it('round-trips through JSON and keeps simulating identically', () => {
    const cfg = multiConfig(8, 'harbor-boardwalk', { items: true });
    const a = createRace(cfg, 5);
    runScripted(a, 1500);
    const b = JSON.parse(JSON.stringify(a)) as RaceState;
    expect(b).toEqual(JSON.parse(JSON.stringify(a)));
    runScripted(a, 1500);
    runScripted(b, 1500);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
