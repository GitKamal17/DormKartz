import { PathBuilder, at } from '../track/path';
import type { TrackDef } from '../track/types';

const p = new PathBuilder('hollow-manor', 20)
  .mark('start')
  .straight(70, { adjust: true })
  .right(30, 90, { dy: 4 })
  .mark('boards1')
  .straight(60, { adjust: true })
  .mark('boards1End')
  .left(26, 90)
  .mark('jump')
  .straight(60, { dy: 2 })
  .right(32, 180)
  .straight(40, { dy: 6 })
  .right(30, 90)
  .mark('boards2')
  .straight(40)
  .mark('boards2End')
  .left(24, 90, { dy: -1 })
  .mark('bridge')
  .straight(30)
  .mark('hall')
  .right(30, 90, { dy: -5 })
  .straight(40, { dy: -6 })
  .right(30, 90)
  .build();

export const hollowManor: TrackDef = {
  id: 'hollow-manor',
  name: 'Hollow Manor',
  cup: 'ember',
  order: 5,
  description: 'A haunted mansion. Missing rails, a void below, a bridge over your own path, and things that float.',
  laps: 3,
  points: p.points,
  defaultWidth: 20,
  shoulder: 3,
  walls: true,
  autoBank: 0.6,
  grip: 1,
  edges: [
    { from: at(p, 'boards1', 0), to: at(p, 'boards1End', 0), side: 'both', wall: false, shoulder: 1 },
    { from: at(p, 'boards2', -4), to: at(p, 'boards2End', 4), side: 'left', wall: false, shoulder: 1 },
    { from: at(p, 'jump', 14), to: at(p, 'jump', 44), side: 'both', wall: false, shoulder: 1 },
  ],
  gaps: [{ from: at(p, 'jump', 30), to: at(p, 'jump', 40) }],
  ramps: [{ u: at(p, 'jump', 28), height: 2, length: 10 }],
  boostPads: [{ u: at(p, 'jump', 14), d: 0, width: 8 }],
  itemRows: [at(p, 'start', 30), at(p, 'hall', -14)],
  hazards: [
    { kind: 'roller', style: 'ghost', u: at(p, 'start', 55), amplitude: 7, period: 3.0, phase: 0, radius: 1.5, hit: 'spin' },
    { kind: 'roller', style: 'ghost', u: at(p, 'hall', 20), amplitude: 7, period: 2.6, phase: 1.4, radius: 1.5, hit: 'spin' },
    { kind: 'roller', style: 'ghost', u: at(p, 'boards2', 22), amplitude: 6, period: 3.6, phase: 2.6, radius: 1.5, hit: 'spin' },
  ],
  decorations: [
    { type: 'deadtree', count: 40, minOffset: 4, maxOffset: 40 },
    { type: 'tombstone', count: 50, minOffset: 2, maxOffset: 30 },
    { type: 'torch', count: 30, minOffset: 0.5, maxOffset: 1.5 },
    { type: 'pillar', count: 20, minOffset: 3, maxOffset: 12, scale: [1.5, 2.5] },
  ],
  theme: {
    skyTop: 0x0d0618,
    skyHorizon: 0x3a1f4f,
    fog: 0x24132f,
    fogNear: 40,
    fogFar: 260,
    ground: 'void',
    groundColor: 0x120a1a,
    groundDepth: 30,
    road: 'wood',
    roadColor: 0x5e3b25,
    lineColor: 0xd9c38a,
    shoulderColor: 0x4a3626,
    wallColor: 0x6b4fa0,
    wallStyle: 'stone',
    sunColor: 0xb59cff,
    sunIntensity: 1.7,
    sunDir: [-0.3, 1, -0.2],
    ambient: 0x6a4f9a,
    ambientIntensity: 1.5,
    flicker: true,
    stars: true,
  },
  music: { tempo: 100, root: 50, scale: 'harmonicMinor', style: 'spooky', seed: 53 },
};
