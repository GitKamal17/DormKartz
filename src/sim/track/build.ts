// Builds all derived geometry for a TrackDef. Pure: no Three.js, no DOM.
// The result is consumed by physics (locate/groundY), AI (racing line) and the
// renderer (mesh generation).

import { clamp, mod, wrapAngle } from '../math';
import type { HitKind } from '../types';
import type { ControlPoint, TrackDef, URange } from './types';

export interface RampInfo {
  sLip: number;
  len: number;
  height: number;
  d: number;
  halfW: number;
}
export interface PadInfo {
  s: number;
  d: number;
  halfLen: number;
  halfW: number;
}
export interface SlowInfo {
  s0: number;
  s1: number;
  dMin: number;
  dMax: number;
  factor: number;
  kind: string;
}
export interface BoxInfo {
  s: number;
  d: number;
  x: number;
  y: number;
  z: number;
}
export interface GridSlot {
  s: number;
  d: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}
export type BuiltHazard =
  | { kind: 'roller'; style: string; s: number; amplitude: number; periodTicks: number; phase: number; radius: number; hit: HitKind }
  | { kind: 'traffic'; count: number; lanes: number[]; speed: number; direction: 1 | -1 }
  | { kind: 'crusher'; s: number; dMin: number; dMax: number; periodTicks: number; phase: number }
  | { kind: 'crate'; s: number; d: number; radius: number; x: number; y: number; z: number };

export interface Track {
  def: TrackDef;
  n: number;
  length: number;
  ds: number;
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  /** Flat (horizontal) unit tangent. */
  tx: Float64Array;
  tz: Float64Array;
  /** Vertical rise per unit of horizontal distance along the track. */
  ty: Float64Array;
  /** Flat unit right vector. */
  rx: Float64Array;
  rz: Float64Array;
  /** Ground height change per unit of lateral offset (banking). */
  slope: Float64Array;
  /** Signed curvature, positive = turning right. */
  curv: Float64Array;
  hw: Float64Array;
  limL: Float64Array;
  limR: Float64Array;
  wallL: Uint8Array;
  wallR: Uint8Array;
  gap: Uint8Array;
  rampAt: Int16Array;
  padAt: Int16Array;
  slowAt: Int16Array;
  ramps: RampInfo[];
  pads: PadInfo[];
  slows: SlowInfo[];
  checkpoints: number[];
  racingLine: Float64Array;
  boxes: BoxInfo[];
  grid: GridSlot[];
  hazards: BuiltHazard[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

/** Scratch result of locate(); allocate once and reuse. */
export interface TrackLoc {
  s: number;
  d: number;
  i: number;
  cx: number;
  cy: number;
  cz: number;
  rx: number;
  rz: number;
  tx: number;
  tz: number;
  ty: number;
  hw: number;
  lim: number;
  groundY: number;
  hasGround: boolean;
  wall: boolean;
}

export function newLoc(): TrackLoc {
  return { s: 0, d: 0, i: 0, cx: 0, cy: 0, cz: 0, rx: 1, rz: 0, tx: 0, tz: 1, ty: 0, hw: 10, lim: 12, groundY: 0, hasGround: true, wall: true };
}

export function inURange(u: number, r: URange): boolean {
  return r.from <= r.to ? u >= r.from && u < r.to : u >= r.from || u < r.to;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function smoothArray(a: Float64Array, radius: number, passes = 1): void {
  const n = a.length;
  const tmp = new Float64Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) sum += a[mod(i + k, n)];
      tmp[i] = sum / (2 * radius + 1);
    }
    a.set(tmp);
  }
}

function minFilter(a: Float64Array, radius: number): void {
  const n = a.length;
  const tmp = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let k = -radius; k <= radius; k++) m = Math.min(m, a[mod(i + k, n)]);
    tmp[i] = m;
  }
  a.set(tmp);
}

