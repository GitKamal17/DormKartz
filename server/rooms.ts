// Rooms for online play. Each room has a short code, up to MAX_PLAYERS humans
// and, while racing, one authoritative RaceSession that this server ticks.
// Nothing here touches sockets or the clock: main.ts feeds it messages and
// calls advance(), so tests can drive it directly.

import { packInput, unpackInput } from '../src/game/ghost';
import { RaceSession, type PlayerSlot } from '../src/game/session';
import { AIInput } from '../src/input/ai';
import { blankInput, type InputSource } from '../src/input/types';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_LOCAL,
  MAX_PLAYERS,
  PROTOCOL_VERSION,
  SNAPSHOT_EVERY,
  cleanName,
  encode,
  makeSnapshot,
  normalizeCode,
  type ClientMessage,
  type RaceStart,
  type RoomInfo,
  type RoomSettings,
  type ServerMessage,
} from '../src/net/protocol';
import { CHARACTERS } from '../src/sim/characters';
import { SPEED_CLASS, TICK_RATE } from '../src/sim/config';
import { TRACKS } from '../src/sim/tracks';
import { NEUTRAL_INPUT, type FrameInput, type PlayerId, type RaceEvent } from '../src/sim/types';

export interface Conn {
  send(data: string): void;
  close(): void;
}

/** How long a dropped player keeps their seat (phones drop the socket when the screen locks). */
const GRACE_TICKS = 60 * TICK_RATE;
/** Results stay up this long after the last human finishes before the room goes back to the lobby. */
const END_DELAY_TICKS = Math.round(3.5 * TICK_RATE);
const MAX_ROOMS = 500;
/** CPU kart ids start here so they never collide with player ids. */
const CPU_ID_BASE = 100;

const NEUTRAL_PACKED = packInput(NEUTRAL_INPUT);
/** Inputs waiting beyond this are dropped (the device will be told to slow down). */
const MAX_QUEUE = 8;
/** No input for this long (tab hidden, signal lost): let go of everything. */
const STARVE_TICKS = 15;

/**
 * A human on another device. They send one numbered input per tick; we use
 * one per tick in order, so their device can replay exactly what we haven't
 * applied yet. A short queue absorbs network jitter; if it runs dry the last
 * input is repeated.
 */
class RemoteInput implements InputSource {
  readonly kind = 'remote' as const;
  /** [seq, packed], oldest first. */
  private readonly queue: [number, number][] = [];
  private packed = NEUTRAL_PACKED;
  private lastSeq = -1;
  private starved = 0;
  /** Seq of the last input applied to the race. */
  ack = -1;
  private readonly out = blankInput();

  push(seq: number, packed: number): void {
    if (seq <= this.lastSeq) return;
    this.lastSeq = seq;
    // Re-quantize so a hostile client can't send out-of-range values.
    this.queue.push([seq, packInput(unpackInput(packed, this.out))]);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
  }

  get queued(): number {
    return this.queue.length;
  }

  /** Marks everything received as applied (a CPU is driving this kart now). */
  drain(): void {
    if (this.queue.length) this.ack = this.queue[this.queue.length - 1][0];
    this.queue.length = 0;
  }

  reset(): void {
    this.queue.length = 0;
    this.lastSeq = -1;
    this.ack = -1;
    this.starved = 0;
    this.packed = NEUTRAL_PACKED;
  }

  poll(): FrameInput {
    const next = this.queue.shift();
    if (next) {
      [this.ack, this.packed] = next;
      this.starved = 0;
    } else if (++this.starved > STARVE_TICKS) this.packed = NEUTRAL_PACKED;
    return unpackInput(this.packed, this.out);
  }
}

interface Player {
  id: PlayerId;
  name: string;
  characterId: string;
  token: string;
  conn: Conn | null;
  /** Tick (server clock) the connection dropped; -1 while connected. */
  droppedAt: number;
  input: RemoteInput;
  racing: boolean;
}

interface Race {
  id: number;
  session: RaceSession;
  events: RaceEvent[];
  endAt: number;
  ai: Map<PlayerId, AIInput>;
}

function randomToken(): string {
  return Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
}

function send(p: Player, msg: ServerMessage | string): void {
  if (!p.conn) return;
  try {
    p.conn.send(typeof msg === 'string' ? msg : encode(msg));
  } catch {
    // A failed send shows up as a close shortly after.
  }
}

export class Room {
  readonly players: Player[] = [];
  hostId: PlayerId = 0;
  settings: RoomSettings = { trackId: TRACKS[0].id, cc: 100, cpus: true };
  race: Race | null = null;
  private races = 0;

