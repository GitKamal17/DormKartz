// Time-trial ghosts. Because the simulation is deterministic and input-driven,
// a ghost is just the race state at the start of a lap plus the inputs used
// during that lap. Replaying them through step() reproduces the lap exactly.

import { step } from '../sim/race';
import type { FrameInput, RaceState } from '../sim/types';
import { load, save } from './storage';

export interface GhostData {
  v: 1;
  trackId: string;
  characterId: string;
  lapTicks: number;
  start: RaceState;
  inputs: number[];
}

/** Rounds analog values so a packed input unpacks to exactly what the sim saw. */
export function quantize(i: FrameInput, out: FrameInput): FrameInput {
  // `+ 0` turns -0 into 0 so packed inputs unpack to identical values.
  out.steer = Math.round(Math.max(-1, Math.min(1, i.steer)) * 100) / 100 + 0;
  out.throttle = Math.round(Math.max(0, Math.min(1, i.throttle)) * 100) / 100;
  out.brake = Math.round(Math.max(0, Math.min(1, i.brake)) * 100) / 100;
  out.drift = i.drift;
  out.useItem = i.useItem;
  out.lookBack = i.lookBack;
  return out;
}

export function packInput(i: FrameInput): number {
  const steer = Math.round(i.steer * 100) + 100;
  const thr = Math.round(i.throttle * 100);
  const brk = Math.round(i.brake * 100);
  const bits = (i.drift ? 1 : 0) | (i.useItem ? 2 : 0) | (i.lookBack ? 4 : 0);
  return steer + thr * 256 + brk * 32768 + bits * 4194304;
}

export function unpackInput(n: number, out: FrameInput): FrameInput {
  out.steer = ((n % 256) - 100) / 100 + 0;
  out.throttle = (Math.floor(n / 256) % 128) / 100;
  out.brake = (Math.floor(n / 32768) % 128) / 100;
  const bits = Math.floor(n / 4194304);
  out.drift = (bits & 1) !== 0;
  out.useItem = (bits & 2) !== 0;
  out.lookBack = (bits & 4) !== 0;
  return out;
}

export class GhostRecorder {
  private lapStart: string | null = null;
  private inputs: number[] = [];
  best: GhostData | null = null;

  constructor(
    private readonly trackId: string,
    private readonly characterId: string,
  ) {}

  /** Call right after the tick in which a lap began (GO, or crossing the line). */
  beginLap(state: RaceState): void {
    this.lapStart = JSON.stringify(state);
    this.inputs = [];
  }

  record(input: FrameInput): void {
    if (this.lapStart) this.inputs.push(packInput(input));
  }

  /** Call right after the tick in which the lap ended. */
  endLap(lapTicks: number): void {
    if (!this.lapStart) return;
    if (!this.best || lapTicks < this.best.lapTicks) {
      this.best = {
        v: 1,
        trackId: this.trackId,
        characterId: this.characterId,
        lapTicks,
        start: JSON.parse(this.lapStart) as RaceState,
        inputs: this.inputs.slice(),
      };
    }
  }
}

export class GhostRunner {
  state: RaceState | null = null;
  private idx = 0;
  private readonly input: FrameInput = { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false, lookBack: false };
  private readonly map = new Map<number, FrameInput>();

  constructor(readonly data: GhostData) {}

  restart(): void {
    this.state = JSON.parse(JSON.stringify(this.data.start)) as RaceState;
    this.idx = 0;
  }

  get active(): boolean {
    return this.state !== null && this.idx < this.data.inputs.length;
  }

  step(): void {
    if (!this.state || this.idx >= this.data.inputs.length) return;
    unpackInput(this.data.inputs[this.idx++], this.input);
    this.map.set(this.state.karts[0].id, this.input);
    step(this.state, this.map);
  }
}

export function loadGhost(trackId: string): GhostData | null {
  const g = load<GhostData | null>(`ghost.${trackId}`, null);
  return g && g.v === 1 && g.trackId === trackId ? g : null;
}

export function saveGhost(g: GhostData): void {
  save(`ghost.${g.trackId}`, g);
}

export interface TimeTrialRecord {
  total: number;
  lap: number;
  characterId: string;
}

export function loadRecord(trackId: string): TimeTrialRecord | null {
  return load<TimeTrialRecord | null>(`tt.${trackId}`, null);
}

export function saveRecord(trackId: string, r: TimeTrialRecord): void {
  save(`tt.${trackId}`, r);
}
