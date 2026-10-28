// An online race as this device sees it. The server runs the simulation; here
// a RaceSession only holds what to draw. Snapshots are buffered and played back
// a few ticks behind the newest one, interpolating between the two that
// bracket the render time, so network jitter doesn't show as stutter.

import { PREV_STRIDE, RaceSession, type PlayerSlot } from '../game/session';
import { blankInput, type InputSource } from '../input/types';
import { TICK_RATE } from '../sim/config';
import type { PlayerId } from '../sim/types';
import { applySnapshot, type RaceStart, type Snapshot } from './protocol';

/** How far behind the newest snapshot to draw, in ticks (~100 ms). */
const DELAY_TICKS = 6;

const idle: InputSource = { kind: 'remote', poll: () => blankInput() };

export class NetRace {
  readonly session: RaceSession;
  readonly id: number;
  readonly humans: RaceStart['humans'];
  /** Final order once the server says the race is over. */
  order: PlayerId[] | null = null;
  private readonly buf: Snapshot[] = [];
  private newestAt = 0;
  private renderTick = -1;
  private appliedA = -1;
  private appliedB = -1;
  private eventsUpTo = -1;

  constructor(
    start: RaceStart,
    readonly you: PlayerId,
    readonly input: InputSource,
  ) {
    this.id = start.id;
    this.humans = start.humans;
    const humanIds = new Set(start.humans.map((h) => h.id));
    const slots: PlayerSlot[] = start.config.karts.map((k) => ({
      id: k.id,
      kind: k.id === you ? 'local' : humanIds.has(k.id) ? 'remote' : 'cpu',
      characterId: k.characterId,
      input: k.id === you ? input : idle,
      localIndex: k.id === you ? 0 : -1,
    }));
    this.session = new RaceSession({ trackId: start.config.trackId, speedClass: start.config.speedClass, mode: 'single', slots, seed: start.seed });
  }

  get racing(): boolean {
    return this.session.state.karts.some((k) => k.id === this.you);
  }

  push(s: Snapshot, now: number): void {
    const newest = this.buf[this.buf.length - 1];
    if (newest && s.tick <= newest.tick) return;
    this.buf.push(s);
    this.newestAt = now;
  }

  /** Moves playback forward and returns the interpolation alpha for the renderer. */
  update(now: number, dt: number): number {
    const buf = this.buf;
    if (!buf.length) return 1;
    const newest = buf[buf.length - 1];
    const target = newest.tick + ((now - this.newestAt) / 1000) * TICK_RATE - DELAY_TICKS;
    if (this.renderTick < 0 || Math.abs(target - this.renderTick) > 30) this.renderTick = target;
    else this.renderTick += dt * TICK_RATE + (target - this.renderTick) * 0.05;
    // Never run ahead of what the server has sent; hold on the newest instead.
    this.renderTick = Math.max(buf[0].tick, Math.min(newest.tick, this.renderTick));

    let bi = buf.findIndex((s) => s.tick > this.renderTick);
    if (bi < 0) bi = buf.length - 1;
    const ai = Math.max(0, bi - 1);
    const a = buf[ai], b = buf[bi];

    if (a.tick !== this.appliedA || b.tick !== this.appliedB) {
      const s = this.session, st = s.state;
      applySnapshot(st, a);
      for (let i = 0; i < st.karts.length; i++) {
        const k = st.karts[i], o = i * PREV_STRIDE;
        s.prev[o] = k.x;
        s.prev[o + 1] = k.y;
        s.prev[o + 2] = k.z;
        s.prev[o + 3] = k.heading;
      }
      if (b !== a) applySnapshot(st, b);
      for (const snap of buf) {
        if (snap.tick > this.eventsUpTo && snap.tick <= b.tick) s.receive(snap.events);
      }
      this.eventsUpTo = Math.max(this.eventsUpTo, b.tick);
      this.appliedA = a.tick;
      this.appliedB = b.tick;
    }
    if (ai > 0) buf.splice(0, ai);
    return b.tick === a.tick ? 1 : Math.max(0, Math.min(1, (this.renderTick - a.tick) / (b.tick - a.tick)));
  }

  /** The interpolated simulation time, for hazards that move on a fixed schedule. */
  get time(): number {
    return this.renderTick;
  }
}