export function buildTrack(def: TrackDef): Track {
  const P: ControlPoint[] = def.points;
  const m = P.length;
  if (m < 4) throw new Error(`Track ${def.id} needs at least 4 points`);

  // 1. Dense Catmull-Rom polyline.
  const dx: number[] = [], dy: number[] = [], dz: number[] = [], dw: number[] = [], db: number[] = [];
  for (let i = 0; i < m; i++) {
    const p0 = P[mod(i - 1, m)], p1 = P[i], p2 = P[(i + 1) % m], p3 = P[(i + 2) % m];
    const segLen = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const sub = Math.max(6, Math.ceil(segLen / 0.4));
    const w = (p: ControlPoint) => p.width ?? def.defaultWidth;
    const b = (p: ControlPoint) => p.bank ?? 0;
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      dx.push(catmull(p0.x, p1.x, p2.x, p3.x, t));
      dy.push(catmull(p0.y, p1.y, p2.y, p3.y, t));
      dz.push(catmull(p0.z, p1.z, p2.z, p3.z, t));
      dw.push(w(p1) + (w(p2) - w(p1)) * t);
      db.push(b(p1) + (b(p2) - b(p1)) * t);
    }
  }
  const dn = dx.length;
  const cum = new Float64Array(dn + 1);
  for (let i = 0; i < dn; i++) {
    const j = (i + 1) % dn;
    cum[i + 1] = cum[i] + Math.hypot(dx[j] - dx[i], dz[j] - dz[i]);
  }
  const length = cum[dn];

  // 2. Uniform resample at ~1 unit spacing.
  const n = Math.round(length);
  const ds = length / n;
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n);
  const hw = new Float64Array(n), bankDeg = new Float64Array(n);
  let seg = 0;
  for (let j = 0; j < n; j++) {
    const s = j * ds;
    while (cum[seg + 1] < s && seg < dn - 1) seg++;
    const a = seg, b = (seg + 1) % dn;
    const segL = cum[seg + 1] - cum[seg];
    const t = segL > 0 ? (s - cum[seg]) / segL : 0;
    px[j] = dx[a] + (dx[b] - dx[a]) * t;
    py[j] = dy[a] + (dy[b] - dy[a]) * t;
    pz[j] = dz[a] + (dz[b] - dz[a]) * t;
    hw[j] = (dw[a] + (dw[b] - dw[a]) * t) / 2;
    bankDeg[j] = db[a] + (db[b] - db[a]) * t;
  }

  // 3. Frames, curvature, banking.
  const tx = new Float64Array(n), tz = new Float64Array(n), ty = new Float64Array(n);
  const rx = new Float64Array(n), rz = new Float64Array(n);
  const heading = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const a = mod(j - 1, n), b = (j + 1) % n;
    const ex = px[b] - px[a], ez = pz[b] - pz[a];
    const l = Math.hypot(ex, ez) || 1;
    tx[j] = ex / l;
    tz[j] = ez / l;
    ty[j] = (py[b] - py[a]) / l;
    rx[j] = -tz[j];
    rz[j] = tx[j];
    heading[j] = Math.atan2(tx[j], tz[j]);
  }
  const curv = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const a = mod(j - 2, n), b = (j + 2) % n;
    curv[j] = -wrapAngle(heading[b] - heading[a]) / (4 * ds);
  }
  smoothArray(curv, 3, 2);

  const slope = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const bank = clamp(curv[j] * def.autoBank * 4.5, -0.2, 0.2) + (bankDeg[j] * Math.PI) / 180;
    slope[j] = bank;
  }
  smoothArray(slope, 8, 2);
  for (let j = 0; j < n; j++) slope[j] = -Math.tan(slope[j]);

  // 4. Edges: walls, shoulders, gaps.
  const limL = new Float64Array(n), limR = new Float64Array(n);
  const wallL = new Uint8Array(n), wallR = new Uint8Array(n), gap = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    const u = j / n;
    let shL = def.shoulder, shR = def.shoulder;
    let wL = def.walls, wR = def.walls;
    for (const e of def.edges ?? []) {
      if (!inURange(u, e)) continue;
      if (e.side !== 'right') {
        if (e.wall !== undefined) wL = e.wall;
        if (e.shoulder !== undefined) shL = e.shoulder;
      }
      if (e.side !== 'left') {
        if (e.wall !== undefined) wR = e.wall;
        if (e.shoulder !== undefined) shR = e.shoulder;
      }
    }
    limL[j] = hw[j] + shL;
    limR[j] = hw[j] + shR;
    wallL[j] = wL ? 1 : 0;
    wallR[j] = wR ? 1 : 0;
    for (const g of def.gaps ?? []) if (inURange(u, g)) gap[j] = 1;
  }
  // Keep the inside edge of tight corners from folding over itself.
  for (let j = 0; j < n; j++) {
    const k = curv[j];
    if (k > 0.002) limR[j] = Math.min(limR[j], 0.82 / k);
    if (k < -0.002) limL[j] = Math.min(limL[j], 0.82 / -k);
  }
  minFilter(limL, 6);
  minFilter(limR, 6);
  smoothArray(limL, 8, 2);
  smoothArray(limR, 8, 2);

  // 5. Ramps, pads, slow zones.
  const rampAt = new Int16Array(n).fill(-1);
  const padAt = new Int16Array(n).fill(-1);
  const slowAt = new Int16Array(n).fill(-1);
  const ramps: RampInfo[] = (def.ramps ?? []).map((r) => {
    const sLip = r.u * length;
    const j = mod(Math.round(sLip / ds), n);
    return { sLip, len: r.length ?? 10, height: r.height ?? 1.8, d: r.d ?? 0, halfW: (r.width ?? hw[j] * 2) / 2 };
  });
  ramps.forEach((r, idx) => {
    for (let s = r.sLip - r.len; s <= r.sLip; s += ds * 0.5) rampAt[mod(Math.floor(s / ds), n)] = idx;
  });
  const pads: PadInfo[] = (def.boostPads ?? []).map((p) => ({
    s: p.u * length,
    d: p.d,
    halfLen: (p.length ?? 7) / 2,
    halfW: (p.width ?? 5) / 2,
  }));
  pads.forEach((p, idx) => {
    for (let s = p.s - p.halfLen; s <= p.s + p.halfLen; s += ds * 0.5) padAt[mod(Math.floor(s / ds), n)] = idx;
  });
  const slows: SlowInfo[] = (def.slowZones ?? []).map((z) => ({
    s0: z.from * length,
    s1: z.to * length,
    dMin: z.dMin,
    dMax: z.dMax,
    factor: z.factor,
    kind: z.kind,
  }));
  (def.slowZones ?? []).forEach((z, idx) => {
    for (let j = 0; j < n; j++) if (inURange(j / n, z)) slowAt[j] = idx;
  });

  // 6. Checkpoints.
  const ncp = Math.max(8, Math.round(length / 45));
  const checkpoints: number[] = [];
  for (let i = 0; i < ncp; i++) checkpoints.push(((i + 0.5) * length) / ncp);

  const track: Track = {
    def, n, length, ds, px, py, pz, tx, tz, ty, rx, rz, slope, curv, hw, limL, limR, wallL, wallR, gap,
    rampAt, padAt, slowAt, ramps, pads, slows, checkpoints,
    racingLine: new Float64Array(n), boxes: [], grid: [], hazards: [],
    bounds: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity },
  };

  // 7. Hazards.
  const L = length;
  track.hazards = (def.hazards ?? []).map((h) => {
    switch (h.kind) {
      case 'roller':
        return { kind: 'roller', style: h.style, s: h.u * L, amplitude: h.amplitude, periodTicks: Math.round(h.period * 60), phase: h.phase, radius: h.radius, hit: h.hit };
      case 'traffic':
        return { kind: 'traffic', count: h.count, lanes: h.lanes, speed: h.speed, direction: h.direction };
      case 'crusher':
        return { kind: 'crusher', s: h.u * L, dMin: h.dMin, dMax: h.dMax, periodTicks: Math.round(h.period * 60), phase: h.phase };
      case 'crate': {
        const w = worldAt(track, h.u * L, h.d);
        return { kind: 'crate', s: h.u * L, d: h.d, radius: h.radius, x: w.x, y: w.y, z: w.z };
      }
    }
  });

  // 8. Racing line: cut to the inside of corners, steer around slow zones and crates.
  const rl = track.racingLine;
  for (let j = 0; j < n; j++) rl[j] = clamp(curv[j] * 26, -1, 1) * Math.max(0, hw[j] - 3);
  smoothArray(rl, 18, 3);
  const avoid = () => {
    for (let j = 0; j < n; j++) {
      const s = j * ds;
      const z = slowAt[j] >= 0 ? slows[slowAt[j]] : null;
      const lim = hw[j] - 2.2;
      if (z) {
        const lo = z.dMin - 3, hi = z.dMax + 3;
        if (rl[j] > lo && rl[j] < hi) rl[j] = rl[j] - lo < hi - rl[j] ? lo : hi;
        if (rl[j] < -lim) rl[j] = hi;
        if (rl[j] > lim) rl[j] = lo;
      }
      for (const h of track.hazards) {
        if (h.kind !== 'crate') continue;
        const delta = Math.abs(((s - h.s + L * 1.5) % L) - L / 2);
        if (delta < h.radius + 6) {
          const lo = h.d - h.radius - 3, hi = h.d + h.radius + 3;
          if (rl[j] > lo && rl[j] < hi) rl[j] = rl[j] - lo < hi - rl[j] && lo > -lim ? lo : hi < lim ? hi : lo;
        }
      }
      rl[j] = clamp(rl[j], -lim, lim);
    }
  };
  avoid();
  smoothArray(rl, 6, 2);
  avoid();
  smoothArray(rl, 2, 1);
  avoid();

  // 9. Item boxes.
  for (const u of def.itemRows) {
    const s = u * L;
    const j = mod(Math.round(s / ds), n);
    for (const f of [-0.55, -0.18, 0.18, 0.55]) {
      const d = f * hw[j];
      const w = worldAt(track, s, d);
      track.boxes.push({ s, d, x: w.x, y: w.y + 1.1, z: w.z });
    }
  }

  // 10. Starting grid (behind the line, staggered pairs).
  for (let k = 0; k < 8; k++) {
    const s = mod(-7 - k * 4.2, L);
    const j = mod(Math.round(s / ds), n);
    const d = (k % 2 === 0 ? -1 : 1) * hw[j] * 0.36;
    const w = worldAt(track, s, d);
    track.grid.push({ s, d, x: w.x, y: w.y, z: w.z, heading: Math.atan2(tx[j], tz[j]) });
  }

  for (let j = 0; j < n; j++) {
    const b = track.bounds;
    const e = Math.max(limL[j], limR[j]) + 4;
    b.minX = Math.min(b.minX, px[j] - e);
    b.maxX = Math.max(b.maxX, px[j] + e);
    b.minZ = Math.min(b.minZ, pz[j] - e);
    b.maxZ = Math.max(b.maxZ, pz[j] + e);
    b.minY = Math.min(b.minY, py[j]);
    b.maxY = Math.max(b.maxY, py[j]);
  }
  return track;
}

