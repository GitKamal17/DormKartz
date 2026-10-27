// Moving hazards are pure functions of the tick, so they need no state and stay
// in sync for every viewer (and for a future server).

import { TICK_RATE } from './config';
import { mod, TAU } from './math';
import { frameAt, groundHeight, newLoc, type BuiltHazard, type Track } from './track/build';

export interface HazardPose {
  x: number;
  y: number;
  z: number;
  s: number;
  d: number;
  heading: number;
  /** Crusher: height of the block above the road (0 = slammed down). */
  height: number;
}

export function newPose(): HazardPose {
  return { x: 0, y: 0, z: 0, s: 0, d: 0, heading: 0, height: 0 };
}

const loc = newLoc();

function place(track: Track, s: number, d: number, out: HazardPose): HazardPose {
  frameAt(track, s, loc);
  out.s = loc.s;
  out.d = d;
  out.x = loc.cx + loc.rx * d;
  out.z = loc.cz + loc.rz * d;
  out.y = groundHeight(track, loc.s, d, loc.i, loc.cy);
  out.heading = Math.atan2(loc.tx, loc.tz);
  return out;
}

export function rollerPose(track: Track, h: Extract<BuiltHazard, { kind: 'roller' }>, tick: number, out: HazardPose): HazardPose {
  const d = h.amplitude * Math.sin((TAU * tick) / h.periodTicks + h.phase);
  place(track, h.s, d, out);
  out.y += h.radius;
  return out;
}

export function trafficPose(track: Track, h: Extract<BuiltHazard, { kind: 'traffic' }>, idx: number, tick: number, out: HazardPose): HazardPose {
  const spacing = track.length / h.count;
  const s = mod(idx * spacing + (h.direction * h.speed * tick) / TICK_RATE, track.length);
  place(track, s, h.lanes[idx % h.lanes.length], out);
  if (h.direction < 0) out.heading += Math.PI;
  return out;
}

/** Crusher cycle: hangs high, slams down, waits, rises. Returns height above the road. */
export function crusherHeight(h: Extract<BuiltHazard, { kind: 'crusher' }>, tick: number): number {
  const c = mod(tick / h.periodTicks + h.phase, 1);
  const top = 6.5;
  if (c < 0.5) return top;
  if (c < 0.58) return top * (1 - (c - 0.5) / 0.08);
  if (c < 0.78) return 0;
  return (top * (c - 0.78)) / 0.22;
}

export function crusherPose(track: Track, h: Extract<BuiltHazard, { kind: 'crusher' }>, tick: number, out: HazardPose): HazardPose {
  place(track, h.s, (h.dMin + h.dMax) / 2, out);
  out.height = crusherHeight(h, tick);
  return out;
}

/** Height below which a crusher squashes anything under it. */
export const CRUSHER_DANGER = 1.6;
