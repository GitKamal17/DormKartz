// The race simulation. createRace() builds the initial state; step() advances it
// by exactly one fixed 60 Hz tick given each player's FrameInput. step() mutates
// the state in place and never touches the DOM, the clock or Math.random(), so
// the same seed and inputs always produce the same race.

import { getStats } from './characters';
import { COUNTDOWN_TICKS, DT, PHYS, SPEED_CLASS, TICK_RATE, secondsToTicks } from './config';
import { CRUSHER_DANGER, crusherHeight, newPose, rollerPose, trafficPose } from './hazards';
import { itemUses, rollItem, ROULETTE_TICKS } from './items';
import { approach, clamp, lerp, loopDelta, mod, smoothstep } from './math';
import { hashSeed } from './rng';
import { frameAt, groundHeight, locate, newLoc, type Track } from './track/build';
import { getTrack } from './tracks';
import {
  NEUTRAL_INPUT,
  type FrameInput,
  type HitKind,
  type ItemType,
  type KartState,
  type PlayerId,
  type Projectile,
  type RaceConfig,
  type RaceEvent,
  type RaceState,
} from './types';

const P = PHYS;
const BOX_RESPAWN = 120;
const MAX_PEELS = 24;
const RACE_TIME_LIMIT = 8 * 60 * TICK_RATE;

// Scratch objects reused every tick (never part of the state).
const loc = newLoc();
const loc2 = newLoc();
const pose = newPose();
const order: KartState[] = [];

export function createRace(config: RaceConfig, seed: number): RaceState {
  const track = getTrack(config.trackId);
  if (config.karts.length > track.grid.length) throw new Error('Too many karts for the grid');
  const karts = config.karts.map((kc, idx): KartState => {
    const g = track.grid[idx];
    return {
      id: kc.id,
      characterId: kc.characterId,
      catchUp: kc.catchUp,
      x: g.x,
      y: g.y,
      z: g.z,
      vx: 0,
      vy: 0,
      vz: 0,
      heading: g.heading,
      grounded: true,
      airTicks: 0,
      hopping: false,
      fromRamp: false,
      trick: false,
      s: g.s,
      d: g.d,
      offroad: false,
      lastSafeS: g.s,
      drift: 0,
      driftCharge: 0,
      driftTier: 0,
      boostTicks: 0,
      boostKind: 0,
      padLatch: 0,
      stallTicks: 0,
      throttleSince: -1,
      hit: null,
      hitTicks: 0,
      invulnTicks: 0,
      starTicks: 0,
      shrinkTicks: 0,
      fallTicks: 0,
      item: config.startItem,
      itemCount: config.startItem ? itemUses(config.startItem) : 0,
      rouletteTicks: 0,
      trailing: null,
      prevDrift: false,
      prevItem: false,
      lap: 0,
      nextCp: track.checkpoints.length,
      lapStartTick: 0,
      lapTimes: [],
      finished: false,
      finishTick: 0,
      place: idx + 1,
      wrongWayTicks: 0,
      wrongWay: false,
      steer: 0,
    };
  });
  return {
    version: 1,
    config: JSON.parse(JSON.stringify(config)) as RaceConfig,
    tick: 0,
    phase: 'countdown',
    countdown: COUNTDOWN_TICKS,
    goTick: COUNTDOWN_TICKS,
    rng: hashSeed(seed),
    karts,
    boxes: config.items ? track.boxes.map(() => 0) : [],
    projectiles: [],
    peels: [],
    nextEntityId: 1,
    finishOrder: [],
    events: [],
  };
}

/** Distance raced so far (laps * track length + distance into the lap). */
export function raceProgress(track: Track, k: KartState): number {
  const L = track.length;
  const N = track.checkpoints.length;
  let s = k.s;
  if (k.nextCp === 0 && s > L * 0.5) s -= L;
  else if (k.nextCp === N && s < L * 0.5 && k.lap > 0) s += L;
  return (k.lap - 1) * L + s;
}

export function kartScale(k: KartState): number {
  return k.shrinkTicks > 0 ? 0.55 : 1;
}

function emit(st: RaceState, e: RaceEvent): void {
  st.events.push(e);
}

function inputFor(inputs: Map<PlayerId, FrameInput>, id: PlayerId): FrameInput {
  return inputs.get(id) ?? NEUTRAL_INPUT;
}

export function step(st: RaceState, inputs: Map<PlayerId, FrameInput>): RaceState {
  const track = getTrack(st.config.trackId);
  st.events.length = 0;
  st.tick++;

  if (st.phase === 'countdown') {
    stepCountdown(st, inputs);
    return st;
  }

  // Catch-up multipliers are measured against the karts without catch-up (humans).
  let refProgress = -Infinity;
  for (const k of st.karts) if (!k.catchUp) refProgress = Math.max(refProgress, raceProgress(track, k));
  const cu = SPEED_CLASS[st.config.speedClass].catchUp;

  for (const k of st.karts) {
    let mult = 1;
    if (k.catchUp && refProgress > -Infinity && !k.finished) {
      const gap = refProgress - raceProgress(track, k);
      if (gap > 30) mult = 1 + cu * Math.min(1, (gap - 30) / 160);
      else if (gap < -30) mult = 1 - cu * 0.7 * Math.min(1, (-gap - 30) / 160);
    }
    updateItems(st, track, k, inputFor(inputs, k.id));
    updateKart(st, track, k, inputFor(inputs, k.id), mult);
  }

  kartCollisions(st);
  hazardCollisions(st, track);
  updateBoxes(st);
  updateProjectiles(st, track);
  updatePeels(st);
  rank(st, track);

  if (st.phase === 'racing') {
    const allDone = st.karts.every((k) => k.finished);
    if (allDone || st.tick - st.goTick > RACE_TIME_LIMIT) st.phase = 'finished';
  }
  return st;
}

