// Original DormKartz roster. Stats are 1..5. The visual description is used by
// the renderer (src/render/kartModel.ts) to build each character from primitives.

import { PHYS, SPEED_CLASS } from './config';
import type { SpeedClass } from './types';

export interface CharacterDef {
  id: string;
  name: string;
  blurb: string;
  speed: number;
  accel: number;
  handling: number;
  weight: number;
  /** Primary and secondary colors (hex). */
  color: number;
  accent: number;
}

export const CHARACTERS: readonly CharacterDef[] = [
  { id: 'bolt', name: 'Bolt', blurb: 'Dorm-built robot. Runs on energy drinks.', speed: 4, accel: 3, handling: 2, weight: 4, color: 0x3a8dde, accent: 0xd8dde6 },
  { id: 'pip', name: 'Pip', blurb: 'Tiny penguin, huge launch.', speed: 2, accel: 5, handling: 5, weight: 1, color: 0x22252e, accent: 0xf2f2f2 },
  { id: 'rosa', name: 'Rosa', blurb: 'Quick fox with a quicker grin.', speed: 3, accel: 4, handling: 4, weight: 2, color: 0xf07a2a, accent: 0xfff3e0 },
  { id: 'grit', name: 'Grit', blurb: 'Swamp croc. Hard to stop once rolling.', speed: 5, accel: 2, handling: 1, weight: 5, color: 0x4f9a3c, accent: 0xe8d36a },
  { id: 'mabel', name: 'Mabel', blurb: 'Hexes the racing line.', speed: 3, accel: 3, handling: 5, weight: 2, color: 0x8a4fd0, accent: 0x2b1d3a },
  { id: 'tank', name: 'Tank', blurb: 'Bear. Bumps first, apologizes never.', speed: 4, accel: 2, handling: 2, weight: 5, color: 0x8b5a33, accent: 0xe0b98a },
  { id: 'zip', name: 'Zip', blurb: 'Bee with a sugar rush.', speed: 3, accel: 5, handling: 4, weight: 1, color: 0xf5c518, accent: 0x1c1c1c },
  { id: 'nova', name: 'Nova', blurb: 'Astronaut on study leave.', speed: 4, accel: 3, handling: 3, weight: 3, color: 0xf0f0f5, accent: 0xff5fa2 },
];

const byId = new Map(CHARACTERS.map((c) => [c.id, c]));

export function getCharacter(id: string): CharacterDef {
  const c = byId.get(id);
  if (!c) throw new Error(`Unknown character ${id}`);
  return c;
}

export interface KartStats {
  topSpeed: number;
  accel: number;
  yawMult: number;
  gripMult: number;
  mass: number;
}

const statsCache = new Map<string, KartStats>();

/** Derived physics stats for a character at a speed class. Pure and cached. */
export function getStats(characterId: string, cc: SpeedClass): KartStats {
  const key = characterId + '@' + cc;
  let s = statsCache.get(key);
  if (!s) {
    const c = getCharacter(characterId);
    const cls = SPEED_CLASS[cc];
    s = {
      topSpeed: PHYS.baseTopSpeed * cls.speed * (0.955 + 0.0225 * (c.speed - 1)),
      accel: PHYS.baseAccel * cls.accel * (0.85 + 0.075 * (c.accel - 1)),
      yawMult: 0.9 + 0.05 * (c.handling - 1),
      gripMult: 0.92 + 0.04 * (c.handling - 1),
      mass: 0.8 + 0.15 * (c.weight - 1),
    };
    statsCache.set(key, s);
  }
  return s;
}