  constructor(readonly code: string) {}

  info(): RoomInfo {
    return {
      code: this.code,
      hostId: this.hostId,
      players: this.players.map((p) => ({ id: p.id, name: p.name, characterId: p.characterId, connected: !!p.conn, racing: p.racing })),
      settings: { ...this.settings },
      racing: !!this.race,
    };
  }

  broadcast(msg: ServerMessage): void {
    const data = encode(msg);
    for (const p of this.players) send(p, data);
  }

  sendRoom(): void {
    this.broadcast({ type: 'room', room: this.info() });
  }

  /** Seats a new player; a second player on the same device shares its token. */
  add(name: string, conn: Conn, token = randomToken()): Player | null {
    if (this.players.length >= MAX_PLAYERS) return null;
    let id = 0;
    while (this.players.some((p) => p.id === id)) id++;
    const taken = new Set(this.players.map((p) => p.characterId));
    const characterId = (CHARACTERS.find((c) => !taken.has(c.id)) ?? CHARACTERS[0]).id;
    const p: Player = { id, name: cleanName(name), characterId, token, conn, droppedAt: -1, input: new RemoteInput(), racing: false };
    this.players.push(p);
    if (this.players.length === 1) this.hostId = id;
    return p;
  }

  remove(p: Player): void {
    const i = this.players.indexOf(p);
    if (i < 0) return;
    this.players.splice(i, 1);
    if (this.race) this.dropFromRace(p);
    if (this.hostId === p.id && this.players.length) this.hostId = (this.players.find((x) => x.conn) ?? this.players[0]).id;
  }

  /** A CPU takes over the kart of someone who dropped out mid-race. */
  dropFromRace(p: Player): void {
    const slot = this.race?.session.slots.find((s) => s.id === p.id);
    if (!slot || !this.race) return;
    let ai = this.race.ai.get(p.id);
    if (!ai) {
      ai = new AIInput(0.8, `dropped-${p.id}-${this.race.session.state.tick}`);
      this.race.ai.set(p.id, ai);
    }
    slot.input = ai;
  }

  pick(p: Player, characterId: string): string | null {
    if (!CHARACTERS.some((c) => c.id === characterId)) return 'Unknown racer.';
    if (this.players.some((o) => o !== p && o.characterId === characterId)) return 'Someone already picked that racer.';
    p.characterId = characterId;
    return null;
  }

  private hosts(players: Player[]): boolean {
    return players.some((p) => p.id === this.hostId);
  }

  configure(players: Player[], s: Partial<RoomSettings>): string | null {
    if (!this.hosts(players)) return 'Only the host can change the race.';
    if (s.trackId !== undefined) {
      if (!TRACKS.some((t) => t.id === s.trackId)) return 'Unknown track.';
      this.settings.trackId = s.trackId;
    }
    if (s.cc !== undefined) {
      if (s.cc !== 50 && s.cc !== 100 && s.cc !== 150) return 'Unknown speed class.';
      this.settings.cc = s.cc;
    }
    if (s.cpus !== undefined) this.settings.cpus = !!s.cpus;
    return null;
  }

