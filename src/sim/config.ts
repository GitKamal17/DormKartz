// Every constant that shapes how the karts feel lives here.
// Units: distance in world units (a kart is ~2.4 units long), time in seconds,
// speeds in units/second. See docs/TUNING.md for recipes.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const PHYS = {
  // ---- Speed ----
  /** Top speed at 150cc for a speed-3 character. Everything else scales from this. */
  baseTopSpeed: 32,
  /** Forward acceleration at standstill (u/s^2). Higher = snappier launches. */
  baseAccel: 30,
  /** How much acceleration fades as you approach top speed (0 = constant, 1 = fades to zero). */
  accelFalloff: 0.72,
  /** How fast speed above the current cap bleeds off (per second). Low = boosts linger longer. */
  overspeedDecay: 1.6,
  /** Braking force (u/s^2). */
  brakeDecel: 45,
  /** Max reverse speed and reverse acceleration. */
  reverseMax: 11,
  reverseAccel: 20,
  /** Rolling resistance when neither throttle nor brake is held (u/s^2). */
  coastDrag: 7,

  // ---- Steering ----
  /** Peak yaw rate (rad/s) for a handling-3 character. Higher = tighter turns. */
  maxYawRate: 2.25,
  /** Speed at which steering reaches full strength. Below this you turn on the spot less. */
  fullSteerSpeed: 9,
  /** Fraction of steering left at top speed. Lower = wider turns at speed (more "weight"). */
  highSpeedSteer: 0.72,
  /** Sideways grip: how fast sideways sliding is killed (per second). Higher = grippier. */
  grip: 13,
  /** Fraction of scrubbed sideways speed that is fed back into forward speed. Keeps corners fast. */
  slipRecovery: 0.55,
  /** Steering authority while airborne (fraction). */
  airSteer: 0.35,

  // ---- Drift / mini-turbo ----
  /** Minimum speed to start a drift. */
  driftMinSpeed: 13,
  /** Sideways grip while drifting. Lower = more slide, wider arcs. */
  driftGrip: 4.2,
  /** Drift yaw rate when steering *against* the drift (widest arc), rad/s. */
  driftYawMin: 0.85,
  /** Drift yaw rate when steering *into* the drift (tightest arc), rad/s. */
  driftYawMax: 2.95,
  /** Charge gained per tick: min when steering out of the drift, max when steering into it. */
  driftChargeMin: 0.6,
  driftChargeMax: 1.5,
  /** Charge needed for spark tiers 1 (blue), 2 (orange), 3 (purple). */
  driftTiers: [48, 108, 180] as readonly number[],
  /** Boost duration (seconds) awarded for releasing a drift at tiers 1/2/3. */
  miniTurboTime: [0.5, 1.0, 1.6] as readonly number[],
  /** Vertical speed of the little hop when you press drift. */
  hopVelocity: 4.2,

  // ---- Boosts ----
  /** Top speed multiplier while boosting. */
  boostSpeedMult: 1.32,
  /** Extra acceleration while boosting (u/s^2). */
  boostAccel: 70,
  /** Boost pad duration (s). */
  padBoostTime: 1.1,
  /** Mushroom-style item boost duration (s). */
  itemBoostTime: 1.35,
  /** Start-line boost duration (s). */
  startBoostTime: 1.2,
  /** Trick landing boost duration (s). */
  trickBoostTime: 0.6,

  // ---- Surfaces ----
  /** Off-road top speed multiplier (boosts and invincibility ignore this). */
  offroadSpeedMult: 0.52,
  /** Extra drag while on off-road (u/s^2). */
  offroadDrag: 10,
  /** Gravity component along slopes: >0 means downhill speeds you up. */
  slopeGravity: 14,

  // ---- Air ----
  gravity: 32,
  /** Vertical launch speed off a ramp at full speed. */
  rampLaunch: 11.5,
  /** Ticks after leaving a ramp in which pressing drift performs a trick. */
  trickWindow: 18,
  /** Below-ground distance at which a falling kart counts as "fell off". */
  fallDepth: 10,
  /** Time before the respawn drone puts you back (s). */
  respawnTime: 1.5,

  // ---- Collisions ----
  kartRadius: 1.25,
  /** Fraction of impact speed bounced back off walls. */
  wallRestitution: 0.35,
  /** Speed lost on a wall hit per unit of impact speed (fraction, capped). */
  wallSpeedLoss: 0.012,
  /** Impact speed above which a wall hit cancels your drift. */
  wallDriftCancel: 9,
  /** Kart-to-kart bounce strength. */
  bumpRestitution: 0.6,
  /** Largest sideways shove (u/s) a single kart-to-kart bump can give. */
  maxBumpDv: 9,

  // ---- Hits ----
  spinTime: 0.9,
  tumbleTime: 1.25,
  squashTime: 1.6,
  /** Invulnerability after a hit ends (s). */
  postHitInvuln: 1.0,
  starTime: 7,
  starSpeedMult: 1.14,
  shrinkTime: 6,
  shrinkSpeedMult: 0.74,
  squashSpeedMult: 0.45,
  /** Burnout stall if throttle is held too early in the countdown (s). */
  burnoutTime: 0.75,
} as const;

/** Speed class multipliers applied to top speed and acceleration. */
export const SPEED_CLASS = {
  50: { speed: 0.78, accel: 0.85, catchUp: 0.05, cpuSkill: 0.55 },
  100: { speed: 0.89, accel: 0.93, catchUp: 0.07, cpuSkill: 0.75 },
  150: { speed: 1.0, accel: 1.0, catchUp: 0.09, cpuSkill: 0.92 },
} as const;

export const COUNTDOWN_TICKS = 3 * TICK_RATE + 40;

export function secondsToTicks(s: number): number {
  return Math.round(s * TICK_RATE);
}
