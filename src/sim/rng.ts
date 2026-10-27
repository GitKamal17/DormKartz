// Seeded RNG (mulberry32). The generator state is a plain uint32 so it can live
// inside serializable race state; the sim never calls Math.random().

export interface RngHolder {
  rng: number;
}

export function nextRandom(h: RngHolder): number {
  let t = (h.rng = (h.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function hashSeed(seed: number | string): number {
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Standalone RNG for non-sim code that still wants reproducibility (AI, track decoration). */
export class SeededRandom implements RngHolder {
  rng: number;
  constructor(seed: number | string) {
    this.rng = hashSeed(seed);
  }
  next(): number {
    return nextRandom(this);
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hiInclusive: number): number {
    return lo + Math.floor(this.next() * (hiInclusive - lo + 1));
  }
}