function stepCountdown(st: RaceState, inputs: Map<PlayerId, FrameInput>): void {
  st.countdown--;
  for (const k of st.karts) {
    const inp = inputFor(inputs, k.id);
    if (inp.throttle > 0.5) {
      if (k.throttleSince < 0) k.throttleSince = st.tick;
    } else k.throttleSince = -1;
    k.prevDrift = inp.drift;
    k.prevItem = inp.useItem;
    k.steer = inp.steer;
  }
  const c = st.countdown;
  if (c === 3 * TICK_RATE) emit(st, { type: 'countdown', n: 3 });
  else if (c === 2 * TICK_RATE) emit(st, { type: 'countdown', n: 2 });
  else if (c === TICK_RATE) emit(st, { type: 'countdown', n: 1 });
  else if (c <= 0) {
    emit(st, { type: 'countdown', n: 0 });
    st.phase = 'racing';
    st.goTick = st.tick;
    for (const k of st.karts) {
      k.lapStartTick = st.tick;
      if (k.throttleSince >= 0) {
        const held = st.tick - k.throttleSince;
        if (held >= 14 && held <= 48) giveBoost(st, k, P.startBoostTime, 3, 'start');
        else if (held > 100) k.stallTicks = secondsToTicks(P.burnoutTime);
      }
    }
  }
}

function giveBoost(st: RaceState, k: KartState, seconds: number, kind: number, ev: 'pad' | 'item' | 'turbo' | 'start' | 'trick'): void {
  k.boostTicks = Math.max(k.boostTicks, secondsToTicks(seconds));
  k.boostKind = kind;
  emit(st, { type: 'boost', kart: k.id, kind: ev });
}

// ---------------------------------------------------------------------------
// Kart physics
// ---------------------------------------------------------------------------

