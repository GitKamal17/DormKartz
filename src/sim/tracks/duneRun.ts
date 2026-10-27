import { PathBuilder, at } from '../track/path';
import type { TrackDef } from '../track/types';

const p = new PathBuilder('dune-run', 22)
  .mark('start')
  .straight(80, { adjust: true })
  .right(40, 90)
  .straight(30, { dy: 8 })
  .mark('sweep')
  .right(35, 90, { dy: 2 })
  .mark('weeds')
  .straight(70, { dy: -6 })
  .mark('hairpin')
  .left(32, 180)
  .mark('pit')
  .straight(80, { width: 30 })
  .mark('pitEnd')
  .right(45, 90, { width: 22 })
  .straight(20, { dy: -4 })
  .mark('cut')
  .right(55, 120)
  .mark('cutEnd')
  .straight(100, { adjust: true })
  .right(40, 60)
  .straight(140, { adjust: true })
  .right(40, 90)
  .build();

export const duneRun: TrackDef = {
  id: 'dune-run',
  name: 'Dune Run',
  cup: 'sprout',
  order: 2,
  description: 'Rolling dunes, tumbleweeds and a quicksand pit that eats karts.',
  laps: 3,
  points: p.points,
  defaultWidth: 22,
  shoulder: 9,
  walls: true,
  autoBank: 0.8,
  grip: 0.95,
  edges: [{ from: at(p, 'cut', 6), to: at(p, 'cutEnd', -6), side: 'right', shoulder: 34 }],
  slowZones: [{ from: at(p, 'pit', 25), to: at(p, 'pit', 65), dMin: -6, dMax: 6, factor: 0.3, kind: 'quicksand' }],
  boostPads: [
    { u: at(p, 'start', 50), d: 4 },
    { u: at(p, 'pitEnd', -10), d: -10 },
  ],
  ramps: [{ u: at(p, 'weeds', 62), height: 1.5, width: 10, d: -4 }],
  itemRows: [at(p, 'sweep', -20), at(p, 'pit', 8)],
  hazards: [
    { kind: 'roller', style: 'tumbleweed', u: at(p, 'weeds', 18), amplitude: 9, period: 3.2, phase: 0, radius: 1.3, hit: 'spin' },
    { kind: 'roller', style: 'tumbleweed', u: at(p, 'weeds', 40), amplitude: 9, period: 2.6, phase: 1.7, radius: 1.3, hit: 'spin' },
    { kind: 'roller', style: 'tumbleweed', u: at(p, 'start', 80), amplitude: 8, period: 3.6, phase: 0.6, radius: 1.3, hit: 'spin' },
  ],
  decorations: [
    { type: 'cactus', count: 60, minOffset: 3, maxOffset: 40 },
    { type: 'rock', count: 40, minOffset: 3, maxOffset: 50, scale: [1, 3] },
    { type: 'pillar', count: 10, minOffset: 8, maxOffset: 40, scale: [2, 4] },
    { type: 'banner', count: 6, minOffset: 1, maxOffset: 2 },
  ],
  theme: {
    skyTop: 0x4a9be0,
    skyHorizon: 0xffe0b0,
    fog: 0xf5d7a8,
    fogNear: 120,
    fogFar: 480,
    ground: 'sand',
    groundColor: 0xe0b46c,
    groundDepth: 0.3,
    road: 'sand',
    roadColor: 0xb48a5a,
    lineColor: 0xfff0d0,
    shoulderColor: 0xe8c07a,
    wallColor: 0x9a6a3a,
    wallStyle: 'fence',
    sunColor: 0xffe2b0,
    sunIntensity: 2.8,
    sunDir: [-0.4, 1, 0.5],
    ambient: 0xffe8c8,
    ambientIntensity: 1.0,
  },
  music: { tempo: 116, root: 57, scale: 'phrygian', style: 'driving', seed: 23 },
};
