// Core simulation types. Everything in RaceState is plain, JSON-serializable data.

export type PlayerId = number;

export interface FrameInput {
  /** -1 = full left, +1 = full right. */
  steer: number;
  throttle: number;
  brake: number;
  /** Drift / hop / trick button. */
  drift: boolean;
  useItem: boolean;
  lookBack: boolean;
}

export const NEUTRAL_INPUT: Readonly<FrameInput> = Object.freeze({
  steer: 0,
  throttle: 0,
  brake: 0,
  drift: false,
  useItem: false,
  lookBack: false,
});

export type ItemType =
  | 'zoom'
  | 'tripleZoom'
  | 'peel'
  | 'bouncePuck'
  | 'seekerPuck'
  | 'crownComet'
  | 'supernova'
  | 'shrinkRay';

export const ITEM_TYPES: readonly ItemType[] = [
  'zoom',
  'tripleZoom',
  'peel',
  'bouncePuck',
  'seekerPuck',
  'crownComet',
  'supernova',
  'shrinkRay',
];

export type SpeedClass = 50 | 100 | 150;

export type HitKind = 'spin' | 'tumble' | 'squash';

export interface KartConfig {
  id: PlayerId;
  characterId: string;
  /** Mild rubber-band assist. Karts without it are the reference the assist measures against. */
  catchUp: boolean;
}

export interface RaceConfig {
  trackId: string;
  speedClass: SpeedClass;
  /** Grid order: index 0 starts on pole. */
  karts: KartConfig[];
  /** Item boxes on the track. */
  items: boolean;
  /** Item every kart starts with (time trial). */
  startItem: ItemType | null;
  laps: number;
}

export interface KartState {
  id: PlayerId;
  characterId: string;
  catchUp: boolean;

  // Pose and motion (world space; y is up).
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  heading: number;
  grounded: boolean;
  /** Ticks spent airborne; 0 when grounded. */
  airTicks: number;
  /** True while in a drift hop (keeps full steering authority). */
  hopping: boolean;
  fromRamp: boolean;
  trick: boolean;

  // Track coordinates.
  s: number;
  d: number;
  offroad: boolean;
  lastSafeS: number;

  // Drifting.
  drift: number; // -1 left, 0 none, 1 right
  driftCharge: number;
  driftTier: number;

  // Boosting.
  boostTicks: number;
  boostKind: number; // 0 none, 1 pad/item, 2 mini-turbo, 3 start/trick
  padLatch: number;
  stallTicks: number;
  throttleSince: number;

  // Status effects.
  hit: HitKind | null;
  hitTicks: number;
  invulnTicks: number;
  starTicks: number;
  shrinkTicks: number;
  fallTicks: number;

  // Items.
  item: ItemType | null;
  itemCount: number;
  rouletteTicks: number;
  trailing: ItemType | null;

  // Previous button states for edge detection.
  prevDrift: boolean;
  prevItem: boolean;

  // Race progress.
  lap: number;
  nextCp: number;
  lapStartTick: number;
  lapTimes: number[];
  finished: boolean;
  finishTick: number;
  place: number;
  wrongWayTicks: number;
  wrongWay: boolean;
  /** Last steering value (for visuals). */
  steer: number;
}

export type ProjectileKind = 'bounce' | 'seeker' | 'comet';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  owner: PlayerId;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  s: number;
  d: number;
  /** Absolute progress along the race (laps * length + s) for track-following projectiles. */
  progress: number;
  ttl: number;
  bounces: number;
  target: PlayerId;
  /** Ticks during which the owner cannot be hit by it. */
  grace: number;
}

export interface Peel {
  id: number;
  owner: PlayerId;
  x: number;
  y: number;
  z: number;
  s: number;
  ttl: number;
  grace: number;
}

export type RaceEvent =
  | { type: 'countdown'; n: number }
  | { type: 'boost'; kart: PlayerId; kind: 'pad' | 'item' | 'turbo' | 'start' | 'trick' }
  | { type: 'driftTier'; kart: PlayerId; tier: number }
  | { type: 'hit'; kart: PlayerId; hit: HitKind }
  | { type: 'blocked'; kart: PlayerId }
  | { type: 'itemGet'; kart: PlayerId }
  | { type: 'itemReady'; kart: PlayerId; item: ItemType }
  | { type: 'itemUse'; kart: PlayerId; item: ItemType }
  | { type: 'lap'; kart: PlayerId; lap: number }
  | { type: 'finish'; kart: PlayerId; place: number }
  | { type: 'fall'; kart: PlayerId }
  | { type: 'respawn'; kart: PlayerId }
  | { type: 'wall'; kart: PlayerId; strength: number }
  | { type: 'bump'; kart: PlayerId; other: PlayerId }
  | { type: 'land'; kart: PlayerId }
  | { type: 'jump'; kart: PlayerId }
  | { type: 'trick'; kart: PlayerId }
  | { type: 'explode'; x: number; y: number; z: number }
  | { type: 'shrink'; by: PlayerId }
  | { type: 'star'; kart: PlayerId };

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RaceState {
  version: 1;
  config: RaceConfig;
  tick: number;
  phase: RacePhase;
  countdown: number;
  goTick: number;
  rng: number;
  karts: KartState[];
  /** Ticks until each item box respawns (0 = present). */
  boxes: number[];
  projectiles: Projectile[];
  peels: Peel[];
  nextEntityId: number;
  /** Finishing order. */
  finishOrder: PlayerId[];
  /** Events emitted during the most recent tick. */
  events: RaceEvent[];
}