function updateKart(st: RaceState, track: Track, k: KartState, inp: FrameInput, catchUp: number): void {
  const stats = getStats(k.characterId, st.config.speedClass);

  if (k.invulnTicks > 0) k.invulnTicks--;
  if (k.starTicks > 0) k.starTicks--;
  if (k.shrinkTicks > 0) k.shrinkTicks--;
  if (k.boostTicks > 0) k.boostTicks--;
  else k.boostKind = 0;
  if (k.stallTicks > 0) k.stallTicks--;
  if (k.padLatch > 0) k.padLatch--;
  if (k.hitTicks > 0 && --k.hitTicks === 0) {
    k.hit = null;
    k.invulnTicks = Math.max(k.invulnTicks, secondsToTicks(P.postHitInvuln));
  }

  // Falling off the course: wait for the respawn drone.
  if (k.fallTicks > 0) {
    k.prevDrift = inp.drift;
    k.vy -= P.gravity * DT;
    k.y += k.vy * DT;
    k.x += k.vx * DT;
    k.z += k.vz * DT;
    k.vx *= 0.97;
    k.vz *= 0.97;
    if (--k.fallTicks === 0) respawn(st, track, k);
    return;
  }

  const controllable = k.hit === null || k.hit === 'squash';
  const steerIn = controllable ? clamp(inp.steer, -1, 1) : 0;
  const throttle = controllable && k.stallTicks === 0 ? clamp(inp.throttle, 0, 1) : 0;
  const brake = controllable ? clamp(inp.brake, 0, 1) : 0;
  const driftBtn = controllable && inp.drift;
  const driftPressed = driftBtn && !k.prevDrift;
  k.prevDrift = inp.drift;
  k.steer = steerIn;

  let fx = Math.sin(k.heading), fz = Math.cos(k.heading);
  let rx = -fz, rz = fx;
  let vf = k.vx * fx + k.vz * fz;
  let vl = k.vx * rx + k.vz * rz;

  locate(track, k.x, k.y, k.z, k.s, loc);
  const onRoad = Math.abs(loc.d) <= loc.hw;
  const offroad = !onRoad && loc.hasGround;
  k.offroad = k.grounded && offroad;

  // Speed cap for this tick.
  const boosting = k.boostTicks > 0;
  const terrainImmune = boosting || k.starTicks > 0;
  let top = stats.topSpeed * catchUp;
  if (k.shrinkTicks > 0) top *= P.shrinkSpeedMult;
  if (k.starTicks > 0) top *= P.starSpeedMult;
  if (k.hit === 'squash') top *= P.squashSpeedMult;
  if (k.grounded && offroad && !terrainImmune) top *= P.offroadSpeedMult;
  if (k.grounded) {
    const zi = track.slowAt[loc.i];
    if (zi >= 0) {
      const z = track.slows[zi];
      if (loc.d >= z.dMin && loc.d <= z.dMax) top *= boosting ? lerp(z.factor, 1, 0.6) : z.factor;
    }
  }
  if (boosting) top *= P.boostSpeedMult;

  if (k.grounded) {
    if (throttle > 0 && vf >= -0.5) {
      if (vf < top) vf = Math.min(top, vf + stats.accel * throttle * (1 - (P.accelFalloff * Math.max(0, vf)) / top) * DT);
    } else if (brake > 0) {
      if (vf > 0.5) vf = Math.max(0, vf - P.brakeDecel * brake * DT);
      else vf = Math.max(-P.reverseMax, vf - P.reverseAccel * brake * DT);
    } else if (throttle > 0 && vf < -0.5) {
      vf = Math.min(0, vf + P.brakeDecel * DT);
    } else {
      vf = approach(vf, 0, P.coastDrag * DT);
    }
    if (boosting && vf < top) vf = Math.min(top, vf + P.boostAccel * DT);
    if (vf > top) {
      const drag = offroad && !terrainImmune ? P.offroadDrag : 0;
      vf = Math.max(top, vf - (vf - top) * P.overspeedDecay * DT - drag * DT);
    }
    // Gravity along slopes.
    vf -= loc.ty * (fx * loc.tx + fz * loc.tz) * P.slopeGravity * DT;
  }

  // Steering.
  const absV = Math.abs(vf);
  const yawFactor = smoothstep(0, P.fullSteerSpeed, absV) * lerp(1, P.highSpeedSteer, clamp(absV / stats.topSpeed, 0, 1));
  let yawRate: number;
  if (k.drift !== 0) {
    const into = steerIn * k.drift;
    yawRate = k.drift * lerp(P.driftYawMin, P.driftYawMax, (into + 1) / 2) * stats.yawMult;
  } else {
    yawRate = steerIn * P.maxYawRate * stats.yawMult * yawFactor * (vf < 0 ? -1 : 1);
  }
  if (!k.grounded && !k.hopping) yawRate *= P.airSteer;
  if (k.hit === 'spin' || k.hit === 'tumble') yawRate = 0;
  k.heading -= yawRate * DT;

  // Drift: hop on press, slide while held, mini-turbo on release.
  if (driftPressed) {
    if (k.grounded) {
      k.vy = P.hopVelocity;
      k.grounded = false;
      k.hopping = true;
      k.airTicks = 0;
    } else if (k.fromRamp && k.airTicks <= P.trickWindow && !k.trick) {
      k.trick = true;
      emit(st, { type: 'trick', kart: k.id });
    }
  }
  if (k.drift === 0 && driftBtn && (k.hopping || driftPressed) && Math.abs(steerIn) > 0.3 && vf > P.driftMinSpeed) {
    k.drift = steerIn > 0 ? 1 : -1;
    k.driftCharge = 0;
    k.driftTier = 0;
  }
  if (k.drift !== 0) {
    if (!driftBtn || vf < P.driftMinSpeed * 0.6) {
      if (!inp.drift && controllable && k.driftTier > 0) {
        giveBoost(st, k, P.miniTurboTime[k.driftTier - 1], 2, 'turbo');
      }
      k.drift = 0;
      k.driftCharge = 0;
      k.driftTier = 0;
    } else if (k.grounded) {
      const into = steerIn * k.drift;
      k.driftCharge += lerp(P.driftChargeMin, P.driftChargeMax, (into + 1) / 2);
      const t = P.driftTiers;
      const tier = k.driftCharge >= t[2] ? 3 : k.driftCharge >= t[1] ? 2 : k.driftCharge >= t[0] ? 1 : 0;
      if (tier > k.driftTier) {
        k.driftTier = tier;
        emit(st, { type: 'driftTier', kart: k.id, tier });
      }
    }
  }

  // Re-express velocity in the new heading and apply sideways grip.
  let vx = fx * vf + rx * vl;
  let vz = fz * vf + rz * vl;
  fx = Math.sin(k.heading);
  fz = Math.cos(k.heading);
  rx = -fz;
  rz = fx;
  vf = vx * fx + vz * fz;
  vl = vx * rx + vz * rz;
  if (k.grounded) {
    let grip = (k.drift !== 0 ? P.driftGrip : P.grip) * stats.gripMult * track.def.grip;
    if (k.hit === 'spin') grip *= 0.25;
    const decay = Math.exp(-grip * DT);
    const lost = Math.abs(vl) * (1 - decay);
    vl *= decay;
    if (vf > 0 && vf < top && k.hit === null) vf = Math.min(top, vf + lost * P.slipRecovery);
  }
  if (k.hit === 'spin') vf = approach(vf, 0, 18 * DT);
  if (k.hit === 'tumble') vf = approach(vf, 0, 26 * DT);
  vx = fx * vf + rx * vl;
  vz = fz * vf + rz * vl;
  if (!k.grounded) {
    k.vy -= P.gravity * DT;
    k.airTicks++;
  }
  k.vx = vx;
  k.vz = vz;

  // Integrate.
  const prevS = k.s;
  k.x += k.vx * DT;
  k.z += k.vz * DT;
  if (!k.grounded) k.y += k.vy * DT;
  locate(track, k.x, k.y, k.z, k.s, loc);

  // Walls deflect rather than stop.
  const R = P.kartRadius * kartScale(k);
  if (loc.wall && Math.abs(loc.d) > loc.lim - R) {
    const sign = loc.d > 0 ? 1 : -1;
    const push = Math.abs(loc.d) - (loc.lim - R);
    k.x -= loc.rx * sign * push;
    k.z -= loc.rz * sign * push;
    loc.d -= sign * push;
    const vn = (k.vx * loc.rx + k.vz * loc.rz) * sign;
    if (vn > 0) {
      k.vx -= (1 + P.wallRestitution) * vn * loc.rx * sign;
      k.vz -= (1 + P.wallRestitution) * vn * loc.rz * sign;
      const keep = 1 - Math.min(0.45, vn * P.wallSpeedLoss);
      k.vx *= keep;
      k.vz *= keep;
      if (vn > 3) emit(st, { type: 'wall', kart: k.id, strength: vn });
      if (vn > P.wallDriftCancel) {
        k.drift = 0;
        k.driftCharge = 0;
        k.driftTier = 0;
      }
    }
    loc.groundY = groundHeight(track, loc.s, loc.d, loc.i, loc.cy);
  }

  // Ground contact.
  const ground = loc.groundY;
  if (k.grounded) {
    if (!loc.hasGround) {
      k.grounded = false;
      k.vy = 0;
      k.fromRamp = false;
    } else if (ground < k.y - 0.9) {
      k.grounded = false;
      k.vy = 0;
    } else {
      k.y = ground;
    }
  } else if (loc.hasGround && k.y <= ground && k.vy <= 0) {
    k.y = ground;
    k.grounded = true;
    k.vy = 0;
    if (!k.hopping || k.airTicks > 20) emit(st, { type: 'land', kart: k.id });
    if (k.trick) giveBoost(st, k, P.trickBoostTime, 3, 'trick');
    k.hopping = false;
    k.trick = false;
    k.fromRamp = false;
    k.airTicks = 0;
  } else if (loc.hasGround && k.y < ground && k.y > ground - 2.5) {
    // Clipped into a rising surface (e.g. a ramp) while airborne: pop up.
    k.y = ground;
  } else if (!loc.hasGround && k.y < loc.cy - P.fallDepth) {
    k.fallTicks = secondsToTicks(P.respawnTime);
    k.drift = 0;
    k.driftCharge = 0;
    k.driftTier = 0;
    k.boostTicks = 0;
    k.trailing = null;
    emit(st, { type: 'fall', kart: k.id });
  }

  // Ramps launch you when you cross the lip.
  if (k.grounded) {
    const ri = track.rampAt[loc.i];
    if (ri >= 0) {
      const r = track.ramps[ri];
      const before = loopDelta(r.sLip, prevS, track.length);
      const after = loopDelta(r.sLip, loc.s, track.length);
      if (before < 0 && after >= 0 && Math.abs(loc.d - r.d) <= r.halfW && vf > 6) {
        k.vy = P.rampLaunch * (0.55 + 0.45 * Math.min(1, vf / stats.topSpeed));
        k.grounded = false;
        k.fromRamp = true;
        k.hopping = false;
        k.airTicks = 0;
        emit(st, { type: 'jump', kart: k.id });
      }
    }
    const pi = track.padAt[loc.i];
    if (pi >= 0 && k.grounded) {
      const pad = track.pads[pi];
      if (Math.abs(loopDelta(pad.s, loc.s, track.length)) <= pad.halfLen && Math.abs(loc.d - pad.d) <= pad.halfW && k.padLatch === 0) {
        giveBoost(st, k, P.padBoostTime, 1, 'pad');
        k.padLatch = 30;
      }
    }
  }

  k.s = loc.s;
  k.d = loc.d;
  if (k.grounded && loc.hasGround && Math.abs(loc.d) <= loc.hw && track.gap[loc.i] === 0 && k.hit === null) k.lastSafeS = loc.s;

  updateLaps(st, track, k, prevS);

  // Wrong-way detection.
  const along = k.vx * loc.tx + k.vz * loc.tz;
  const facing = fx * loc.tx + fz * loc.tz;
  if (along < -2 && facing < -0.3) k.wrongWayTicks++;
  else k.wrongWayTicks = Math.max(0, k.wrongWayTicks - 3);
  k.wrongWay = k.wrongWayTicks > 45;
}

