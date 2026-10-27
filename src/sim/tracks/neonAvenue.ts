import { PathBuilder, at } from '../track/path';
import type { TrackDef } from '../track/types';

const p = new PathBuilder('neon-avenue', 24)
  .mark('start')
  .straight(120, { adjust: true })
  .right(26, 90)
  .mark('tunnel')
  .straight(60)
  .mark('tunnelEnd')
  .left(26, 90)
  .straight(40)
  .right(26, 90)
  .mark('blvd')
  .straight(80, { adjust: true, dy: 4 })
  .right(26, 90)
  .mark('long')
  .straight(150, { dy: -4 })
  .right(26, 90)
  .straight(60)
  .mark('chicane')
  .left(30, 45)
  .right(30, 45)
  .straight(50)
  .right(26, 90)
  .build();

export const neonAvenue: TrackDef = {
  id: 'neon-avenue',
  name: 'Neon Avenue',
  cup: 'ember',
  order: 6,
  description: 'Night city streets. The traffic does not care that you are racing.',
  laps: 3,
  points: p.points,
  defaultWidth: 24,
  shoulder: 3,
  walls: true,
  autoBank: 0.3,
  grip: 1,
  tunnels: [{ from: at(p, 'tunnel', -4), to: at(p, 'tunnelEnd', 4) }, { from: at(p, 'long', 40), to: at(p, 'long', 100) }],
  boostPads: [
    { u: at(p, 'start', 60), d: -6 },
    { u: at(p, 'long', 70), d: 6 },
    { u: at(p, 'chicane', -20), d: 0 },
  ],
  itemRows: [at(p, 'start', 30), at(p, 'blvd', 30), at(p, 'long', 20)],
  hazards: [{ kind: 'traffic', count: 7, lanes: [-6.5, 6.5], speed: 15, direction: 1 }],
  decorations: [
    { type: 'building', count: 90, minOffset: 4, maxOffset: 40, scale: [1, 2.6] },
    { type: 'neon', count: 30, minOffset: 1, maxOffset: 4 },
    { type: 'lamp', count: 40, minOffset: 0.5, maxOffset: 1.5 },
  ],
  theme: {
    skyTop: 0x05040f,
    skyHorizon: 0x2a1250,
    fog: 0x150a2a,
    fogNear: 80,
    fogFar: 400,
    ground: 'city',
    groundColor: 0x1b1a24,
    groundDepth: 0.4,
    road: 'neon',
    roadColor: 0x2a2a36,
    lineColor: 0x37f0ff,
    shoulderColor: 0x3a3a48,
    wallColor: 0xff3fb4,
    wallStyle: 'neon',
    sunColor: 0x9a8cff,
    sunIntensity: 1.0,
    sunDir: [0.2, 1, 0.1],
    ambient: 0x8a7ad0,
    ambientIntensity: 1.0,
    stars: true,
  },
  music: { tempo: 132, root: 57, scale: 'minor', style: 'synth', seed: 67 },
};
