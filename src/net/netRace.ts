// An online race as this device sees it. The server is authoritative, but
// waiting a round trip before your kart reacts feels terrible, so this device
// runs the same simulation itself ("prediction"): your kart responds on the
// very next tick, and everyone else carries on with the last inputs the server
// reported for them. Every snapshot rewinds the local race to the server's
// state and replays the inputs the server hasn't applied yet. Whatever moved
// because of that is blended back over a few frames instead of snapping.

import { packInput, quantize, unpackInput } from '../game/ghost';
import { PREV_STRIDE, RaceSession, type PlayerSlot } from '../game/session';
import { blankInput, type InputSource } from '../input/types';
import { step } from '../sim/race';
import { NEUTRAL_INPUT, type FrameInput, type PlayerId, type RaceEvent, type RaceState } from '../sim/types';
import { applySnapshot, type RaceStart, type Snapshot } from './protocol';

/** Unacknowledged inputs kept for replay (1 s; more means the connection is in trouble). */
const MAX_HISTORY = 60;
/** Corrections bigger than this (respawns, big misses) jump instead of sliding. */
const SNAP_DISTANCE = 6;
/** How fast corrections fade, per second. */
const SMOOTH_RATE = 12;
/** Inputs we'd like waiting at the server: enough to ride out jitter, few enough to stay snappy. */
const TARGET_QUEUE = 2;

export interface LocalPlayer {
  id: PlayerId;
  input: InputSource;
}

const idle: InputSource = { kind: 'remote', poll: () => blankInput() };

export class NetRace {
  /** What gets drawn: the predicted race with corrections blended in. */
  readonly session: RaceSession;
  readonly id: number;
  readonly humans: RaceStart['humans'];
  /** Final order once the server says the race is over. */
  order: PlayerId[] | null = null;
  /** Local tick rate multiplier that keeps our inputs arriving just in time at the server. */
  rate = 1;
  /** How far off the last prediction of each local kart was, in meters (for tests). */
  readonly lastCorrection = new Map<PlayerId, number>();

  private readonly sim: RaceState;
  private readonly simPrev: Float64Array;
  /** Per kart: visual x, y, z, heading offsets still being blended away. */
  private readonly offsets: Float64Array;
  private readonly before: Float64Array;
  private readonly history: { s: number; i: number[] }[] = [];
  private seq = 0;
  private readonly mine: Set<PlayerId>;
  private readonly known = new Map<PlayerId, FrameInput>();
  private readonly inputs = new Map<PlayerId, FrameInput>();
  private readonly scratch: FrameInput[];
  private readonly unpacked: FrameInput[];
  private lastSnap = -1;
  private queueAvg = TARGET_QUEUE;
  /** When (sim tick) we last showed each local event, so the server's copy isn't shown twice. */
  private readonly shown = new Map<string, number>();

  constructor(
    start: RaceStart,
    readonly locals: LocalPlayer[],
  ) {
    this.id = start.id;
    this.humans = start.humans;
    this.mine = new Set(locals.map((l) => l.id));
    const humanIds = new Set(start.humans.map((h) => h.id));
    const slots: PlayerSlot[] = start.config.karts.map((k) => {
      const local = locals.findIndex((l) => l.id === k.id);
      return {
        id: k.id,
        kind: local >= 0 ? 'local' : humanIds.has(k.id) ? 'remote' : 'cpu',
        characterId: k.characterId,
        input: local >= 0 ? locals[local].input : idle,
        localIndex: local,
      };
    });
    this.session = new RaceSession({ trackId: start.config.trackId, speedClass: start.config.speedClass, mode: 'single', slots, seed: start.seed });
    this.sim = structuredClone(this.session.state);
    const n = this.sim.karts.length * PREV_STRIDE;
    this.simPrev = new Float64Array(n);
    this.offsets = new Float64Array(n);
    this.before = new Float64Array(n);
    this.scratch = locals.map(() => blankInput());
    this.unpacked = locals.map(() => blankInput());
    this.savePrev();
  }

  get you(): PlayerId {
    return this.locals[0].id;
  }

  private savePrev(): void {
    const ks = this.sim.karts;
    for (let i = 0; i < ks.length; i++) {
      const o = i * PREV_STRIDE;
      this.simPrev[o] = ks[i].x;
      this.simPrev[o + 1] = ks[i].y;
      this.simPrev[o + 2] = ks[i].z;
      this.simPrev[o + 3] = ks[i].heading;
    }
  }

  private finished(id: PlayerId): boolean {
    return this.sim.karts.find((k) => k.id === id)!.finished;
  }

  /** One sim tick: local players use `packed` (until they finish), everyone else their last known input. */
  private stepSim(packed: number[] | null): void {
    for (const k of this.sim.karts) this.inputs.set(k.id, this.known.get(k.id) ?? NEUTRAL_INPUT);
    if (packed) {
      this.locals.forEach((l, n) => {
        if (!this.finished(l.id)) this.inputs.set(l.id, unpackInput(packed[n], this.unpacked[n]));
      });
    }
    step(this.sim, this.inputs);
  }

  private static key(e: RaceEvent): string | null {
    return 'kart' in e ? `${e.type}:${e.kart}` : null;
  }