function respawn(st: RaceState, track: Track, k: KartState): void {
  const s = mod(k.lastSafeS - 4, track.length);
  frameAt(track, s, loc2);
  k.x = loc2.cx;
  k.z = loc2.cz;
  k.y = groundHeight(track, loc2.s, 0, loc2.i, loc2.cy) + 2.5;
  k.s = loc2.s;
  k.d = 0;
  k.heading = Math.atan2(loc2.tx, loc2.tz);
  k.vx = k.vy = k.vz = 0;
  k.grounded = false;
  k.hopping = false;
  k.fromRamp = false;
  k.trick = false;
  k.hit = null;
  k.hitTicks = 0;
  k.invulnTicks = secondsToTicks(1.5);
  emit(st, { type: 'respawn', kart: k.id });
}

function updateLaps(st: RaceState, track: Track, k: KartState, prevS: number): void {
  if (k.finished) return;
  const L = track.length;
  const N = track.checkpoints.length;
  const delta = loopDelta(prevS, k.s, L);
  // Crossing checkpoints in order.
  while (k.nextCp < N && delta > 0) {
    const a = loopDelta(prevS, track.checkpoints[k.nextCp], L);
    if (a >= 0 && a <= delta) k.nextCp++;
    else break;
  }
  const crossedForward = delta > 0 && k.s < prevS;
  if (crossedForward && k.nextCp === N) {
    k.nextCp = 0;
    if (k.lap > 0) {
      k.lapTimes.push(st.tick - k.lapStartTick);
      k.lapStartTick = st.tick;
    }
    k.lap++;
    if (k.lap > st.config.laps) {
      k.finished = true;
      k.finishTick = st.tick;
      k.lap = st.config.laps;
      k.nextCp = N;
      st.finishOrder.push(k.id);
      k.place = st.finishOrder.length;
      emit(st, { type: 'finish', kart: k.id, place: k.place });
    } else if (k.lap > 1) {
      emit(st, { type: 'lap', kart: k.id, lap: k.lap });
    }
  }
}