  start(players: Player[]): string | null {
    if (!this.hosts(players)) return 'Only the host can start the race.';
    if (this.race) return 'A race is already running.';
    const humans = this.players.filter((x) => x.conn);
    // Humans start at the back in a random order, like offline play.
    for (let i = humans.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [humans[i], humans[j]] = [humans[j], humans[i]];
    }
    const taken = new Set(humans.map((h) => h.characterId));
    const cpuChars = this.settings.cpus ? CHARACTERS.filter((c) => !taken.has(c.id)).map((c) => c.id) : [];
    for (let i = cpuChars.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cpuChars[i], cpuChars[j]] = [cpuChars[j], cpuChars[i]];
    }
    const base = SPEED_CLASS[this.settings.cc].cpuSkill;
    const cpus: PlayerSlot[] = cpuChars.slice(0, Math.max(0, 8 - humans.length)).map((c, i) => ({
      id: CPU_ID_BASE + i,
      kind: 'cpu',
      characterId: c,
      input: new AIInput(Math.min(1, Math.max(0.3, base - 0.12 + i * 0.04)), `cpu-${this.code}-${i}-${Math.random()}`),
      localIndex: -1,
    }));
    const people: PlayerSlot[] = humans.map((h) => ({ id: h.id, kind: 'remote', characterId: h.characterId, input: h.input, localIndex: -1 }));
    const seed = Math.floor(Math.random() * 1e9);
    const session = new RaceSession({ trackId: this.settings.trackId, speedClass: this.settings.cc, mode: 'single', slots: [...cpus, ...people], seed });
    for (const p2 of this.players) {
      p2.racing = humans.includes(p2);
      p2.input.reset();
    }
    this.race = { id: ++this.races, session, events: [], endAt: -1, ai: new Map() };
    this.broadcast({ type: 'start', race: this.raceStart() });
    this.snapshot();
    this.sendRoom();
    return null;
  }

  raceStart(): RaceStart {
    const r = this.race!;
    const humans = this.players.filter((p) => p.racing).map((p) => ({ id: p.id, name: p.name }));
    return { id: r.id, config: r.session.state.config, seed: r.session.seed, humans };
  }

  private snapshot(): void {
    const r = this.race!;
    const s = r.session;
    const inputs = s.state.karts.map((k) => packInput(s.inputs.get(k.id) ?? NEUTRAL_INPUT));
    const acks: Record<PlayerId, [number, number]> = {};
    for (const p of this.players) if (p.racing) acks[p.id] = [p.input.ack, p.input.queued];
    const data = encode({ type: 'snap', s: makeSnapshot(s.state, r.events, inputs, acks) });
    r.events = [];
    for (const p of this.players) if (p.racing) send(p, data);
  }

  /** Advances the race (if any) by one tick. */
  tick(): void {
    const r = this.race;
    if (!r) return;
    const s = r.session;
    // Once a kart finishes a CPU drives it; keep acknowledging what its player sends.
    for (const p of this.players) if (p.racing && s.kart(p.id).finished) p.input.drain();
    s.tick();
    for (const e of s.drainEvents()) r.events.push(e);
    if (s.state.tick % SNAPSHOT_EVERY === 0) this.snapshot();

    if (r.endAt < 0) {
      const racers = this.players.filter((p) => p.racing && p.conn);
      const allDone = racers.every((p) => s.kart(p.id).finished);
      if (allDone || s.state.phase === 'finished') r.endAt = s.state.tick + END_DELAY_TICKS;
    } else if (s.state.tick >= r.endAt) {
      this.snapshot();
      this.broadcast({ type: 'end', order: s.resultOrder() });
      this.race = null;
      for (const p of this.players) p.racing = false;
      this.sendRoom();
    }
  }
}

/** One connected socket (one device). It belongs to at most one room, with one or two players in it. */
class Client {
  room: Room | null = null;
  /** This device's players, P1 first. */
  players: Player[] = [];

  constructor(
    private readonly server: RoomServer,
    readonly conn: Conn,
  ) {}

  reply(msg: ServerMessage): void {
    try {
      this.conn.send(encode(msg));
    } catch {
      // Ignored; see send().
    }
  }

  error(message: string): void {
    this.reply({ type: 'error', message });
  }

  /** Tells the device who its players are, then everyone the new room state. */
  seated(): void {
    const room = this.room!;
    this.reply({ type: 'joined', you: this.players.map((p) => p.id), token: this.players[0].token, room: room.info() });
    room.sendRoom();
  }

  private mine(id: unknown): Player | undefined {
    return id === undefined ? this.players[0] : this.players.find((p) => p.id === id);
  }

