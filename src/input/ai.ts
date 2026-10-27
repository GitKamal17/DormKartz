// CPU driver. It only reads the race state and returns a FrameInput, exactly
// like a human would, so the simulation cannot tell it apart from a player.

import { PHYS } from '../sim/config';
import { getStats } from '../sim/characters';
import { CRUSHER_DANGER, crusherHeight, newPose, rollerPose, trafficPose } from '../sim/hazards';
import { clamp, lerp, loopDelta, mod } from '../sim/math';
import { SeededRandom } from '../sim/rng';
import { frameAt, newLoc, type Track } from '../sim/track/build';
import type { FrameInput, KartState, PlayerId, RaceState } from '../sim/types';
import { blankInput, type InputSource, type RaceView } from './types';

const loc = newLoc();
const pose = newPose();

export class AIInput implements InputSource {
  readonly kind = 'ai' as const;
  private readonly rnd: SeededRandom;
  private readonly lanePhase: number;
  private readonly lanePeriod: number;
  private readonly laneAmp: number;
  private readonly startBoost: boolean;
  private readonly targetTier: number;
  private stuckTicks = 0;
  private reverseTicks = 0;
  private reverseSteer = 0;
  private itemTimer = -1;
  private holdTicks = 0;
  private lastUse = false;
  private driftCooldown = 0;
  private idx = -1;
  private readonly out: FrameInput = blankInput();

  /** skill: 0 (sloppy) .. 1 (sharp). */
  constructor(
    public skill: number,
    seed: number | string,
  ) {
    this.rnd = new SeededRandom(seed);
    this.lanePhase = this.rnd.range(0, Math.PI * 2);
    this.lanePeriod = this.rnd.range(5, 11) * 60;
    this.laneAmp = this.rnd.range(0.15, 0.45);
    this.startBoost = this.rnd.next() < 0.25 + skill * 0.65;
    this.targetTier = skill > 0.8 ? 2 : skill > 0.5 ? this.rnd.int(1, 2) : 1;
  }