// ---------------------------------------------------------------------------
// Hits
// ---------------------------------------------------------------------------

type HitSource = 'projectile' | 'peel' | 'hazard' | 'kart' | 'explosion' | 'shrink';

/** Returns true if the hit landed (false if dodged or blocked). */
function applyHit(st: RaceState, k: KartState, kind: HitKind, source: HitSource): boolean {
  if (k.fallTicks > 0 || k.starTicks > 0) return false;
  if (k.hit !== null || k.invulnTicks > 0) return false;
  if ((source === 'projectile' || source === 'peel') && k.trailing) {
    k.trailing = null;
    emit(st, { type: 'blocked', kart: k.id });
    return false;
  }
  k.hit = kind;
  k.hitTicks = secondsToTicks(kind === 'spin' ? P.spinTime : kind === 'tumble' ? P.tumbleTime : P.squashTime);
  k.drift = 0;
  k.driftCharge = 0;
  k.driftTier = 0;
  k.boostTicks = 0;
  if (kind === 'tumble') {
    k.vx *= 0.3;
    k.vz *= 0.3;
    if (k.grounded) {
      k.vy = 7;
      k.grounded = false;
      k.hopping = false;
      k.fromRamp = false;
    }
  } else if (kind === 'spin') {
    k.vx *= 0.6;
    k.vz *= 0.6;
  } else {
    k.vx *= 0.4;
    k.vz *= 0.4;
  }
  emit(st, { type: 'hit', kart: k.id, hit: kind });
  return true;
}

function kartCollisions(st: RaceState): void {
  const ks = st.karts;
  for (let i = 0; i < ks.length; i++) {
    const a = ks[i];
    if (a.fallTicks > 0) continue;
    for (let j = i + 1; j < ks.length; j++) {
      const b = ks[j];
      if (b.fallTicks > 0 || Math.abs(a.y - b.y) > 1.6) continue;
      const ra = P.kartRadius * kartScale(a), rb = P.kartRadius * kartScale(b);
      const dx = b.x - a.x, dz = b.z - a.z;
      const dist2 = dx * dx + dz * dz;
      const minD = ra + rb;
      if (dist2 >= minD * minD || dist2 < 1e-9) continue;
      const dist = Math.sqrt(dist2);
      const nx = dx / dist, nz = dz / dist;
      const ma = getStats(a.characterId, st.config.speedClass).mass * (a.starTicks > 0 ? 4 : 1) * kartScale(a);
      const mb = getStats(b.characterId, st.config.speedClass).mass * (b.starTicks > 0 ? 4 : 1) * kartScale(b);
      const overlap = minD - dist;
      a.x -= (nx * overlap * mb) / (ma + mb);
      a.z -= (nz * overlap * mb) / (ma + mb);
      b.x += (nx * overlap * ma) / (ma + mb);
      b.z += (nz * overlap * ma) / (ma + mb);
      const vrel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (vrel < 0) {
        const jImp = (-(1 + P.bumpRestitution) * vrel) / (1 / ma + 1 / mb);
        // Cap the shove so heavy or invincible karts bump, not launch.
        const da = Math.min(jImp / ma, P.maxBumpDv), db = Math.min(jImp / mb, P.maxBumpDv);
        a.vx -= da * nx;
        a.vz -= da * nz;
        b.vx += db * nx;
        b.vz += db * nz;
        if (vrel < -3) emit(st, { type: 'bump', kart: a.id, other: b.id });
      }
      if (a.starTicks > 0 && b.starTicks === 0) applyHit(st, b, 'tumble', 'kart');
      else if (b.starTicks > 0 && a.starTicks === 0) applyHit(st, a, 'tumble', 'kart');
      else if (a.shrinkTicks > 0 && b.shrinkTicks === 0) applyHit(st, a, 'squash', 'kart');
      else if (b.shrinkTicks > 0 && a.shrinkTicks === 0) applyHit(st, b, 'squash', 'kart');
    }
  }
}