  onMessage(raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'create':
      case 'join':
      case 'rejoin':
        if (msg.v !== PROTOCOL_VERSION) return this.error('This page is out of date. Reload it to get the latest version.');
        this.leave();
        if (msg.type === 'create') return this.server.create(this, String(msg.name ?? ''));
        if (msg.type === 'join') return this.server.join(this, String(msg.code ?? ''), String(msg.name ?? ''));
        return this.server.rejoin(this, String(msg.code ?? ''), String(msg.token ?? ''));
      case 'leave':
        return this.leave();
    }
    const room = this.room, first = this.players[0];
    if (!room || !first) return;
    let err: string | null = null;
    switch (msg.type) {
      case 'input': {
        if (!Number.isInteger(msg.s) || !Array.isArray(msg.i)) return;
        this.players.forEach((p, n) => {
          const packed = msg.i[n];
          if (Number.isInteger(packed) && packed >= 0) p.input.push(msg.s, packed);
        });
        return;
      }
      case 'add': {
        if (this.players.length >= MAX_LOCAL) return this.error(`Up to ${MAX_LOCAL} players can share one device.`);
        const p = room.add(String(msg.name ?? ''), this.conn, first.token);
        if (!p) return this.error('That room is full.');
        this.players.push(p);
        return this.seated();
      }
      case 'drop': {
        const p = this.mine(msg.id);
        if (!p || this.players.length < 2) return;
        this.players.splice(this.players.indexOf(p), 1);
        room.remove(p);
        return this.seated();
      }
      case 'pick': {
        const p = this.mine(msg.id);
        if (!p) return;
        err = room.pick(p, String(msg.characterId));
        break;
      }
      case 'settings':
        err = msg.settings && typeof msg.settings === 'object' ? room.configure(this.players, msg.settings) : 'Bad settings.';
        break;
      case 'start':
        err = room.start(this.players);
        break;
      default:
        return;
    }
    if (err) this.error(err);
    else if (msg.type !== 'start') room.sendRoom();
  }

  /** Leaves the current room on purpose (the seats are freed right away). */
  leave(): void {
    const room = this.room, players = this.players;
    this.room = null;
    this.players = [];
    if (!room || !players.length) return;
    for (const p of players) room.remove(p);
    this.server.cleanup(room);
    room.sendRoom();
  }

  /** The socket closed: keep the seats for a while so the players can come back. */
  onClose(): void {
    const room = this.room, players = this.players.filter((p) => p.conn === this.conn);
    this.room = null;
    this.players = [];
    if (!room || !players.length) return;
    for (const p of players) {
      p.conn = null;
      p.droppedAt = this.server.now;
      if (p.racing) room.dropFromRace(p);
    }
    if (players.some((p) => p.id === room.hostId)) {
      const other = room.players.find((x) => x.conn);
      if (other) room.hostId = other.id;
    }
    room.sendRoom();
  }
}

export class RoomServer {
  readonly rooms = new Map<string, Room>();
  /** Server clock in ticks. */
  now = 0;

  connect(conn: Conn): { message(raw: string): void; close(): void } {
    const c = new Client(this, conn);
    return { message: (raw) => c.onMessage(raw), close: () => c.onClose() };
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private seat(c: Client, room: Room, players: Player[]): void {
    c.room = room;
    c.players = players;
    c.seated();
  }

  create(c: Client, name: string): void {
    if (this.rooms.size >= MAX_ROOMS) return c.error('The server is full right now. Try again in a bit.');
    const room = new Room(this.newCode());
    this.rooms.set(room.code, room);
    this.seat(c, room, [room.add(name, c.conn)!]);
  }

  join(c: Client, rawCode: string, name: string): void {
    const room = this.rooms.get(normalizeCode(rawCode));
    if (!room) return c.error(`No room with code ${normalizeCode(rawCode) || '(blank)'}. Check the code with the host.`);
    const p = room.add(name, c.conn);
    if (!p) return c.error('That room is full.');
    this.seat(c, room, [p]);
  }

  /** Gives a device back all its seats (they share one token). */
  rejoin(c: Client, rawCode: string, token: string): void {
    const room = this.rooms.get(normalizeCode(rawCode));
    const players = room?.players.filter((x) => x.token === token) ?? [];
    if (!room || !players.length) return c.error('That room has closed.');
    for (const old of new Set(players.map((p) => p.conn))) {
      if (!old || old === c.conn) continue;
      try {
        old.close();
      } catch {
        // Already gone.
      }
    }
    for (const p of players) {
      p.conn = c.conn;
      p.droppedAt = -1;
      // A reloaded page numbers its inputs from scratch.
      p.input.reset();
    }
    this.seat(c, room, players);
    const r = room.race;
    if (r && players.some((p) => p.racing)) {
      for (const p of players) {
        const slot = r.session.slots.find((s) => s.id === p.id);
        if (slot && p.racing) slot.input = p.input;
      }
      c.reply({ type: 'start', race: room.raceStart() });
    }
  }
  cleanup(room: Room): void {
    if (!room.players.length) this.rooms.delete(room.code);
  }

  /** Advances every room by one tick. */
  advance(): void {
    this.now++;
    for (const room of this.rooms.values()) {
      room.tick();
      // Free the seats of players who didn't come back in time (not mid-race: their kart is still out there).
      if (!room.race) {
        const gone = room.players.filter((p) => !p.conn && this.now - p.droppedAt > GRACE_TICKS);
        if (gone.length) {
          for (const p of gone) room.remove(p);
          room.sendRoom();
        }
      }
      if (room.players.every((p) => !p.conn) && room.players.every((p) => this.now - p.droppedAt > GRACE_TICKS)) {
        this.rooms.delete(room.code);
      }
    }
  }
}
