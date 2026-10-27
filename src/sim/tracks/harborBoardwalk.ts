import { PathBuilder, at } from '../track/path';
import type { TrackDef } from '../track/types';

const p = new PathBuilder('harbor-boardwalk', 20)
  .mark('start')
  .straight(90, { adjust: true })
  .right(36, 90)
  .mark('jump1')
  .straight(90)
  .right(30, 90)
  .straight(40)
  .left(28, 90)
  .mark('crates')
  .straight(60)
  .mark('beach')
  .right(42, 180)
  .mark('beachEnd')
  .straight(60, { adjust: true })
  .left(30, 90)
  .mark('jump2')
  .straight(60)
  .right(35, 90)
  .straight(30)
  .right(35, 90)
  .build();

export const harborBoardwalk: TrackDef = {
  id: 'harbor-boardwalk',
  name: 'Harbor Boardwalk',
  cup: 'sprout',
  order: 3,
  description: 'Seaside docks with two water jumps. Keep your speed up.',
  laps: 3,
  points: p.points,
  defaultWidth: 20,
  shoulder: 3,
  walls: true,
  autoBank: 0.6,
  grip: 1,
  edges: [
    { from: at(p, 'beach', 6), to: at(p, 'beachEnd', -6), side: 'right', shoulder: 30 },
    { from: at(p, 'jump1', 20), to: at(p, 'jump1', 60), side: 'both', wall: false, shoulder: 1 },
    { from: at(p, 'jump2', 10), to: at(p, 'jump2', 46), side: 'both', wall: false, shoulder: 1 },
  ],
  gaps: [
    { from: at(p, 'jump1', 36), to: at(p, 'jump1', 48) },
    { from: at(p, 'jump2', 26), to: at(p, 'jump2', 36) },
  ],
  ramps: [
    { u: at(p, 'jump1', 34), height: 2.2, length: 12 },
    { u: at(p, 'jump2', 24), height: 2.2, length: 12 },
  ],
  boostPads: [
    { u: at(p, 'jump1', 16), d: 0, width: 8 },
    { u: at(p, 'jump2', 8), d: 0, width: 8 },
  ],
  itemRows: [at(p, 'start', 40), at(p, 'beachEnd', 20)],
  hazards: [
    { kind: 'crate', u: at(p, 'crates', 14), d: -4, radius: 1.6 },
    { kind: 'crate', u: at(p, 'crates', 30), d: 5, radius: 1.6 },
    { kind: 'crate', u: at(p, 'crates', 46), d: -2, radius: 1.6 },
    { kind: 'crate', u: at(p, 'start', 70), d: 6, radius: 1.6 },
  ],
  decorations: [
    { type: 'palm', count: 30, minOffset: 3, maxOffset: 30 },
    { type: 'buoy', count: 40, minOffset: 8, maxOffset: 60 },
    { type: 'house', count: 12, minOffset: 10, maxOffset: 40 },
    { type: 'lamp', count: 20, minOffset: 0.5, maxOffset: 1.5 },
  ],
  theme: {
    skyTop: 0x2f7fd6,
    skyHorizon: 0xd2f0ff,
    fog: 0xc6ecff,
    fogNear: 140,
    fogFar: 520,
    ground: 'water',
    groundColor: 0x1e86c8,
    groundDepth: 4,
    road: 'boards',
    roadColor: 0xa47548,
    lineColor: 0xf5e6c8,
    shoulderColor: 0xf0dca0,
    wallColor: 0xf5f5f5,
    wallStyle: 'rope',
    sunColor: 0xfff6e0,
    sunIntensity: 2.6,
    sunDir: [0.3, 1, -0.4],
    ambient: 0xcfeaff,
    ambientIntensity: 1.1,
  },
  music: { tempo: 122, root: 62, scale: 'mixolydian', style: 'chill', seed: 37 },
};