  poll(view: RaceView, id: PlayerId): FrameInput {
    const { state, track } = view;
    if (this.idx < 0 || state.karts[this.idx]?.id !== id) this.idx = state.karts.findIndex((k) => k.id === id);
    const k = state.karts[this.idx];
    const o = this.out;
    o.steer = 0;
    o.throttle = 1;
    o.brake = 0;
    o.drift = false;
    o.useItem = false;
    o.lookBack = false;

    if (state.phase === 'countdown') {
      o.throttle = this.startBoost ? (state.countdown <= 36 ? 1 : 0) : state.countdown <= 2 ? 1 : 0;
      return o;
    }
    if (k.fallTicks > 0 || k.hit === 'spin' || k.hit === 'tumble') return o;

    const fx = Math.sin(k.heading), fz = Math.cos(k.heading);
    const rx = -fz, rz = fx;
    const speed = k.vx * fx + k.vz * fz;
    const stats = getStats(k.characterId, state.config.speedClass);
    const open = !track.def.walls;

    // --- Where to aim -------------------------------------------------------
    const la = 7 + Math.max(0, speed) * 0.42;
    frameAt(track, k.s + la, loc);
    const ti = loc.i;
    const hw = track.hw[ti];
    const edgeMargin = open || !track.wallL[ti] || !track.wallR[ti] ? 3.2 : 2;
    const lane = Math.sin((state.tick / this.lanePeriod) * Math.PI * 2 + this.lanePhase) * this.laneAmp * (hw - 3);
    let td = lerp(lane, track.racingLine[ti], 0.55 + 0.4 * this.skill);
    let caution = 1;
    td = this.avoid(state, track, k, speed, td, hw, (c) => (caution = Math.min(caution, c)));
    td = clamp(td, -(hw - edgeMargin), hw - edgeMargin);
    const tx = loc.cx + loc.rx * td, tz = loc.cz + loc.rz * td;
    const dx = tx - k.x, dz = tz - k.z;
    const angle = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    let steer = clamp(angle * 2.6, -1, 1);

    // --- Speed planning ----------------------------------------------------
    let maxC = 0;
    let avgC = 0;
    let cnt = 0;
    const horizon = 12 + Math.max(0, speed) * 1.1;
    for (let a = 4; a <= horizon; a += 2) {
      const c = track.curv[mod(Math.round((k.s + a) / track.ds), track.n)];
      maxC = Math.max(maxC, Math.abs(c));
      if (a <= 30) {
        avgC += c;
        cnt++;
      }
    }
    avgC /= Math.max(1, cnt);
    const yaw = PHYS.maxYawRate * PHYS.highSpeedSteer * stats.yawMult * (1.05 + 0.25 * this.skill);
    let vAllow = maxC > 1e-4 ? yaw / maxC : 999;
    if (open) vAllow *= 0.9;
    if (track.def.grip < 0.8) vAllow *= 0.92;
    vAllow *= caution;
    if (speed > vAllow + 1.5) {
      o.throttle = 0;
      o.brake = clamp((speed - vAllow) / 10, 0.2, 1);
    } else if (caution < 1) {
      o.throttle = caution;
    }

    // --- Drifting ------------------------------------------------------------
    if (this.driftCooldown > 0) this.driftCooldown--;
    const nearEdge = Math.abs(k.d) > hw - (open ? 3.5 : 1.5);
    if (k.drift === 0) {
      let entry = 0;
      for (let a = 4; a <= 14; a += 2) entry += track.curv[mod(Math.round((k.s + a) / track.ds), track.n)];
      entry /= 6;
      const sameWay = entry * avgC > 0 && Math.abs(entry) > 1 / 60;
      const placed = Math.abs(k.d - td) < 3.5 && !nearEdge && !k.offroad;
      const allowed = this.driftCooldown === 0 && k.invulnTicks === 0 && speed > 17 && k.grounded;
      const chance = (open ? 0.05 : 0.1) + this.skill * 0.25;
      if (sameWay && Math.abs(avgC) > 1 / 55 && placed && allowed && this.rnd.next() < chance) {
        o.drift = true;
        const dir = avgC > 0 ? 1 : -1;
        steer = dir * Math.max(0.65, Math.abs(steer));
      }
    } else {
      let ahead = 0;
      for (let a = 2; a <= 18; a += 2) ahead += track.curv[mod(Math.round((k.s + a) / track.ds), track.n)] * k.drift;
      ahead /= 9;
      const enough = k.driftTier >= this.targetTier;
      const turnDone = ahead < 1 / 110;
      const wrongSide = angle * k.drift < -0.25;
      o.drift = !(turnDone || wrongSide || nearEdge || k.offroad || (enough && angle * k.drift < -0.1));
      if (!o.drift) this.driftCooldown = 24;
    }

    // --- Edge safety: if pointing off an open edge, slow right down and turn in.
    const tr = track.rx[mod(Math.round(k.s / track.ds), track.n)];
    const tz2 = track.rz[mod(Math.round(k.s / track.ds), track.n)];
    const side = k.d >= 0 ? 1 : -1;
    const edgeOpen = side > 0 ? !track.wallR[ti] : !track.wallL[ti];
    const outward = (fx * tr + fz * tz2) * side;
    if (edgeOpen && Math.abs(k.d) > hw - 4.5 && outward > 0.3) {
      o.throttle = 0.35;
      o.brake = speed > 7 ? 1 : 0;
      o.drift = false;
      steer = -side;
    }

    // --- Getting unstuck -------------------------------------------------------
    if (speed < 2 && k.hit === null && k.grounded) this.stuckTicks++;
    else this.stuckTicks = 0;
    if (this.stuckTicks > 45) {
      this.reverseTicks = 40;
      this.reverseSteer = -Math.sign(angle || 1);
      this.stuckTicks = 0;
    }
    if (this.reverseTicks > 0) {
      this.reverseTicks--;
      o.throttle = 0;
      o.brake = 1;
      o.drift = false;
      steer = this.reverseSteer;
    }

    o.steer = steer;
    this.items(state, track, k, speed, maxC, o);
    return o;
  }