/** Interpolated centerline frame at arc length s. */
export function frameAt(track: Track, s: number, out: TrackLoc): TrackLoc {
  const { n, ds } = track;
  const f = mod(s, track.length) / ds;
  const a = Math.floor(f) % n;
  const b = (a + 1) % n;
  const t = f - Math.floor(f);
  out.s = mod(s, track.length);
  out.i = a;
  out.cx = track.px[a] + (track.px[b] - track.px[a]) * t;
  out.cy = track.py[a] + (track.py[b] - track.py[a]) * t;
  out.cz = track.pz[a] + (track.pz[b] - track.pz[a]) * t;
  const rxv = track.rx[a] + (track.rx[b] - track.rx[a]) * t;
  const rzv = track.rz[a] + (track.rz[b] - track.rz[a]) * t;
  const rl = Math.hypot(rxv, rzv) || 1;
  out.rx = rxv / rl;
  out.rz = rzv / rl;
  // right = (-tz, tx), so tangent = (rz, -rx).
  out.tx = out.rz;
  out.tz = -out.rx;
  out.ty = track.ty[a] + (track.ty[b] - track.ty[a]) * t;
  out.hw = track.hw[a] + (track.hw[b] - track.hw[a]) * t;
  return out;
}

const tmpLoc = newLoc();

