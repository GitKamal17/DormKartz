// Online play wire format, shared by the browser client and the Node server.
//
// The server is authoritative: it runs the same RaceSession the offline game
// uses, takes each player's numbered, packed FrameInputs, and broadcasts full
// state snapshots. Clients predict ahead of the server and use each snapshot
// to correct themselves (see netRace.ts). Messages are JSON over one WebSocket.

import type { KartState, PlayerId, RaceConfig, RaceEvent, RaceState, SpeedClass } from '../sim/types';

/** Bumped whenever the messages or the simulation change incompatibly. */
export const PROTOCOL_VERSION = 3;
export const MAX_PLAYERS = 8;
/** Players sharing one device (split screen: W A S D + I J K L). */
export const MAX_LOCAL = 2;
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
  /** Round trip to the server in ms, as their device last measured it (-1 until known). */
  ping: number;
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
  /** Adds a second player on this device (split screen). */
  | { type: 'add'; name: string }
  /** Removes one of this device's players (not the last; use leave for that). */
  | { type: 'drop'; id: PlayerId }
  /** `id` picks which of this device's players; the first by default. */
  | { type: 'pick'; characterId: string; id?: PlayerId }
  | { type: 'settings'; settings: Partial<RoomSettings> }
  | { type: 'start' }
  /** Sent every tick: `s` counts up by one per tick, `i` is one packed input per player on this device, in `you` order. */
  | { type: 'input'; s: number; i: number[] }
  /** Asks for a pong; `ms` reports this device's last measured round trip so others can see it. */
  | { type: 'ping'; t: number; ms?: number };

export type ServerMessage =
  /** `you` lists this device's players (P1 first). Sent again whenever that list changes. */
  | { type: 'joined'; you: PlayerId[]; token: string; room: RoomInfo }
  | { type: 'room'; room: RoomInfo }
  | { type: 'error'; message: string }
  | { type: 'start'; race: RaceStart }
  | { type: 'snap'; s: Snapshot }
  | { type: 'end'; order: PlayerId[] }
  | { type: 'pong'; t: number };

/** Everything in RaceState except config (sent once) and events (listed separately). */
export interface Snapshot {
  tick: number;
  phase: RaceState['phase'];
  countdown: number;
  goTick: number;
  rng: number;
  nextEntityId: number;
  /** Each kart's values in `kartKeys()` order. */
  karts: unknown[][];
  boxes: number[];
  projectiles: RaceState['projectiles'];
  peels: RaceState['peels'];
  finishOrder: PlayerId[];
  /** Every event since the previous snapshot. */
  events: RaceEvent[];
  /** The packed input each kart used on this tick, in kart order. */
  inputs: number[];
  /** Per remote human: [last input seq applied, inputs still queued at the server]. */
  acks: Record<PlayerId, [number, number]>;
}

let keys: (keyof KartState)[] | null = null;

/** Kart field order for snapshots. Same code on both ends gives the same order. */
function kartKeys(sample: KartState): (keyof KartState)[] {
  if (!keys) keys = Object.keys(sample) as (keyof KartState)[];
  return keys;
}

export function makeSnapshot(st: RaceState, events: RaceEvent[], inputs: number[], acks: Snapshot['acks']): Snapshot {
  const ks = kartKeys(st.karts[0]);
  return {
    tick: st.tick,
    phase: st.phase,
    countdown: st.countdown,
    goTick: st.goTick,
    rng: st.rng,
    nextEntityId: st.nextEntityId,
    karts: st.karts.map((k) => ks.map((key) => k[key])),
    boxes: st.boxes,
    projectiles: st.projectiles,
    peels: st.peels,
    finishOrder: st.finishOrder,
    events,
    inputs,
    acks,
  };
}

/** Writes a snapshot into an existing state (karts are updated in place). */
export function applySnapshot(st: RaceState, s: Snapshot): void {
  const ks = kartKeys(st.karts[0]);
  st.tick = s.tick;
  st.phase = s.phase;
  st.countdown = s.countdown;
  st.goTick = s.goTick;
  st.rng = s.rng;
  st.nextEntityId = s.nextEntityId;
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
