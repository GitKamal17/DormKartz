// One race in progress: owns the RaceState, the player slots and their input
// sources, and steps the simulation one fixed tick at a time. Rendering reads
// from it; nothing here touches Three.js or the DOM.

import { AIInput } from '../input/ai';
import type { InputSource } from '../input/types';
import { createRace, step } from '../sim/race';
import type { Track } from '../sim/track/build';
import { getTrack } from '../sim/tracks';
import type { FrameInput, PlayerId, RaceConfig, RaceEvent, RaceState, SpeedClass } from '../sim/types';
import { GhostRecorder, GhostRunner, quantize, type GhostData } from './ghost';

export type GameMode = 'gp' | 'single' | 'tt';

/** A participant. Nothing assumes there is exactly one human or that it is slot 0. */
export interface PlayerSlot {
  id: PlayerId;
  kind: 'local' | 'cpu';
  characterId: string;
  input: InputSource;
  /** Index among local players (drives viewport/HUD assignment); -1 for CPUs. */
  localIndex: number;
}

export interface SessionOptions {
  trackId: string;
  speedClass: SpeedClass;
  mode: GameMode;
  /** Grid order: index 0 starts on pole. */
  slots: PlayerSlot[];
  seed: number;
  ghost?: GhostData | null;
}

/** Render-relevant kart pose before the latest tick, for interpolation. */
export const PREV_STRIDE = 4;

export class RaceSession {
  readonly track: Track;
  readonly state: RaceState;
  readonly slots: PlayerSlot[];
  readonly mode: GameMode;
  /** x, y, z, heading of every kart before the most recent tick. */
  readonly prev: Float64Array;
  /** Same for the ghost kart. */
  readonly ghostPrev = new Float64Array(PREV_STRIDE);
  readonly ghost: GhostRunner | null;
  readonly recorder: GhostRecorder | null;
  private readonly pending: RaceEvent[] = [];
  private readonly inputs = new Map<PlayerId, FrameInput>();
  private readonly quantized = new Map<PlayerId, FrameInput>();
  private readonly takeover = new Map<PlayerId, AIInput>();
  /** Last input fed to each local player's kart (for audio/visual cues). */
  readonly lastInput = new Map<PlayerId, FrameInput>();

  constructor(opts: SessionOptions) {
    this.track = getTrack(opts.trackId);
    this.slots = opts.slots;
    this.mode = opts.mode;
    const config: RaceConfig = {
      trackId: opts.trackId,
      speedClass: opts.speedClass,
      laps: this.track.def.laps,
      items: opts.mode !== 'tt',
      startItem: opts.mode === 'tt' ? 'tripleZoom' : null,
      karts: opts.slots.map((s) => ({ id: s.id, characterId: s.characterId, catchUp: s.kind === 'cpu' })),
    };
    this.state = createRace(config, opts.seed);
    this.prev = new Float64Array(this.state.karts.length * PREV_STRIDE);
    this.snapshot();
    for (const s of this.slots) this.quantized.set(s.id, { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false, lookBack: false });
    this.ghost = opts.ghost ? new GhostRunner(opts.ghost) : null;
    const local = this.slots.find((s) => s.kind === 'local');
    this.recorder = opts.mode === 'tt' && local ? new GhostRecorder(opts.trackId, local.characterId) : null;
  }

  localSlots(): PlayerSlot[] {
    return this.slots.filter((s) => s.kind === 'local').sort((a, b) => a.localIndex - b.localIndex);
  }

  kart(id: PlayerId) {
    return this.state.karts.find((k) => k.id === id)!;
  }

  private snapshot(): void {
    const ks = this.state.karts;
    for (let i = 0; i < ks.length; i++) {
      const o = i * PREV_STRIDE;
      this.prev[o] = ks[i].x;
      this.prev[o + 1] = ks[i].y;
      this.prev[o + 2] = ks[i].z;
      this.prev[o + 3] = ks[i].heading;
    }
    const g = this.ghost?.state?.karts[0];
    if (g) {
      this.ghostPrev[0] = g.x;
      this.ghostPrev[1] = g.y;
      this.ghostPrev[2] = g.z;
      this.ghostPrev[3] = g.heading;
    }
  }

  /** Advances the race by exactly one fixed tick. */
  tick(): void {
    this.snapshot();
    const view = { state: this.state, track: this.track };
    for (const s of this.slots) {
      const k = this.state.karts.find((kk) => kk.id === s.id)!;
      let src: InputSource = s.input;
      if (s.kind === 'local' && k.finished) {
        let ai = this.takeover.get(s.id);
        if (!ai) {
          ai = new AIInput(0.8, `takeover-${s.id}`);
          this.takeover.set(s.id, ai);
        }
        src = ai;
      }
      const q = quantize(src.poll(view, s.id), this.quantized.get(s.id)!);
      this.inputs.set(s.id, q);
      if (s.kind === 'local') this.lastInput.set(s.id, q);
    }
    const wasCountdown = this.state.phase === 'countdown';
    const local = this.slots.find((s) => s.kind === 'local');
    if (this.recorder && local && !wasCountdown) this.recorder.record(this.inputs.get(local.id)!);

    step(this.state, this.inputs);
    this.ghost?.step();

    for (const e of this.state.events) this.pending.push(e);

    // Time trial bookkeeping: lap boundaries for the ghost recorder and runner.
    if (local && this.mode === 'tt') {
      const started = wasCountdown && this.state.phase === 'racing';
      const k = this.kart(local.id);
      for (const e of this.state.events) {
        if ((e.type === 'lap' || e.type === 'finish') && e.kart === local.id) {
          this.recorder?.endLap(k.lapTimes[k.lapTimes.length - 1]);
        }
      }
      const newLap = started || this.state.events.some((e) => e.type === 'lap' && e.kart === local.id);
      if (newLap) {
        this.recorder?.beginLap(this.state);
        if (this.ghost) {
          this.ghost.restart();
          const g = this.ghost.state!.karts[0];
          this.ghostPrev[0] = g.x;
          this.ghostPrev[1] = g.y;
          this.ghostPrev[2] = g.z;
          this.ghostPrev[3] = g.heading;
        }
      }
    }
  }

  /** Events since the last call, oldest first. */
  drainEvents(): RaceEvent[] {
    const out = this.pending.slice();
    this.pending.length = 0;
    return out;
  }

  /** Final order: finishers in order, then everyone else by current position. */
  resultOrder(): PlayerId[] {
    const done = this.state.finishOrder.slice();
    const rest = this.state.karts
      .filter((k) => !k.finished)
      .sort((a, b) => a.place - b.place)
      .map((k) => k.id);
    return [...done, ...rest];
  }
}
