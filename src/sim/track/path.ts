// Authoring helper: describe a closed loop as straights and arcs, get control
// points back. Two straights can be flagged `adjust` so the builder solves
// their lengths to close the loop exactly; total turning must be ±360°.

import { smoothstep } from '../math';
import type { ControlPoint } from './types';

interface SegOpts {
  /** Elevation change over the segment (eased in and out). */
  dy?: number;
  /** Full road width reached by the end of this segment. */
  width?: number;
  /** Extra bank in degrees reached by the middle of the segment. */
  bank?: number;
  /** Let the solver change this straight's length to close the loop. */
  adjust?: boolean;
}

interface Seg extends SegOpts {
  kind: 'S' | 'L' | 'R';
  len: number; // straight length
  r: number; // arc radius
  deg: number; // arc angle
}

/** Layout problems found while building paths; asserted empty by the track tests. */
export const PATH_ERRORS: string[] = [];

export interface BuiltPath {
  points: ControlPoint[];
  /** Named positions as lap fractions (u). */
  marks: Record<string, number>;
  length: number;
  /** Final lengths of adjustable straights (for debugging layouts). */
  adjusted: number[];
}

const STEP = 5;

export class PathBuilder {
  private segs: Seg[] = [];
  private labels: [string, number][] = [];

  constructor(
    private readonly name: string,
    private readonly startWidth: number,
    private readonly start: { x: number; y: number; z: number; heading: number } = { x: 0, y: 0, z: 0, heading: 0 },
    /** How far down the first straight the start line goes. */
    private readonly startLead = 48,
  ) {}

  straight(len: number, opts: SegOpts = {}): this {
    this.segs.push({ kind: 'S', len, r: 0, deg: 0, ...opts });
    return this;
  }

  left(r: number, deg: number, opts: SegOpts = {}): this {
    this.segs.push({ kind: 'L', len: 0, r, deg, ...opts });
    return this;
  }

  right(r: number, deg: number, opts: SegOpts = {}): this {
    this.segs.push({ kind: 'R', len: 0, r, deg, ...opts });
    return this;
  }

  /** Names the current position (end of the last segment added). */
  mark(name: string): this {
    this.labels.push([name, this.segs.length]);
    return this;
  }

  build(): BuiltPath {
    const segs = this.segs;
    const totalTurn = segs.reduce((a, s) => a + (s.kind === 'L' ? s.deg : s.kind === 'R' ? -s.deg : 0), 0);
    if (Math.abs(Math.abs(totalTurn) - 360) > 1e-6) {
      PATH_ERRORS.push(`${this.name}: turning must total ±360°, got ${totalTurn}`);
    }

    // Close the loop: among straights flagged `adjust`, find the pair whose
    // length change closes the loop with the smallest total change.
    const adjustIdx = segs.map((sg, i) => (sg.adjust ? i : -1)).filter((i) => i >= 0);
    const end = this.trace(segs);
    const ex = -(end.x - this.start.x), ez = -(end.z - this.start.z);
    let bestPair: [number, number, number, number] | null = null;
    let bestCost = Infinity;
    let fallback: [number, number, number, number] | null = null;
    for (let i = 0; i < adjustIdx.length; i++) {
      for (let j = i + 1; j < adjustIdx.length; j++) {
        const a = adjustIdx[i], b = adjustIdx[j];
        const da = this.headingAt(segs, a), db = this.headingAt(segs, b);
        const ax = Math.sin(da), az = Math.cos(da), bx = Math.sin(db), bz = Math.cos(db);
        const det = ax * bz - az * bx;
        if (Math.abs(det) < 1e-3) continue;
        const ka = (ex * bz - ez * bx) / det;
        const kb = (ax * ez - az * ex) / det;
        const cost = Math.abs(ka) + Math.abs(kb);
        if (segs[a].len + ka >= 8 && segs[b].len + kb >= 8 && cost < bestCost) {
          bestCost = cost;
          bestPair = [a, b, ka, kb];
        }
        if (!fallback) fallback = [a, b, ka, kb];
      }
    }
    if (bestPair) {
      segs[bestPair[0]].len += bestPair[2];
      segs[bestPair[1]].len += bestPair[3];
    } else if (adjustIdx.length >= 2 && fallback) {
      const [a, b, ka, kb] = fallback;
      PATH_ERRORS.push(`${this.name}: loop closure needs straights of ${(segs[a].len + ka).toFixed(1)} (seg ${a}) and ${(segs[b].len + kb).toFixed(1)} (seg ${b})`);
      segs[a].len = Math.max(4, segs[a].len + ka);
      segs[b].len = Math.max(4, segs[b].len + kb);
    } else if (Math.hypot(ex, ez) > 0.5) {
      PATH_ERRORS.push(`${this.name}: loop does not close (off by ${Math.hypot(ex, ez).toFixed(1)}) and has fewer than two adjustable straights`);
    }
    const usedAdjust = bestPair ? [bestPair[0], bestPair[1]] : adjustIdx;

    // Balance elevation so the loop returns to its starting height.
    const dySum = segs.reduce((a, s) => a + (s.dy ?? 0), 0);
    if (Math.abs(dySum) > 1e-9) {
      const targets = usedAdjust.length ? usedAdjust : segs.map((_, i) => i);
      for (const i of targets) segs[i].dy = (segs[i].dy ?? 0) - dySum / targets.length;
    }

    // Emit points.
    const pts: ControlPoint[] = [];
    const segStartLen: number[] = [];
    let x = this.start.x, y = this.start.y, z = this.start.z, h = (this.start.heading * Math.PI) / 180;
    let width = this.startWidth;
    let bank = 0;
    let cum = 0;
    for (const s of segs) {
      segStartLen.push(cum);
      const len = s.kind === 'S' ? s.len : (s.r * s.deg * Math.PI) / 180;
      const n = Math.max(1, Math.round(len / STEP));
      const w0 = width, w1 = s.width ?? width;
      const b0 = bank, b1 = s.bank ?? 0;
      const y0 = y, dy = s.dy ?? 0;
      const h0 = h, x0 = x, z0 = z;
      for (let k = 0; k < n; k++) {
        const f = k / n;
        let px: number, pz: number;
        if (s.kind === 'S') {
          px = x0 + Math.sin(h0) * len * f;
          pz = z0 + Math.cos(h0) * len * f;
        } else {
          [px, pz] = arcPoint(x0, z0, h0, s.r, (s.deg * Math.PI) / 180, s.kind === 'L' ? 1 : -1, f);
        }
        const bankHere = b0 + (b1 - b0) * smoothstep(0, 0.5, f);
        pts.push({
          x: px,
          y: y0 + dy * smoothstep(0, 1, f),
          z: pz,
          width: w0 + (w1 - w0) * smoothstep(0, 1, f),
          bank: bankHere,
        });
      }
      // Advance to segment end.
      if (s.kind === 'S') {
        x = x0 + Math.sin(h0) * len;
        z = z0 + Math.cos(h0) * len;
      } else {
        const sign = s.kind === 'L' ? 1 : -1;
        [x, z] = arcPoint(x0, z0, h0, s.r, (s.deg * Math.PI) / 180, sign, 1);
        h = h0 + sign * ((s.deg * Math.PI) / 180);
      }
      y = y0 + dy;
      width = w1;
      bank = b1;
      cum += len;
    }
    const total = cum;
    // Put the start line partway down the first straight so the starting grid
    // (which sits behind the line) is on the straight, not in the last corner.
    const lead = segs[0].kind === 'S' ? Math.min(this.startLead, segs[0].len * 0.6) : 0;
    const k = Math.round(lead / (segs[0].len / Math.max(1, Math.round(segs[0].len / STEP))));
    const leadExact = k * (segs[0].len / Math.max(1, Math.round(segs[0].len / STEP)));
    const rotated = k > 0 ? [...pts.slice(k), ...pts.slice(0, k)] : pts;
    const marks: Record<string, number> = {};
    for (const [name, segIdx] of this.labels) {
      const at = segIdx < segStartLen.length ? segStartLen[segIdx] : total;
      marks[name] = (((at - leadExact) / total) % 1 + 1) % 1;
    }
    return { points: rotated, marks, length: total, adjusted: usedAdjust.map((i) => segs[i].len) };
  }