/** World position of track coordinates (s, d) on the ground surface. Allocates; not for hot paths. */
export function worldAt(track: Track, s: number, d: number): { x: number; y: number; z: number } {
  frameAt(track, s, tmpLoc);
  const a = tmpLoc.i;
  return { x: tmpLoc.cx + tmpLoc.rx * d, y: tmpLoc.cy + d * track.slope[a], z: tmpLoc.cz + tmpLoc.rz * d };
}

/** Ground height at track coordinates, including banking and ramps. */
export function groundHeight(track: Track, s: number, d: number, i: number, cy: number): number {
  let y = cy + d * track.slope[i];
  const ri = track.rampAt[i];
  if (ri >= 0) {
    const r = track.ramps[ri];
    if (Math.abs(d - r.d) <= r.halfW) {
      let rel = s - (r.sLip - r.len);
      if (rel < -track.length / 2) rel += track.length;
      if (rel > track.length / 2) rel -= track.length;
      if (rel >= 0 && rel <= r.len) y += (r.height * rel) / r.len;
    }
  }
  return y;
}

/**
 * Projects a world point onto the track. With a hint, searches only near the
 * hint (fast, and keeps karts on their own stretch of road where the layout
 * passes close to itself). Without one, searches the whole track.
 */
export function locate(track: Track, x: number, y: number, z: number, hintS: number | null, out: TrackLoc): TrackLoc {
  const { n, ds, px, py, pz } = track;
  let best = 0;
  let bestDist = Infinity;
  if (hintS === null) {
    for (let j = 0; j < n; j++) {
      const ex = x - px[j], ey = y - py[j], ez = z - pz[j];
      const dist = ex * ex + ez * ez + ey * ey * 0.25;
      if (dist < bestDist) {
        bestDist = dist;
        best = j;
      }
    }
  } else {
    const i0 = Math.round(hintS / ds);
    for (let k = -28; k <= 28; k++) {
      const j = mod(i0 + k, n);
      const ex = x - px[j], ey = y - py[j], ez = z - pz[j];
      const dist = ex * ex + ez * ez + ey * ey * 0.25;
      if (dist < bestDist) {
        bestDist = dist;
        best = j;
      }
    }
  }
  // Refine on the neighbouring segments.
  let a = best, t = 0, segBest = Infinity;
  for (let o = -1; o <= 0; o++) {
    const ia = mod(best + o, n), ib = (ia + 1) % n;
    const sx = px[ib] - px[ia], sz = pz[ib] - pz[ia];
    const l2 = sx * sx + sz * sz || 1;
    const tt = clamp(((x - px[ia]) * sx + (z - pz[ia]) * sz) / l2, 0, 1);
    const qx = px[ia] + sx * tt - x, qz = pz[ia] + sz * tt - z;
    const dd = qx * qx + qz * qz;
    if (dd < segBest) {
      segBest = dd;
      a = ia;
      t = tt;
    }
  }
  frameAt(track, (a + t) * ds, out);
  const i = out.i;
  out.d = (x - out.cx) * out.rx + (z - out.cz) * out.rz;
  const right = out.d >= 0;
  out.lim = right ? track.limR[i] : track.limL[i];
  out.wall = (right ? track.wallR[i] : track.wallL[i]) === 1;
  out.groundY = groundHeight(track, out.s, out.d, i, out.cy);
  out.hasGround = track.gap[i] === 0 && Math.abs(out.d) <= out.lim + (out.wall ? 2 : 0);
  return out;
}
