# Tuning the driving feel

Every constant that affects how the karts drive is in `src/sim/config.ts`, in the `PHYS` object. Each one has a comment there. This page explains how they interact and what to change for a given feel.

Units: distance in world units (a kart is about 2.4 long, a typical road is 20–24 wide), time in seconds, speed in units/second. The HUD shows `speed × 3.6` as km/h.

After any change, run:

```bash
npm test          # must stay green: drift tiers, boosts, and full CPU races on every track
npm run report    # race times per track: compare before/after
```

If CPUs start failing a track after a change, your change made that track harder to drive. That isn't necessarily wrong, but look at it before you decide.

## The knobs

### Speed

| Constant | Effect |
|---|---|
| `baseTopSpeed` | Top speed at 150cc for a mid-speed character. Changes everything: lap times, how hard corners feel, jump distances. |
| `baseAccel` | How fast you reach top speed. Higher feels snappier off the line and after hits. |
| `accelFalloff` | 0 = constant push all the way to top speed; 1 = acceleration fades to nothing near top speed. |
| `overspeedDecay` | How quickly speed above the cap bleeds off, e.g. after a boost ends. Lower makes boosts "carry" longer. |
| `SPEED_CLASS` | Per-class multipliers for speed and acceleration, catch-up strength, and CPU skill. |

### Steering and grip

| Constant | Effect |
|---|---|
| `maxYawRate` | Maximum turn rate. Higher = tighter turning circle. |
| `fullSteerSpeed` | Below this speed you can't turn at full rate (karts don't spin on the spot). |
| `highSpeedSteer` | Fraction of steering left at top speed. Lower = wider, "heavier" turns at speed. |
| `grip` | How fast sideways sliding is killed. High = on rails, low = slidey. |
| `slipRecovery` | How much sideways speed lost to grip is turned back into forward speed. Higher keeps corners fast and forgiving. |
| `airSteer` | Steering while airborne. |

### Drifting and mini-turbos

| Constant | Effect |
|---|---|
| `driftMinSpeed` | Minimum speed to start a drift. |
| `driftGrip` | Sideways grip while drifting. Lower = bigger slide angle and wider arcs. |
| `driftYawMin` / `driftYawMax` | Turn rate when steering out of / into the drift. The gap between them is how much control you have mid-drift. |
| `driftChargeMin` / `driftChargeMax` | Spark charge per tick when steering out of / into the drift. |
| `driftTiers` | Charge needed for blue, orange and purple sparks. At 60 ticks/s and max charge rate 1.5, `[48, 108, 180]` is about 0.5 s, 1.2 s and 2.0 s. |
| `miniTurboTime` | Boost seconds for releasing at each tier. |

### Boosts, surfaces, air, hits

| Constant | Effect |
|---|---|
| `boostSpeedMult`, `boostAccel` | How much faster boosts are and how hard they push. |
| `padBoostTime`, `itemBoostTime`, `startBoostTime`, `trickBoostTime` | Durations per source. |
| `offroadSpeedMult`, `offroadDrag` | How punishing grass, sand and snow are. This sets how good the shortcuts are. |
| `slopeGravity` | How much hills speed you up or slow you down. |
| `gravity`, `rampLaunch` | Airtime off ramps. Gaps are sized for the defaults: if you lower `rampLaunch`, check Harbor Boardwalk, Hollow Manor and Magma Keep still clear (`npm test` will tell you). |
| `wallRestitution`, `wallSpeedLoss` | How bouncy walls are and how much speed a hit costs. |
| `bumpRestitution`, `maxBumpDv` | Kart-to-kart bumping. Weight is in `characters.ts` (`mass`). |
| `spinTime`, `tumbleTime`, `squashTime`, `postHitInvuln` | How long hits take you out. |

## Recipes

**"Too slidey / drifts feel out of control"**
- Raise `driftGrip` (4.2 → 5.5).
- Narrow the drift range: `driftYawMax` 2.95 → 2.6.
- Raise `grip` (13 → 16) if normal driving also feels loose.

**"More drifty, more like the classic games"**
- Lower `driftGrip` (4.2 → 3.2) for a wider slide angle.
- Raise `miniTurboTime` (e.g. `[0.6, 1.2, 1.9]`) so drifting pays off more.
- Lower `highSpeedSteer` (0.72 → 0.62) so normal steering at speed is wide and drifting becomes necessary.

**"More grippy / beginner friendly"**
- `grip` 13 → 18, `highSpeedSteer` 0.72 → 0.82, `slipRecovery` 0.55 → 0.75.
- Make walls kinder: `wallSpeedLoss` 0.012 → 0.006.

**"Feels slow"**
- `baseTopSpeed` 32 → 36 and `baseAccel` 30 → 34. Corners get harder, so maybe also raise `maxYawRate` slightly. Re-run `npm test`: the no-wall Starlight Ribbon is the first to complain.

**"Shortcuts are useless / too good"**
- `offroadSpeedMult` is the lever (0.52). Lower makes cutting without a boost worse; boosts ignore it entirely.

**"Rubber-banding is noticeable"**
- `SPEED_CLASS[cc].catchUp` is the maximum top-speed bonus or penalty for CPUs (0.05–0.09). Set it to 0 for none.

**"CPUs are too easy / too hard"**
- `SPEED_CLASS[cc].cpuSkill` sets the base skill. In `App.buildSlots` each CPU's skill is spread around that base. Skill controls how closely they follow the racing line, how often they drift and to which spark tier, and how hard they brake for corners.

## Character stats

Stats are 1–5 in `src/sim/characters.ts` and map to multipliers in `getStats()`:

- speed: ×0.955 … ×1.045 top speed
- accel: ×0.85 … ×1.15 acceleration
- handling: ×0.9 … ×1.1 turn rate, ×0.92 … ×1.08 grip
- weight: mass 0.8 … 1.4 (who wins bumps)

The differences are kept small on purpose, so any character can win. Widen the ranges in `getStats()` if you want the picks to matter more.
