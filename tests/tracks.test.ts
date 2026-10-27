import { describe, expect, it } from 'vitest';
import { cpuConfig, runHeadlessRace } from '../src/game/headless';
import { TICK_RATE } from '../src/sim/config';
import { PATH_ERRORS } from '../src/sim/track/path';
import { CUPS, getTrack, TRACKS } from '../src/sim/tracks';
import type { SpeedClass } from '../src/sim/types';

describe('track layouts', () => {
  it('has 8 tracks in 2 cups of 4', () => {
    expect(TRACKS.length).toBe(8);
    expect(CUPS.map((c) => c.tracks.length)).toEqual([4, 4]);
  });

  it('every layout closes cleanly', () => {
    for (const t of TRACKS) getTrack(t.id);
    expect(PATH_ERRORS).toEqual([]);
  });

  for (const def of TRACKS) {
    describe(def.name, () => {
      const t = getTrack(def.id);

      it('has sane geometry', () => {
        expect(t.length).toBeGreaterThan(500);
        for (let i = 0; i < t.n; i++) {
          expect(Number.isFinite(t.px[i] + t.py[i] + t.pz[i])).toBe(true);
          // Inside edges never fold: the road itself always fits.
          expect(t.limL[i]).toBeGreaterThanOrEqual(t.hw[i]);
          expect(t.limR[i]).toBeGreaterThanOrEqual(t.hw[i]);
        }
      });

      it('never overlaps itself except as a bridge', () => {
        const step = 3;
        for (let i = 0; i < t.n; i += step) {
          for (let j = 0; j < t.n; j += step) {
            const along = Math.min(Math.abs(i - j), t.n - Math.abs(i - j)) * t.ds;
            const reachI = Math.max(t.limL[i], t.limR[i]), reachJ = Math.max(t.limL[j], t.limR[j]);
            if (along < (reachI + reachJ) * 2.2) continue;
            const dist = Math.hypot(t.px[i] - t.px[j], t.pz[i] - t.pz[j]);
            const bridge = Math.abs(t.py[i] - t.py[j]) > 5;
            if (!bridge && dist < reachI + reachJ) {
              throw new Error(`${def.id}: s=${(i * t.ds).toFixed(0)} overlaps s=${(j * t.ds).toFixed(0)} (dist ${dist.toFixed(1)})`);
            }
          }
        }
      });

      it('has a full starting grid and item boxes on the road', () => {
        expect(t.grid.length).toBe(8);
        for (const g of t.grid) expect(Math.abs(g.d)).toBeLessThan(t.hw[Math.round(g.s / t.ds) % t.n] - 1);
        expect(t.boxes.length).toBeGreaterThanOrEqual(8);
        for (const b of t.boxes) expect(Math.abs(b.d)).toBeLessThan(t.hw[Math.round(b.s / t.ds) % t.n]);
        expect(t.checkpoints.length).toBeGreaterThanOrEqual(8);
      });

      it('has a risky shortcut or a jump', () => {
        const wideInside = Array.from(t.limL).some((v, i) => v - t.hw[i] > 15) || Array.from(t.limR).some((v, i) => v - t.hw[i] > 15);
        expect(wideInside || t.ramps.length > 0).toBe(true);
      });
    });
  }
});

// The test that proves each track is drivable: 8 CPUs, full race, no rendering.
describe('headless CPU races', () => {
  const classes: SpeedClass[] = [150, 50];
  for (const cc of classes) {
    for (const def of TRACKS) {
      it(`${def.name} @ ${cc}cc: all 8 CPUs finish and nobody gets stuck`, () => {
        const r = runHeadlessRace(cpuConfig(def.id, cc), cc + def.order);
        const finished = r.state.karts.filter((k) => k.finished).length;
        expect(finished, `only ${finished}/8 finished`).toBe(8);
        const raceSeconds = (r.ticks - r.state.goTick) / TICK_RATE;
        expect(raceSeconds).toBeLessThan(def.laps * 60);
        expect(r.worstStall.seconds, `kart ${r.worstStall.kart} stalled at s=${r.worstStall.s.toFixed(0)}`).toBeLessThan(5);
      });
    }
  }
});