  private headingAt(segs: Seg[], idx: number): number {
    let h = (this.start.heading * Math.PI) / 180;
    for (let i = 0; i < idx; i++) {
      const s = segs[i];
      if (s.kind === 'L') h += (s.deg * Math.PI) / 180;
      else if (s.kind === 'R') h -= (s.deg * Math.PI) / 180;
    }
    return h;
  }

  private trace(segs: Seg[]): { x: number; z: number } {
    let x = this.start.x, z = this.start.z, h = (this.start.heading * Math.PI) / 180;
    for (const s of segs) {
      if (s.kind === 'S') {
        x += Math.sin(h) * s.len;
        z += Math.cos(h) * s.len;
      } else {
        const sign = s.kind === 'L' ? 1 : -1;
        [x, z] = arcPoint(x, z, h, s.r, (s.deg * Math.PI) / 180, sign, 1);
        h += sign * ((s.deg * Math.PI) / 180);
      }
    }
    return { x, z };
  }
}

/**
 * Point along an arc starting at (x, z) with heading h (direction (sin h, cos h)).
 * sign = +1 turns left (heading increases), -1 turns right.
 */
function arcPoint(x: number, z: number, h: number, r: number, ang: number, sign: number, f: number): [number, number] {
  // Left of heading direction (sin h, cos h) is (cos h, -sin h) when heading increases.
  const lx = Math.cos(h) * sign, lz = -Math.sin(h) * sign;
  const cx = x + lx * r, cz = z + lz * r;
  const a = ang * f * sign;
  // Rotate the radius vector (x - cx, z - cz) by heading change a.
  const rx = x - cx, rz = z - cz;
  const ca = Math.cos(a), sa = Math.sin(a);
  // Heading increase rotates direction (sin h, cos h) -> (sin(h+a), cos(h+a)).
  // That is a rotation by -a in the (x, z) plane under the standard convention.
  return [cx + rx * ca + rz * sa, cz - rx * sa + rz * ca];
}

/** Lap fraction `offset` units after a named mark. */
export function at(p: BuiltPath, mark: string, offset = 0): number {
  const m = p.marks[mark];
  if (m === undefined) throw new Error(`Unknown mark ${mark}`);
  return (((m + offset / p.length) % 1) + 1) % 1;
}
