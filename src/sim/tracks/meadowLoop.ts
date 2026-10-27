import { PathBuilder, at } from '../track/path';
import type { TrackDef } from '../track/types';

const p = new PathBuilder('meadow-loop', 24)
  .mark('start')
  .straight(110, { adjust: true })
  .mark('t1')
  .right(45, 90)
  .straight(40, { dy: 6 })
  .mark('s1')
  .right(40, 45)
  .left(40, 45)
  .straight(30, { dy: -6 })
  .mark('cut')
  .right(55, 90)
  .mark('back')
  .straight(90, { dy: 3 })
  .right(45, 90)
  .mark('jump')
  .straight(120, { adjust: true, dy: -3 })
  .right(45, 90)
  .build();

export const meadowLoop: TrackDef = {
  id: 'meadow-loop',
  name: 'Meadow Loop',
  cup: 'sprout',
  order: 1,
  description: 'Wide, friendly hills. Learn to drift here.',
  laps: 3,
  points: p.points,
  defaultWidth: 24,
  shoulder: 7,
  walls: true,
  autoBank: 1,
  grip: 1,
  edges: [{ from: at(p, 'cut', 8), to: at(p, 'back', -8), side: 'right', shoulder: 30 }],
  boostPads: [
    { u: at(p, 'start', 55), d: 0 },
    { u: at(p, 'back', 45), d: -6 },
  ],
  ramps: [{ u: at(p, 'jump', 70), height: 1.6 }],
  itemRows: [at(p, 's1', -8), at(p, 'jump', 25)],
  hazards: [],
  decorations: [
    { type: 'tree', count: 70, minOffset: 4, maxOffset: 40 },
    { type: 'bush', count: 50, minOffset: 2, maxOffset: 20 },
    { type: 'flower', count: 120, minOffset: 1, maxOffset: 30 },
    { type: 'rock', count: 14, minOffset: 6, maxOffset: 40 },
    { type: 'banner', count: 8, minOffset: 1, maxOffset: 2 },
  ],
  theme: {
    skyTop: 0x3f86e0,
    skyHorizon: 0xbfe3ff,
    fog: 0xcfe8ff,
    fogNear: 140,
    fogFar: 520,
    ground: 'grass',
    groundColor: 0x5fae45,
    groundDepth: 0.3,
    road: 'asphalt',
    roadColor: 0x5a5d66,
    lineColor: 0xffffff,
    shoulderColor: 0x76c254,
    wallColor: 0xe84a3c,
    wallStyle: 'barrier',
    sunColor: 0xfff4d6,
    sunIntensity: 2.4,
    sunDir: [0.5, 1, 0.3],
    ambient: 0xbfdcff,
    ambientIntensity: 1.1,
  },
  music: { tempo: 128, root: 60, scale: 'major', style: 'bouncy', seed: 11 },
};
