// Online play wire format, shared by the browser client and the Node server.
//
// The server is authoritative: it runs the same RaceSession the offline game
// uses, takes each player's packed FrameInput, and broadcasts state snapshots
// that clients interpolate. Messages are JSON over one WebSocket.

import type { KartState, PlayerId, RaceConfig, RaceEvent, RaceState, SpeedClass } from '../sim/types';

/** Bumped whenever the messages or the simulation change incompatibly. */
export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 8;
/** The server sends a snapshot every this many ticks (30 Hz). */
export const SNAPSHOT_EVERY = 2;
export const CODE_LENGTH = 4;
/** No 0/O or 1/I so codes are easy to read out loud. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface RoomSettings {
  trackId: string;
  cc: SpeedClass;
  cpus: boolean;
}

export interface RoomPlayer {
  id: PlayerId;
  name: string;
  characterId: string;
  connected: boolean;
  /** Still in the race that is running (false for anyone who joined during it). */
  racing: boolean;
}

export interface RoomInfo {
  code: string;
  hostId: PlayerId;
  players: RoomPlayer[];
  settings: RoomSettings;
  racing: boolean;
}

export interface RaceStart {
  /** Distinguishes races in one room (a rejoining client may be sent the same one again). */
  id: number;
  config: RaceConfig;
  seed: number;
  /** Human kart ids and their names. */
  humans: { id: PlayerId; name: string }[];
}

export type ClientMessage =
  | { type: 'create'; v: number; name: string }
  | { type: 'join'; v: number; code: string; name: string }
  | { type: 'rejoin'; v: number; code: string; token: string }
  | { type: 'leave' }
  | { type: 'pick'; characterId: string }
  | { type: 'settings'; settings: Partial<RoomSettings> }
  | { type: 'start' }
  | { type: 'input'; i: number };

export type ServerMessage =
  | { type: 'joined'; you: PlayerId; token: string; room: RoomInfo }
  | { type: 'room'; room: RoomInfo }
  | { type: 'error'; message: string }
  | { type: 'start'; race: RaceStart }
  | { type: 'snap'; s: Snapshot }
  | { type: 'end'; order: PlayerId[] };

/** RaceState minus what never changes (config) or the client doesn't need (rng). */
export interface Snapshot {
  tick: number;
  phase: RaceState['phase'];
  countdown: number;
  goTick: number;
  /** Each kart's values in `kartKeys()` order. */
  karts: unknown[][];
  boxes: number[];
  projectiles: RaceState['projectiles'];
  peels: RaceState['peels'];
  finishOrder: PlayerId[];
  /** Every event since the previous snapshot. */
  events: RaceEvent[];
}

let keys: (keyof KartState)[] | null = null;

/** Kart field order for snapshots. Same code on both ends gives the same order. */
function kartKeys(sample: KartState): (keyof KartState)[] {
  if (!keys) keys = Object.keys(sample) as (keyof KartState)[];
  return keys;
}

export function makeSnapshot(st: RaceState, events: RaceEvent[]): Snapshot {
  const ks = kartKeys(st.karts[0]);
  return {
    tick: st.tick,
    phase: st.phase,
    countdown: st.countdown,
    goTick: st.goTick,
    karts: st.karts.map((k) => ks.map((key) => k[key])),
    boxes: st.boxes,
    projectiles: st.projectiles,
    peels: st.peels,
    finishOrder: st.finishOrder,
    events,
  };
}

/** Writes a snapshot into an existing state (karts are updated in place). */
export function applySnapshot(st: RaceState, s: Snapshot): void {
  const ks = kartKeys(st.karts[0]);
  st.tick = s.tick;
  st.phase = s.phase;
  st.countdown = s.countdown;
  st.goTick = s.goTick;
  s.karts.forEach((vals, i) => {
    const k = st.karts[i] as unknown as Record<string, unknown>;
    ks.forEach((key, j) => (k[key] = vals[j]));
  });
  st.boxes = s.boxes;
  st.projectiles = s.projectiles;
  st.peels = s.peels;
  st.finishOrder = s.finishOrder;
  st.events = [];
}

/** JSON with non-integers rounded to 3 decimals (plenty for drawing, much smaller). */
export function encode(msg: ServerMessage | ClientMessage): string {
  return JSON.stringify(msg, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v));
}

export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH);
}

export function cleanName(raw: string): string {
  const n = raw.replace(/[^\p{L}\p{N} _.\-!?']/gu, '').trim().slice(0, 14);
  return n || 'Racer';
}
