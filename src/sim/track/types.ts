// Track definition format. A track is one data file exporting a TrackDef; the
// generator in build.ts derives road surface, walls, collision, checkpoints,
// racing line and item boxes from it. Ranges are given as `u`, the fraction of a
// lap (0 = start line, 1 = back at the start line). Ranges may wrap (from > to).

import type { HitKind } from '../types';

export interface ControlPoint {
  x: number;
  y: number;
  z: number;
  /** Full road width at this point (defaults to TrackDef.defaultWidth). */
  width?: number;
  /** Extra banking in degrees; positive lowers the right-hand edge. */
  bank?: number;
}

export type Side = 'left' | 'right' | 'both';

export interface URange {
  from: number;
  to: number;
}

export interface EdgeRange extends URange {
  side: Side;
  /** false = open edge: drive past it and you fall. */
  wall?: boolean;
  /** Off-road shoulder width beyond the road edge. */
  shoulder?: number;
}

export interface BoostPadDef {
  u: number;
  /** Lateral offset of the pad center (negative = left). */
  d: number;
  length?: number;
  width?: number;
}

export interface RampDef {
  /** Position of the ramp lip (where you launch). */
  u: number;
  length?: number;
  height?: number;
  /** Ramp width; defaults to the full road. */
  width?: number;
  d?: number;
}

export interface SlowZoneDef extends URange {
  dMin: number;
  dMax: number;
  /** Top speed multiplier inside the zone. */
  factor: number;
  kind: 'quicksand' | 'mud' | 'slush';
}

export type HazardDef =
  | {
      kind: 'roller';
      style: 'tumbleweed' | 'snowball' | 'ghost';
      u: number;
      /** Lateral sweep amplitude (units). */
      amplitude: number;
      /** Seconds per full sweep. */
      period: number;
      phase: number;
      radius: number;
      hit: HitKind;
    }
  | {
      kind: 'traffic';
      count: number;
      lanes: number[];
      /** Units per second along the track. */
      speed: number;
      direction: 1 | -1;
    }
  | {
      kind: 'crusher';
      u: number;
      dMin: number;
      dMax: number;
      /** Seconds per cycle. */
      period: number;
      phase: number;
    }
  | { kind: 'crate'; u: number; d: number; radius: number };

export type DecorationType =
  | 'tree'
  | 'pine'
  | 'bush'
  | 'flower'
  | 'cactus'
  | 'rock'
  | 'palm'
  | 'lamp'
  | 'building'
  | 'torch'
  | 'crystal'
  | 'cloud'
  | 'snowman'
  | 'house'
  | 'pillar'
  | 'tombstone'
  | 'deadtree'
  | 'buoy'
  | 'neon'
  | 'banner'
  | 'planet';

export interface DecorationRule {
  type: DecorationType;
  count: number;
  /** Distance range from the track edge (wall/shoulder) outward. */
  minOffset: number;
  maxOffset: number;
  scale?: [number, number];
  side?: Side;
  /** Restrict to a part of the lap. */
  range?: URange;
}

export type RoadStyle = 'asphalt' | 'sand' | 'wood' | 'ice' | 'stone' | 'rainbow' | 'neon' | 'boards';
export type GroundKind = 'grass' | 'sand' | 'water' | 'snow' | 'lava' | 'void' | 'city' | 'dirt';
export type WallStyle = 'barrier' | 'fence' | 'rail' | 'stone' | 'neon' | 'ice' | 'rope';

export interface ThemeDef {
  skyTop: number;
  skyHorizon: number;
  fog: number;
  fogNear: number;
  fogFar: number;
  ground: GroundKind;
  groundColor: number;
  /** Ground plane height relative to the lowest point of the track. */
  groundDepth: number;
  road: RoadStyle;
  roadColor: number;
  lineColor: number;
  shoulderColor: number;
  wallColor: number;
  wallStyle: WallStyle;
  sunColor: number;
  sunIntensity: number;
  sunDir: [number, number, number];
  ambient: number;
  ambientIntensity: number;
  stars?: boolean;
  flicker?: boolean;
}

export type MusicStyle = 'bouncy' | 'chill' | 'driving' | 'spooky' | 'synth' | 'epic';

export interface MusicDef {
  tempo: number;
  /** MIDI note of the root. */
  root: number;
  scale: 'major' | 'minor' | 'dorian' | 'mixolydian' | 'phrygian' | 'harmonicMinor';
  style: MusicStyle;
  seed: number;
}

export interface TrackDef {
  id: string;
  name: string;
  cup: 'sprout' | 'ember';
  order: number;
  description: string;
  laps: number;
  points: ControlPoint[];
  defaultWidth: number;
  /** Default off-road shoulder width on each side. */
  shoulder: number;
  /** Default: walls along both edges. */
  walls: boolean;
  /** Multiplier for automatic banking in corners (0 = flat). */
  autoBank: number;
  /** Road grip multiplier (ice < 1). */
  grip: number;
  edges?: EdgeRange[];
  gaps?: URange[];
  boostPads?: BoostPadDef[];
  ramps?: RampDef[];
  slowZones?: SlowZoneDef[];
  itemRows: number[];
  hazards?: HazardDef[];
  decorations: DecorationRule[];
  /** Covered sections (render only). */
  tunnels?: URange[];
  theme: ThemeDef;
  music: MusicDef;
}