  /**
   * Advances the local race by one tick with the players' current controls.
   * Returns the numbered input to send, or null once every local kart has finished.
   */
  tick(paused = false): { s: number; i: number[] } | null {
    const view = { state: this.sim, track: this.session.track };
    const packed: number[] = [];
    let driving = false;
    this.locals.forEach((l, n) => {
      const q = quantize(paused ? NEUTRAL_INPUT : l.input.poll(view, l.id), this.scratch[n]);
      this.session.lastInput.set(l.id, q);
      packed.push(packInput(q));
      if (!this.finished(l.id)) driving = true;
    });
    const sent = driving ? { s: ++this.seq, i: packed } : null;
    if (sent) {
      this.history.push(sent);
      if (this.history.length > MAX_HISTORY) this.history.shift();
    }
    this.savePrev();
    this.stepSim(sent ? packed : null);
    // Our own karts' events (and the countdown) show the moment they happen here.
    const now: RaceEvent[] = [];
    for (const e of this.sim.events) {
      const key = NetRace.key(e);
      if (e.type === 'countdown' || (key && 'kart' in e && this.mine.has(e.kart))) {
        now.push(e);
        if (key) this.shown.set(key, this.sim.tick);
      }
    }
    this.session.receive(now);
    return sent;
  }

  /** Rewinds to the server's state, replays what it hasn't seen, and blends the difference. */
  onSnapshot(s: Snapshot): void {
    if (s.tick <= this.lastSnap) return;
    this.lastSnap = s.tick;
    const sim = this.sim;

    // Everything else that happened, minus what we already showed when we predicted it.
    const later: RaceEvent[] = [];
    for (const e of s.events) {
      if (e.type === 'countdown') continue;
      const key = NetRace.key(e);
      if (key && 'kart' in e && this.mine.has(e.kart) && (this.shown.get(key) ?? -Infinity) >= s.tick - 60) continue;
      later.push(e);
    }
    this.session.receive(later);

    const me = s.acks[this.you];
    if (me) {
      while (this.history.length && this.history[0].s <= me[0]) this.history.shift();
      // Drift our clock so about TARGET_QUEUE inputs are waiting at the server.
      this.queueAvg += (me[1] - this.queueAvg) * 0.15;
      this.rate = this.queueAvg < TARGET_QUEUE - 1 ? 1.03 : this.queueAvg > TARGET_QUEUE + 1.5 ? 0.97 : 1;
    }
    s.inputs.forEach((p, i) => {
      const id = sim.karts[i].id;
      this.known.set(id, unpackInput(p, this.known.get(id) ?? blankInput()));
    });

    const ks = sim.karts;
    for (let i = 0; i < ks.length; i++) {
      const o = i * PREV_STRIDE;
      this.before[o] = ks[i].x + this.offsets[o];
      this.before[o + 1] = ks[i].y + this.offsets[o + 1];
      this.before[o + 2] = ks[i].z + this.offsets[o + 2];
      this.before[o + 3] = ks[i].heading + this.offsets[o + 3];
    }
    applySnapshot(sim, s);
    this.savePrev();
    this.history.forEach((h, n) => {
      if (n === this.history.length - 1) this.savePrev();
      this.stepSim(h.i);
    });
    sim.events = [];

    for (let i = 0; i < ks.length; i++) {
      const o = i * PREV_STRIDE;
      const dx = this.before[o] - ks[i].x, dy = this.before[o + 1] - ks[i].y, dz = this.before[o + 2] - ks[i].z;
      let dh = this.before[o + 3] - ks[i].heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      if (this.mine.has(ks[i].id)) {
        // How wrong the prediction itself was (the blend still in progress doesn't count).
        this.lastCorrection.set(ks[i].id, Math.hypot(dx - this.offsets[o], dy - this.offsets[o + 1], dz - this.offsets[o + 2]));
      }
      const far = Math.hypot(dx, dz) > SNAP_DISTANCE;
      this.offsets[o] = far ? 0 : dx;
      this.offsets[o + 1] = far ? 0 : dy;
      this.offsets[o + 2] = far ? 0 : dz;
      this.offsets[o + 3] = far ? 0 : dh;
    }
  }

  /** Copies the predicted race into the session the renderer draws, with corrections blended in. */
  frame(dt: number): void {
    const fade = Math.exp(-dt * SMOOTH_RATE);
    for (let i = 0; i < this.offsets.length; i++) this.offsets[i] *= fade;
    const sim = this.sim, d = this.session.state, prev = this.session.prev;
    d.tick = sim.tick;
    d.phase = sim.phase;
    d.countdown = sim.countdown;
    d.goTick = sim.goTick;
    d.boxes = sim.boxes;
    d.projectiles = sim.projectiles;
    d.peels = sim.peels;
    d.finishOrder = sim.finishOrder;
    for (let i = 0; i < sim.karts.length; i++) {
      const k = Object.assign(d.karts[i], sim.karts[i]);
      const o = i * PREV_STRIDE;
      k.x += this.offsets[o];
      k.y += this.offsets[o + 1];
      k.z += this.offsets[o + 2];
      k.heading += this.offsets[o + 3];
      for (let j = 0; j < PREV_STRIDE; j++) prev[o + j] = this.simPrev[o + j] + this.offsets[o + j];
    }
  }
}