function hazardCollisions(st: RaceState, track: Track): void {
  const hz = track.hazards;
  if (hz.length === 0) return;
  for (const k of st.karts) {
    if (k.fallTicks > 0) continue;
    const R = P.kartRadius * kartScale(k);
    for (const h of hz) {
      if (h.kind === 'roller') {
        rollerPose(track, h, st.tick, pose);
        const dx = k.x - pose.x, dz = k.z - pose.z;
        if (dx * dx + dz * dz < (h.radius + R) ** 2 && Math.abs(k.y - (pose.y - h.radius)) < h.radius + 1.2) {
          applyHit(st, k, h.hit, 'hazard');
        }
      } else if (h.kind === 'traffic') {
        for (let c = 0; c < h.count; c++) {
          trafficPose(track, h, c, st.tick, pose);
          if (Math.abs(k.y - pose.y) > 2) continue;
          const hx = Math.sin(pose.heading), hzz = Math.cos(pose.heading);
          for (const off of [-1.3, 1.3]) {
            const cx = pose.x + hx * off, cz = pose.z + hzz * off;
            const dx = k.x - cx, dz = k.z - cz;
            if (dx * dx + dz * dz < (1.35 + R) ** 2) {
              if (!applyHit(st, k, 'tumble', 'hazard')) {
                // Bounce off even when immune so karts never pass through cars.
                const d = Math.sqrt(dx * dx + dz * dz) || 1;
                k.x = cx + (dx / d) * (1.35 + R);
                k.z = cz + (dz / d) * (1.35 + R);
              }
            }
          }
        }
      } else if (h.kind === 'crusher') {
        if (Math.abs(loopDelta(h.s, k.s, track.length)) < 2.8 && k.d >= h.dMin - R && k.d <= h.dMax + R) {
          if (crusherHeight(h, st.tick) < CRUSHER_DANGER) applyHit(st, k, 'squash', 'hazard');
        }
      } else {
        const dx = k.x - h.x, dz = k.z - h.z;
        const minD = h.radius + R;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD * minD && Math.abs(k.y - h.y) < 2.5) {
          const d = Math.sqrt(d2) || 1;
          const nx = dx / d, nz = dz / d;
          k.x = h.x + nx * minD;
          k.z = h.z + nz * minD;
          const vn = k.vx * nx + k.vz * nz;
          if (vn < 0) {
            k.vx -= 1.4 * vn * nx;
            k.vz -= 1.4 * vn * nz;
            if (vn < -4) emit(st, { type: 'wall', kart: k.id, strength: -vn });
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function updateBoxes(st: RaceState): void {
  if (st.boxes.length === 0) return;
  const track = getTrack(st.config.trackId);
  const cometActive = st.projectiles.some((p) => p.kind === 'comet');
  for (let i = 0; i < st.boxes.length; i++) {
    if (st.boxes[i] > 0) {
      st.boxes[i]--;
      continue;
    }
    const b = track.boxes[i];
    for (const k of st.karts) {
      if (k.fallTicks > 0) continue;
      const dx = k.x - b.x, dz = k.z - b.z;
      if (dx * dx + dz * dz < 3.2 * 3.2 && Math.abs(k.y + 0.8 - b.y) < 2.5) {
        st.boxes[i] = BOX_RESPAWN;
        if (k.item === null && k.rouletteTicks === 0) {
          k.item = rollItem(st, k.place, st.karts.length, cometActive);
          k.itemCount = itemUses(k.item);
          k.rouletteTicks = ROULETTE_TICKS;
          emit(st, { type: 'itemGet', kart: k.id });
        }
        break;
      }
    }
  }
}

function updateItems(st: RaceState, track: Track, k: KartState, inp: FrameInput): void {
  const pressed = inp.useItem && !k.prevItem;
  const released = !inp.useItem && k.prevItem;
  k.prevItem = inp.useItem;
  if (k.rouletteTicks > 0 && --k.rouletteTicks === 0 && k.item) emit(st, { type: 'itemReady', kart: k.id, item: k.item });
  if (k.fallTicks > 0) return;
  const canAct = k.hit === null || k.hit === 'squash';
  if (k.trailing && (released || !inp.useItem) && canAct) {
    deployTrailing(st, track, k, k.trailing, inp.lookBack);
    k.trailing = null;
    return;
  }
  if (!pressed || !canAct || !k.item || k.rouletteTicks > 0 || k.trailing) return;
  const item = k.item;
  emit(st, { type: 'itemUse', kart: k.id, item });
  consume(k);
  switch (item) {
    case 'zoom':
    case 'tripleZoom':
      giveBoost(st, k, P.itemBoostTime, 1, 'item');
      break;
    case 'peel':
    case 'bouncePuck':
    case 'seekerPuck':
      k.trailing = item;
      break;
    case 'crownComet':
      spawnComet(st, track, k);
      break;
    case 'supernova':
      k.starTicks = secondsToTicks(P.starTime);
      k.hit = null;
      k.hitTicks = 0;
      emit(st, { type: 'star', kart: k.id });
      break;
    case 'shrinkRay':
      for (const o of st.karts) {
        if (o.id === k.id || o.starTicks > 0 || o.fallTicks > 0) continue;
        o.shrinkTicks = secondsToTicks(P.shrinkTime);
        o.item = null;
        o.itemCount = 0;
        o.rouletteTicks = 0;
        o.trailing = null;
        applyHit(st, o, 'spin', 'shrink');
      }
      emit(st, { type: 'shrink', by: k.id });
      break;
  }
}

function consume(k: KartState): void {
  k.itemCount--;
  if (k.itemCount <= 0) {
    k.item = null;
    k.itemCount = 0;
  }
}

function newProjectile(st: RaceState, k: KartState, kind: Projectile['kind']): Projectile {
  return {
    id: st.nextEntityId++,
    kind,
    owner: k.id,
    x: k.x,
    y: k.y + 0.6,
    z: k.z,
    vx: 0,
    vz: 0,
    s: k.s,
    d: k.d,
    progress: 0,
    ttl: 0,
    bounces: 0,
    target: -1,
    grace: 20,
  };
}

function deployTrailing(st: RaceState, track: Track, k: KartState, item: ItemType, back: boolean): void {
  const fx = Math.sin(k.heading), fz = Math.cos(k.heading);
  if (item === 'peel') {
    if (st.peels.length >= MAX_PEELS) st.peels.shift();
    st.peels.push({ id: st.nextEntityId++, owner: k.id, x: k.x - fx * 2.8, y: k.y, z: k.z - fz * 2.8, s: k.s, ttl: secondsToTicks(60), grace: 40 });
    return;
  }
  const dir = back ? -1 : 1;
  const p = newProjectile(st, k, item === 'seekerPuck' && !back ? 'seeker' : 'bounce');
  p.x = k.x + fx * 2.8 * dir;
  p.z = k.z + fz * 2.8 * dir;
  const kartSpeed = k.vx * fx + k.vz * fz;
  const speed = Math.max(48, kartSpeed * dir + 26);
  p.vx = fx * speed * dir;
  p.vz = fz * speed * dir;
  p.ttl = secondsToTicks(p.kind === 'seeker' ? 9 : 7);
  if (p.kind === 'seeker') {
    p.progress = raceProgress(track, k);
    const ahead = st.karts.find((o) => o.place === k.place - 1 && !o.finished);
    p.target = ahead ? ahead.id : -1;
  }
  locate(track, p.x, p.y, p.z, k.s, loc2);
  p.s = loc2.s;
  p.d = loc2.d;
  st.projectiles.push(p);
}

function spawnComet(st: RaceState, track: Track, k: KartState): void {
  const p = newProjectile(st, k, 'comet');
  p.progress = raceProgress(track, k);
  p.ttl = secondsToTicks(20);
  p.y = k.y + 5;
  st.projectiles.push(p);
}

const SEEKER_SPEED = 52;
const COMET_SPEED = 72;

function updateProjectiles(st: RaceState, track: Track): void {
  const L = track.length;
  const ps = st.projectiles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.ttl--;
    if (p.grace > 0) p.grace--;
    let dead = p.ttl <= 0;

    if (p.kind === 'bounce') {
      p.x += p.vx * DT;
      p.z += p.vz * DT;
      locate(track, p.x, p.y, p.z, p.s, loc);
      if (loc.wall && Math.abs(loc.d) > loc.lim - 0.6) {
        const sign = loc.d > 0 ? 1 : -1;
        const push = Math.abs(loc.d) - (loc.lim - 0.6);
        p.x -= loc.rx * sign * push;
        p.z -= loc.rz * sign * push;
        const vn = (p.vx * loc.rx + p.vz * loc.rz) * sign;
        if (vn > 0) {
          p.vx -= 2 * vn * loc.rx * sign;
          p.vz -= 2 * vn * loc.rz * sign;
          p.bounces++;
        }
      }
      if (!loc.hasGround || p.bounces > 6) dead = true;
      p.s = loc.s;
      p.d = loc.d;
      p.y = loc.groundY + 0.6;
    } else if (p.kind === 'seeker') {
      const target = p.target >= 0 ? st.karts.find((o) => o.id === p.target) : undefined;
      const tValid = target && !target.finished && target.fallTicks === 0;
      const dxT = tValid ? target.x - p.x : 0, dzT = tValid ? target.z - p.z : 0;
      if (tValid && dxT * dxT + dzT * dzT < 16 * 16 && Math.abs(target.y - p.y) < 4) {
        const d = Math.sqrt(dxT * dxT + dzT * dzT) || 1;
        p.vx = (dxT / d) * SEEKER_SPEED;
        p.vz = (dzT / d) * SEEKER_SPEED;
        p.x += p.vx * DT;
        p.z += p.vz * DT;
        locate(track, p.x, p.y, p.z, p.s, loc);
        p.progress += loopDelta(p.s, loc.s, L);
        p.s = loc.s;
        p.d = loc.d;
        p.y = loc.groundY + 0.6;
      } else {
        const wantD = tValid && raceProgress(track, target) - p.progress < 70 ? target.d : track.racingLine[Math.floor(p.s / track.ds) % track.n];
        p.progress += SEEKER_SPEED * DT;
        frameAt(track, p.progress, loc);
        const lim = Math.min(track.limL[loc.i], track.limR[loc.i]) - 1;
        p.d = clamp(approach(p.d, wantD, 14 * DT), -lim, lim);
        const nx = loc.cx + loc.rx * p.d, nz = loc.cz + loc.rz * p.d;
        p.vx = (nx - p.x) / DT;
        p.vz = (nz - p.z) / DT;
        p.x = nx;
        p.z = nz;
        p.s = loc.s;
        p.y = groundHeight(track, loc.s, p.d, loc.i, loc.cy) + 0.6;
      }
    } else {
      // Crown Comet: fly along the course to the leader, then explode.
      let leader: KartState | undefined;
      for (const k of st.karts) if (k.place === 1 && !k.finished) leader = k;
      if (!leader) for (const k of st.karts) if (!k.finished && (!leader || k.place < leader.place)) leader = k;
      if (!leader) {
        dead = true;
      } else {
        const lp = raceProgress(track, leader);
        const gap = lp - p.progress;
        if (gap < 3 || (gap < 30 && Math.hypot(leader.x - p.x, leader.z - p.z) < 3)) {
          emit(st, { type: 'explode', x: leader.x, y: leader.y, z: leader.z });
          for (const k of st.karts) {
            if (Math.hypot(k.x - leader.x, k.z - leader.z) < 7 && Math.abs(k.y - leader.y) < 4) applyHit(st, k, 'tumble', 'explosion');
          }
          dead = true;
        } else {
          p.progress += Math.min(COMET_SPEED * DT, gap);
          frameAt(track, p.progress, loc);
          const near = smoothstep(40, 5, gap);
          p.d = lerp(0, leader.d, near);
          const nx = loc.cx + loc.rx * p.d, nz = loc.cz + loc.rz * p.d;
          p.vx = (nx - p.x) / DT;
          p.vz = (nz - p.z) / DT;
          p.x = nx;
          p.z = nz;
          p.s = loc.s;
          p.y = lerp(loc.cy + 7, leader.y + 1, near);
        }
      }
    }

    // Hits.
    if (!dead && p.kind !== 'comet') {
      for (const k of st.karts) {
        if (k.fallTicks > 0 || (k.id === p.owner && p.grace > 0)) continue;
        const R = P.kartRadius * kartScale(k) + 0.8;
        const dx = k.x - p.x, dz = k.z - p.z;
        if (dx * dx + dz * dz < R * R && Math.abs(k.y + 0.6 - p.y) < 2.2) {
          applyHit(st, k, 'tumble', 'projectile');
          dead = true;
          break;
        }
      }
    }
    if (!dead && p.kind !== 'comet') {
      for (let j = st.peels.length - 1; j >= 0; j--) {
        const pl = st.peels[j];
        if ((p.x - pl.x) ** 2 + (p.z - pl.z) ** 2 < 2.2 && Math.abs(p.y - pl.y) < 2) {
          st.peels.splice(j, 1);
          dead = true;
          break;
        }
      }
    }
    if (!dead && p.kind !== 'comet') {
      for (let j = 0; j < ps.length; j++) {
        const q = ps[j];
        if (j === i || q.kind === 'comet' || q.ttl <= 0) continue;
        if ((p.x - q.x) ** 2 + (p.z - q.z) ** 2 < 2.4) {
          q.ttl = 0;
          dead = true;
          break;
        }
      }
    }
    if (dead) ps.splice(i, 1);
  }
  // Remove projectiles destroyed by collisions with others.
  for (let i = ps.length - 1; i >= 0; i--) if (ps[i].ttl <= 0) ps.splice(i, 1);
}

function updatePeels(st: RaceState): void {
  const pls = st.peels;
  for (let i = pls.length - 1; i >= 0; i--) {
    const pl = pls[i];
    pl.ttl--;
    if (pl.grace > 0) pl.grace--;
    let dead = pl.ttl <= 0;
    if (!dead) {
      for (const k of st.karts) {
        if (k.fallTicks > 0 || (k.id === pl.owner && pl.grace > 0)) continue;
        const R = P.kartRadius * kartScale(k) + 0.7;
        const dx = k.x - pl.x, dz = k.z - pl.z;
        if (dx * dx + dz * dz < R * R && Math.abs(k.y - pl.y) < 2) {
          applyHit(st, k, 'spin', 'peel');
          dead = true;
          break;
        }
      }
    }
    if (dead) pls.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function rank(st: RaceState, track: Track): void {
  order.length = 0;
  for (const k of st.karts) order.push(k);
  order.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished) return a.finishTick - b.finishTick || st.finishOrder.indexOf(a.id) - st.finishOrder.indexOf(b.id);
    return raceProgress(track, b) - raceProgress(track, a) || a.id - b.id;
  });
  for (let i = 0; i < order.length; i++) order[i].place = i + 1;
}

/** Placement for karts that have not finished when a race is cut short: current order. */
export function provisionalOrder(st: RaceState): PlayerId[] {
  return [...st.karts].sort((a, b) => a.place - b.place).map((k) => k.id);
}
