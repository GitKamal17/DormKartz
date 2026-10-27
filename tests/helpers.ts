import { createRace, step } from '../src/sim/race';
import { frameAt, groundHeight, newLoc } from '../src/sim/track/build';
import { getTrack } from '../src/sim/tracks';
import { NEUTRAL_INPUT, type FrameInput, type KartState, type RaceConfig, type RaceState } from '../src/sim/types';

export function soloConfig(trackId = 'meadow-loop', extra: Partial<RaceConfig> = {}): RaceConfig {
  return {
    trackId,
    speedClass: 150,
    laps: 3,
    items: false,
    startItem: null,
    karts: [{ id: 0, characterId: 'nova', catchUp: false }],
    ...extra,
  };
}

export function multiConfig(n: number, trackId = 'meadow-loop', extra: Partial<RaceConfig> = {}): RaceConfig {
  const chars = ['nova', 'bolt', 'pip', 'rosa', 'grit', 'mabel', 'tank', 'zip'];
  return {
    ...soloConfig(trackId, extra),
    karts: Array.from({ length: n }, (_, i) => ({ id: i, characterId: chars[i], catchUp: false })),
    ...extra,
  };
}

/** Runs the countdown out with no input. */
export function skipCountdown(st: RaceState): void {
  const none = new Map<number, FrameInput>();
  while (st.phase === 'countdown') step(st, none);
}

export function input(p: Partial<FrameInput> = {}): FrameInput {
  return { ...NEUTRAL_INPUT, ...p };
}

export function inputsFor(st: RaceState, f: (k: KartState) => Partial<FrameInput>): Map<number, FrameInput> {
  const m = new Map<number, FrameInput>();
  for (const k of st.karts) m.set(k.id, input(f(k)));
  return m;
}

/** Places a kart on the track at (s, d) facing along the track at `speed`. */
export function place(st: RaceState, k: KartState, s: number, d = 0, speed = 0, reverse = false): void {
  const track = getTrack(st.config.trackId);
  const loc = frameAt(track, s, newLoc());
  k.x = loc.cx + loc.rx * d;
  k.z = loc.cz + loc.rz * d;
  k.y = groundHeight(track, loc.s, d, loc.i, loc.cy);
  k.s = loc.s;
  k.d = d;
  k.heading = Math.atan2(loc.tx, loc.tz) + (reverse ? Math.PI : 0);
  k.vx = Math.sin(k.heading) * speed;
  k.vz = Math.cos(k.heading) * speed;
  k.vy = 0;
  k.grounded = true;
  k.lastSafeS = loc.s;
}

export function run(st: RaceState, ticks: number, f: (k: KartState) => Partial<FrameInput> = () => ({})): void {
  for (let i = 0; i < ticks; i++) step(st, inputsFor(st, f));
}

export { createRace, step, getTrack };
