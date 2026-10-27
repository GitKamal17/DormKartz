// Runs a race with no rendering, as fast as possible. Used by tests and tools.

import { AIInput } from '../input/ai';
import { CHARACTERS } from '../sim/characters';
import { SPEED_CLASS, TICK_RATE } from '../sim/config';
import { createRace, step } from '../sim/race';
import { getTrack } from '../sim/tracks';
import type { FrameInput, PlayerId, RaceConfig, RaceState, SpeedClass } from '../sim/types';

export interface HeadlessResult {
  state: RaceState;
  ticks: number;
  /** Longest stretch (seconds) any kart spent with almost no progress after the start. */
  worstStall: { kart: PlayerId; seconds: number; s: number };
  falls: number;
  hits: number;
}

export function cpuConfig(trackId: string, cc: SpeedClass, count = 8): RaceConfig {
  return {
    trackId,
    speedClass: cc,
    laps: getTrack(trackId).def.laps,
    items: true,
    startItem: null,
    karts: Array.from({ length: count }, (_, i) => ({ id: i, characterId: CHARACTERS[i % CHARACTERS.length].id, catchUp: false })),
  };
}

export function runHeadlessRace(config: RaceConfig, seed: number, maxSeconds = 360): HeadlessResult {
  const track = getTrack(config.trackId);
  const state = createRace(config, seed);
  const skill = SPEED_CLASS[config.speedClass].cpuSkill;
  const ais = new Map<PlayerId, AIInput>();
  config.karts.forEach((k, i) => ais.set(k.id, new AIInput(Math.min(1, skill + (i % 4) * 0.03), `${seed}:${k.id}`)));
  const inputs = new Map<PlayerId, FrameInput>();
  const lastProgress = new Map<PlayerId, { s: number; lap: number; tick: number }>();
  let worstStall = { kart: -1, seconds: 0, s: 0 };
  let falls = 0, hits = 0;
  const maxTicks = maxSeconds * TICK_RATE;
  while (state.phase !== 'finished' && state.tick < maxTicks) {
    for (const [id, ai] of ais) inputs.set(id, ai.poll({ state, track }, id));
    step(state, inputs);
    for (const e of state.events) {
      if (e.type === 'fall') falls++;
      if (e.type === 'hit') hits++;
    }
    if (state.phase !== 'racing') continue;
    for (const k of state.karts) {
      if (k.finished) continue;
      const lp = lastProgress.get(k.id);
      const prog = k.lap * track.length + k.s;
      if (!lp || prog - (lp.lap * track.length + lp.s) > 8 || prog < lp.lap * track.length + lp.s - track.length / 2) {
        lastProgress.set(k.id, { s: k.s, lap: k.lap, tick: state.tick });
      } else {
        const stalled = (state.tick - lp.tick) / TICK_RATE;
        if (stalled > worstStall.seconds) worstStall = { kart: k.id, seconds: stalled, s: k.s };
      }
    }
  }
  return { state, ticks: state.tick, worstStall, falls, hits };
}