  /** Shifts the aim point around hazards; may lower `caution` (speed scale). */
  private avoid(state: RaceState, track: Track, k: KartState, speed: number, td: number, hw: number, slow: (c: number) => void): number {
    const L = track.length;
    const dodge = (objD: number, width: number) => {
      if (Math.abs(td - objD) < width) {
        const goRight = objD < 0 ? true : objD > 0 ? false : td >= objD;
        const cand = goRight ? objD + width : objD - width;
        td = Math.abs(cand) > hw - 2 ? (goRight ? objD - width : objD + width) : cand;
      }
    };
    for (const pl of state.peels) {
      const ahead = loopDelta(k.s, pl.s, L);
      if (ahead > 2 && ahead < 26) {
        frameAt(track, pl.s, loc);
        dodge((pl.x - loc.cx) * loc.rx + (pl.z - loc.cz) * loc.rz, 3.4);
      }
    }
    const v = Math.max(speed, 6);
    for (const h of track.hazards) {
      if (h.kind === 'roller') {
        const ahead = loopDelta(k.s, h.s, L);
        if (ahead > 0 && ahead < 30) {
          rollerPose(track, h, state.tick + Math.round((ahead / v) * 60), pose);
          dodge(pose.d, h.radius + 2.6);
        }
      } else if (h.kind === 'crate') {
        const ahead = loopDelta(k.s, h.s, L);
        if (ahead > -1 && ahead < 24) dodge(h.d, h.radius + 2.4);
      } else if (h.kind === 'traffic') {
        for (let c = 0; c < h.count; c++) {
          trafficPose(track, h, c, state.tick, pose);
          const ahead = loopDelta(k.s, pose.s, L);
          if (ahead > -2 && ahead < 34) dodge(pose.d, 4.6);
        }
      } else if (h.kind === 'crusher') {
        const ahead = loopDelta(k.s, h.s, L);
        if (ahead > -2 && ahead < 40) {
          const t = Math.round((ahead / v) * 60);
          let danger = false;
          for (let dt = -14; dt <= 14; dt += 4) if (crusherHeight(h, state.tick + t + dt) < CRUSHER_DANGER + 1) danger = true;
          if (danger) {
            const mid = (h.dMin + h.dMax) / 2;
            const half = (h.dMax - h.dMin) / 2 + 2.2;
            if (Math.abs(td - mid) < half) {
              const left = h.dMin - 2.2, right = h.dMax + 2.2;
              if (left > -(hw - 2)) td = left;
              else if (right < hw - 2) td = right;
              else if (ahead < 22) slow(0.25);
            }
          }
        }
      }
    }
    for (const o of state.karts) {
      if (o.id === k.id || o.fallTicks > 0) continue;
      const ahead = loopDelta(k.s, o.s, L);
      if (ahead > 0 && ahead < 10 && Math.abs(o.y - k.y) < 2) dodge(o.d, 2.8);
    }
    return td;
  }

  private items(state: RaceState, track: Track, k: KartState, speed: number, maxC: number, o: FrameInput): void {
    let want = false;
    if (k.trailing) {
      // Hold it as a shield, let go when there's a reason (or after a while).
      this.holdTicks++;
      let release = this.holdTicks > 240 + this.rnd.int(0, 120);
      const L = track.length;
      if (k.trailing === 'bouncePuck' || k.trailing === 'seekerPuck') {
        for (const t of state.karts) {
          if (t.id === k.id || t.fallTicks > 0) continue;
          const ahead = loopDelta(k.s, t.s, L);
          if (k.trailing === 'seekerPuck' && t.place === k.place - 1 && ahead > 0 && ahead < 90) release = true;
          if (ahead > 4 && ahead < 32 && Math.abs(t.d - k.d) < 2.5) release = true;
          if (ahead < -3 && ahead > -14 && Math.abs(t.d - k.d) < 2.5 && k.trailing === 'bouncePuck') {
            release = true;
            o.lookBack = true;
          }
        }
      } else if (k.trailing === 'peel') {
        for (const t of state.karts) {
          const ahead = loopDelta(k.s, t.s, L);
          if (t.id !== k.id && ahead < -3 && ahead > -16 && Math.abs(t.d - k.d) < 3) release = true;
        }
      }
      want = !release;
      if (!want) this.holdTicks = 0;
    } else if (k.item && k.rouletteTicks === 0) {
      if (this.itemTimer < 0) this.itemTimer = this.rnd.int(20, 150);
      if (this.itemTimer > 0) this.itemTimer--;
      const straight = maxC < 1 / 70 && speed > 10 && k.grounded;
      switch (k.item) {
        case 'zoom':
        case 'tripleZoom':
          want = straight && (this.itemTimer === 0 || k.offroad) && k.boostTicks < 10;
          break;
        case 'peel':
        case 'bouncePuck':
        case 'seekerPuck':
          want = this.itemTimer === 0;
          break;
        case 'supernova':
        case 'shrinkRay':
        case 'crownComet':
          want = this.itemTimer === 0 && (k.item !== 'crownComet' || k.place > 1);
          break;
      }
      if (want) this.itemTimer = -1;
    }
    // Produce a clean press: the button must be released for a tick between uses.
    if (want && this.lastUse && !k.trailing) want = false;
    o.useItem = want;
    this.lastUse = want;
  }
}
