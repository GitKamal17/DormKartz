import { PathBuilder, at } from '../track/path';
import type { TrackDef } from '../track/types';

const p = new PathBuilder('frostbite-pass', 22)
  .mark('start')
  .straight(70, { adjust: true })
  .right(40, 90)
  .mark('climb')
  .straight(70, { dy: 4 })
  .left(30, 180, { dy: 4 })
  .straight(50, { dy: 4 })
  .right(30, 180, { dy: 4 })
  .mark('summit')
  .straight(90, { dy: 2 })
  .right(40, 90)
  .mark('descent')
  .straight(170, { dy: -18, adjust: true })
  .mark('lake')
  .right(60, 90)
  .mark('lakeEnd')
  .straight(90, { adjust: true })
  .right(40, 90)
  .build();

export const frostbitePass: TrackDef = {
  id: 'frostbite-pass',
  name: 'Frostbite Pass',
  cup: 'sprout',
  order: 4,
  description: 'Icy mountain road. Low grip, rolling snowballs, and a frozen lake to cut across.',
  laps: 3,
  points: p.points,
  defaultWidth: 22,
  shoulder: 6,
  walls: true,
  autoBank: 1.2,
  grip: 0.55,
  edges: [{ from: at(p, 'lake', 6), to: at(p, 'lakeEnd', -6), side: 'right', shoulder: 44 }],
  boostPads: [
    { u: at(p, 'start', 40), d: 0 },
    { u: at(p, 'lakeEnd', 30), d: 5 },
  ],
  itemRows: [at(p, 'climb', 20), at(p, 'lakeEnd', 50)],
  hazards: [
    { kind: 'roller', style: 'snowball', u: at(p, 'climb', 35), amplitude: 8, period: 3.4, phase: 0, radius: 1.9, hit: 'tumble' },
    { kind: 'roller', style: 'snowball', u: at(p, 'climb', 60), amplitude: 8, period: 3.0, phase: 2.0, radius: 1.9, hit: 'tumble' },
    { kind: 'roller', style: 'snowball', u: at(p, 'lakeEnd', 60), amplitude: 7, period: 2.8, phase: 1.0, radius: 1.9, hit: 'tumble' },
  ],
  decorations: [
    { type: 'pine', count: 110, minOffset: 3, maxOffset: 50, scale: [1, 1.8] },
    { type: 'snowman', count: 10, minOffset: 2, maxOffset: 12 },
    { type: 'rock', count: 25, minOffset: 4, maxOffset: 40, scale: [1, 2.5] },
    { type: 'crystal', count: 15, minOffset: 4, maxOffset: 30 },
  ],
  theme: {
    skyTop: 0x6d9fd8,
    skyHorizon: 0xe8f2ff,
    fog: 0xe3eef8,
    fogNear: 90,
    fogFar: 420,
    ground: 'snow',
    groundColor: 0xeef4fb,
    groundDepth: 0.3,
    road: 'ice',
    roadColor: 0x9fc7e6,
    lineColor: 0xffffff,
    shoulderColor: 0xf4f8fc,
    wallColor: 0x7fb6e0,
    wallStyle: 'ice',
    sunColor: 0xffffff,
    sunIntensity: 2.2,
    sunDir: [0.2, 1, 0.6],
    ambient: 0xdde9ff,
    ambientIntensity: 1.25,
  },
  music: { tempo: 110, root: 64, scale: 'dorian', style: 'chill', seed: 41 },
};
