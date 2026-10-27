// Item definitions and position-based odds.

import { nextRandom, type RngHolder } from './rng';
import { ITEM_TYPES, type ItemType } from './types';

export interface ItemDef {
  id: ItemType;
  name: string;
  description: string;
  /** Can be held behind the kart as a shield and deployed on release. */
  trailable: boolean;
}

export const ITEMS: Record<ItemType, ItemDef> = {
  zoom: { id: 'zoom', name: 'Zoom Pop', description: 'A single burst of speed.', trailable: false },
  tripleZoom: { id: 'tripleZoom', name: 'Triple Zoom', description: 'Three bursts of speed.', trailable: false },
  peel: { id: 'peel', name: 'Slick Peel', description: 'Drop it. Whoever hits it spins out.', trailable: true },
  bouncePuck: { id: 'bouncePuck', name: 'Bounce Puck', description: 'Fires straight and ricochets off walls.', trailable: true },
  seekerPuck: { id: 'seekerPuck', name: 'Seeker Puck', description: 'Chases the kart ahead of you.', trailable: true },
  crownComet: { id: 'crownComet', name: 'Crown Comet', description: 'Hunts down whoever is in 1st.', trailable: false },
  supernova: { id: 'supernova', name: 'Supernova', description: 'Invincible and faster for a while.', trailable: false },
  shrinkRay: { id: 'shrinkRay', name: 'Shrink Ray', description: 'Shrinks every opponent.', trailable: false },
};

// Odds per place (row 0 = 1st .. row 7 = 8th). Columns follow ITEM_TYPES order:
// zoom, tripleZoom, peel, bouncePuck, seekerPuck, crownComet, supernova, shrinkRay
const ODDS: readonly (readonly number[])[] = [
  [6, 0, 46, 34, 14, 0, 0, 0],
  [16, 4, 26, 26, 28, 0, 0, 0],
  [20, 10, 15, 20, 30, 3, 2, 0],
  [20, 20, 8, 14, 26, 6, 5, 1],
  [18, 30, 4, 8, 20, 8, 10, 2],
  [15, 35, 0, 5, 15, 10, 15, 5],
  [10, 36, 0, 0, 10, 9, 25, 10],
  [6, 36, 0, 0, 6, 9, 29, 14],
];

/** Rolls an item for a racer in `place` (1-based) out of `racers`. */
export function rollItem(h: RngHolder, place: number, racers: number, cometActive: boolean): ItemType {
  const row = racers <= 1 ? 0 : Math.round(((place - 1) / (racers - 1)) * 7);
  const weights = ODDS[Math.max(0, Math.min(7, row))];
  let total = 0;
  for (let i = 0; i < weights.length; i++) {
    if (cometActive && ITEM_TYPES[i] === 'crownComet') continue;
    total += weights[i];
  }
  let r = nextRandom(h) * total;
  for (let i = 0; i < weights.length; i++) {
    if (cometActive && ITEM_TYPES[i] === 'crownComet') continue;
    r -= weights[i];
    if (r < 0) return ITEM_TYPES[i];
  }
  return 'zoom';
}

export function itemUses(item: ItemType): number {
  return item === 'tripleZoom' ? 3 : 1;
}

export const ROULETTE_TICKS = 75;
