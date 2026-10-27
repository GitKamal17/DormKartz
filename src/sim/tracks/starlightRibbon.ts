import { PathBuilder, at } from '../track/path';
import type { TrackDef } from '../track/types';

const p = new PathBuilder('starlight-ribbon', 18)
  .mark('start')
  .straight(60, { adjust: true })
  .right(40, 120, { dy: 10 })
  .straight(40, { dy: 6 })
  .mark('swirl')
  .left(28, 150)
  .mark('drop')
  .straight(60, { dy: -18 })
  .right(32, 210, { dy: 4 })
  .straight(90)
  .left(30, 90, { dy: 4 })
  .mark('jump')
  .straight(50, { dy: 2 })
  .right(30, 90)
  .straight(40, { dy: -4 })
  .right(36, 90)
  .mark('wiggle')
  .straight(80, { adjust: true })
  .left(30, 40, { dy: -3 })
  .right(30, 80)
  .left(30, 40, { dy: 3 })
  .straight(40, { adjust: true })
  .right(36, 90)
  .straight(40)
  .build();

export const starlightRibbon: TrackDef = {
  id: 'starlight-ribbon',
  name: 'Starlight Ribbon',
  cup: 'ember',
  order: 8,
  description: 'A glowing road in the night sky. No walls. No mercy.',
  laps: 3,
  points: p.points,
  defaultWidth: 18,
  shoulder: 1.5,
  walls: false,
  autoBank: 1.4,
  grip: 1.05,
  boostPads: [
    { u: at(p, 'start', 30), d: 0 },
    { u: at(p, 'drop', 20), d: 0 },
    { u: at(p, 'jump', 18), d: 0 },
  ],
  ramps: [{ u: at(p, 'jump', 38), height: 1.4, length: 8 }],
  itemRows: [at(p, 'start', 25), at(p, 'drop', 45)],
  hazards: [],
  decorations: [
    { type: 'cloud', count: 50, minOffset: 10, maxOffset: 80, scale: [2, 5] },
    { type: 'planet', count: 6, minOffset: 80, maxOffset: 160, scale: [6, 14] },
    { type: 'crystal', count: 25, minOffset: 6, maxOffset: 40 },
  ],
  theme: {
    skyTop: 0x02010a,
    skyHorizon: 0x1a1048,
    fog: 0x0a0624,
    fogNear: 120,
    fogFar: 600,
    ground: 'void',
    groundColor: 0x000000,
    groundDepth: 60,
    road: 'rainbow',
    roadColor: 0xffffff,
    lineColor: 0xffffff,
    shoulderColor: 0xffffff,
    wallColor: 0xffffff,
    wallStyle: 'neon',
    sunColor: 0xc8c0ff,
    sunIntensity: 1.2,
    sunDir: [0.2, 1, 0.4],
    ambient: 0xa090ff,
    ambientIntensity: 1.2,
    stars: true,
  },
  music: { tempo: 136, root: 64, scale: 'major', style: 'epic', seed: 97 },
};
