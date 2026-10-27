import { PathBuilder, at } from '../track/path';
import type { TrackDef } from '../track/types';

const p = new PathBuilder('magma-keep', 21)
  .mark('start')
  .straight(80, { adjust: true })
  .right(30, 90, { dy: 6 })
  .mark('crush1')
  .straight(70)
  .right(30, 90)
  .mark('lava1')
  .straight(50, { dy: -3 })
  .mark('lava1End')
  .left(25, 90)
  .straight(40, { dy: 3 })
  .right(25, 90)
  .mark('crush2')
  .straight(60, { dy: -3 })
  .mark('court')
  .right(40, 90)
  .mark('lava2')
  .straight(150, { adjust: true, dy: -3 })
  .mark('lava2End')
  .right(32, 90)
  .straight(80, { adjust: true })
  .build();

export const magmaKeep: TrackDef = {
  id: 'magma-keep',
  name: 'Magma Keep',
  cup: 'ember',
  order: 7,
  description: 'A fortress over a lava lake. Time the crushers, mind the edges.',
  laps: 3,
  points: p.points,
  defaultWidth: 21,
  shoulder: 2,
  walls: true,
  autoBank: 0.5,
  grip: 1,
  edges: [
    { from: at(p, 'court', 6), to: at(p, 'lava2', -6), side: 'right', shoulder: 22 },
    { from: at(p, 'lava1', 0), to: at(p, 'lava1End', 0), side: 'both', wall: false, shoulder: 1 },
    { from: at(p, 'lava2', 0), to: at(p, 'lava2End', 0), side: 'left', wall: false, shoulder: 2 },
  ],
  gaps: [{ from: at(p, 'lava1', 30), to: at(p, 'lava1', 39) }],
  ramps: [{ u: at(p, 'lava1', 28), height: 2, length: 10 }],
  boostPads: [
    { u: at(p, 'lava1', 12), d: 0, width: 8 },
    { u: at(p, 'start', 40), d: 0 },
    { u: at(p, 'lava2End', 10), d: -3 },
  ],
  itemRows: [at(p, 'start', 20), at(p, 'crush2', -15)],
  hazards: [
    { kind: 'crusher', u: at(p, 'crush1', 18), dMin: -11, dMax: 0, period: 2.4, phase: 0 },
    { kind: 'crusher', u: at(p, 'crush1', 38), dMin: 0, dMax: 11, period: 2.4, phase: 0.5 },
    { kind: 'crusher', u: at(p, 'crush1', 58), dMin: -11, dMax: 0, period: 2.4, phase: 0.25 },
    { kind: 'crusher', u: at(p, 'crush2', 20), dMin: -4, dMax: 11, period: 2.8, phase: 0 },
    { kind: 'crusher', u: at(p, 'crush2', 42), dMin: -11, dMax: 4, period: 2.8, phase: 0.5 },
  ],
  decorations: [
    { type: 'torch', count: 40, minOffset: 0.5, maxOffset: 1.5 },
    { type: 'pillar', count: 30, minOffset: 2, maxOffset: 20, scale: [1.5, 3] },
    { type: 'rock', count: 30, minOffset: 8, maxOffset: 60, scale: [2, 5] },
    { type: 'banner', count: 10, minOffset: 1, maxOffset: 2 },
  ],
  theme: {
    skyTop: 0x1a0505,
    skyHorizon: 0x8a2a10,
    fog: 0x4a1408,
    fogNear: 60,
    fogFar: 340,
    ground: 'lava',
    groundColor: 0xff5a10,
    groundDepth: 8,
    road: 'stone',
    roadColor: 0x5a5250,
    lineColor: 0xffb060,
    shoulderColor: 0x3a3230,
    wallColor: 0x6e625c,
    wallStyle: 'stone',
    sunColor: 0xff9050,
    sunIntensity: 1.6,
    sunDir: [0.4, 1, -0.3],
    ambient: 0xff7a40,
    ambientIntensity: 0.8,
  },
  music: { tempo: 140, root: 52, scale: 'phrygian', style: 'epic', seed: 79 },
};
