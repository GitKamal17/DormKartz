# DormKartz – Phase 1 Build Prompt

Paste everything below the line into Claude Code, run from the root of this repo.

---

Build **DormKartz**, a 3D arcade kart racer that runs in a desktop web browser. Single player vs. 7 CPU racers. This is Phase 1 of a game that will later get local split-screen and online play from Android phones, so the architecture rules below are hard requirements, not suggestions.

## Legal / originality (hard rule)
This is a kart racer *in the spirit of* classic kart games, not a copy of one. Use **no** Nintendo names, characters, track names, track layouts, sprites, models, sounds, music or logos. All characters, items and tracks get original names and designs. Item and track *archetypes* (boost item, homing projectile, ice level, castle level, sky rainbow level) are fine; specific copyrighted content is not.

## Tech stack (fixed, do not substitute)
- TypeScript (strict), Vite, Three.js. No game engine, no physics engine: write custom arcade kart physics.
- Vitest for unit tests, Playwright (already installed in the environment) for browser smoke tests.
- All art is procedural/low-poly geometry built in code; all sound is synthesized with the Web Audio API. No external asset downloads.
- `npm install && npm run dev` must be the only steps needed to play. `npm run build` produces a static `dist/` that works from any static host.

## Architecture (hard requirements: these make split-screen and online possible later without a rewrite)
1. **`src/sim/` is pure.** No imports from Three.js, the DOM, `window`, or `performance.now()`. It exposes `createRace(config, seed)` and `step(state, inputs: Map<PlayerId, FrameInput>)` running at a **fixed 60 Hz tick**. All randomness goes through a seeded RNG stored in the state. The full race state is plain serializable data (`JSON.stringify` round-trips it).
2. **Input is abstracted.** `FrameInput = { steer: -1..1, throttle: 0..1, brake: 0..1, drift: boolean, useItem: boolean, lookBack: boolean }`. An `InputSource` interface has `KeyboardInput`, `GamepadInput` (standard Gamepad API) and `AIInput` implementations. The sim never knows which kind is driving a kart.
3. **Players are slots, not a global.** A race has an array of `PlayerSlot { id, kind: 'local' | 'cpu', inputSource, characterId }`. Nothing anywhere assumes "the player" is index 0 or that there is exactly one human.
4. **Rendering reads the sim, never writes to it.** `src/render/` interpolates between the last two sim states for smooth frames. The renderer draws into a **list of viewports**, each with its own camera following one `PlayerId` and its own HUD. Phase 1 ships with one viewport, but add a debug URL flag `?viewports=2` that splits the screen horizontally and follows player 1 and CPU 1, to prove the renderer genuinely supports N viewports.
5. Game loop: fixed-timestep accumulator driving `step()`, decoupled from `requestAnimationFrame`.

## Driving feel (top priority: this is what makes it fun)
- Arcade handling: responsive steering, quick acceleration, speed-dependent turn radius, light drift-friendly grip.
- **Drift + mini-turbo:** hold drift while steering to slide; sparks change color through 3 charge tiers; releasing gives a boost proportional to tier.
- Start-line boost if throttle is pressed at the right moment of the countdown.
- Jumps off ramps with airtime; a "trick" input on takeoff gives a small boost on landing.
- Off-road (grass, sand, snow) slows you. Walls deflect you, they don't stop you dead.
- Falling off the track or into lava/water: a respawn drone (original design) puts you back on the nearest checkpoint after ~1.5 s.
- Speed classes: 50cc / 100cc / 150cc.
- Kart physics constants live in one tunable config file, with comments describing what each one does to the feel.

## Characters
8 original characters with distinct silhouettes and colors, built from primitives. Each has stats (top speed, acceleration, handling, weight); weight affects collision bumps between karts. Character select screen shows a turntable preview and stat bars.

## Items
Item boxes on the track respawn after pickup. 8 original items covering these archetypes:
1. Single speed boost  2. Triple speed boost  3. Dropped slip hazard (kart spins out)  4. Straight bouncing projectile (ricochets off walls, limited bounces)  5. Homing projectile (targets the kart ahead)  6. Leader-seeking projectile (hunts 1st place)  7. Temporary invincibility + speed  8. Field-wide shrink of all opponents.

Item odds depend on race position (back of the pack gets stronger items). Hold-to-trail defensive items behind the kart. Hit reactions: spin-out, tumble, squash, with brief invulnerability afterward.

## CPU opponents
- Follow a racing line derived from the track spline, with per-CPU skill and lane offsets so they don't drive in a single file.
- They drift, use mini-turbos, pick up and use items sensibly, and recover from being hit or knocked off.
- Mild rubber-banding scaled by speed class.
- They must never get permanently stuck (see tests).

## Tracks (data-driven)
Each track is a TypeScript data file: a closed centerline spline of control points `{x, y, z, width, bank}`, plus per-segment flags (wall / no-wall edge, off-road zones, boost pads, ramps), item-box rows, hazard definitions, decoration rules, theme (palette, sky, fog, lighting), music tempo/key, and lap count. A single generator builds the road mesh, walls, collision, checkpoints, and racing line from this data, so adding a new track means adding one data file and nothing else.

Ship **8 tracks in 2 cups**, each with elevation changes and a clear identity:

**Sprout Cup**
1. Meadow Loop: wide beginner circuit, gentle hills, boost pads.
2. Dune Run: desert, off-road sand, a quicksand pit that slows hard, rolling tumbleweed hazards.
3. Harbor Boardwalk: seaside docks, wooden ramps over water gaps, crates.
4. Frostbite Pass: icy low-grip road, sliding snowball hazards, a frozen-lake shortcut.

**Ember Cup**
5. Hollow Manor: haunted mansion, missing-rail board sections over a void, flickering lights.
6. Neon Avenue: night city, moving traffic to dodge, tunnels.
7. Magma Keep: castle with timed crushers and lava fall-off edges.
8. Starlight Ribbon: glowing road in the sky with **no walls**, tight turns and big drops. The final, hardest track.

Each track also needs: a fair start grid of 8, at least one risky shortcut that requires a boost, and anti-cheat checkpoints so a lap only counts if all checkpoints are crossed in order.

## Race rules and modes
- Lap counting, live position ranking (by checkpoint progress, then distance along the spline), wrong-way detection with a warning.
- **Grand Prix:** 4 races per cup, points per finishing place, standings screen after each race, podium at the end.
- **Single Race:** any track, any speed class.
- **Time Trial:** no CPUs, starts with the triple boost, ghost of your best lap saved in `localStorage` and replayed (only possible because the sim is deterministic and input-driven).
- Pause menu: resume, restart, quit.

## HUD and UI
Position (large), lap X/3, race timer and lap splits, item slot with roulette animation, minimap with all kart dots, countdown, wrong-way warning, finish banner. Menus: title → mode → speed class → character → cup/track → race. Fully playable with keyboard alone and with a gamepad alone. Settings: volume, controls display, show FPS.

## Controls (defaults)
Keyboard: arrows or WASD steer/throttle/brake, Space = drift/hop, Shift or E = item, Q = look back, Esc = pause. Gamepad: standard mapping (A throttle, B brake, R1 drift, L1 item, left stick steer).

## Audio
Synthesized with Web Audio: engine sound whose pitch tracks speed, drift squeal, spark-tier chimes, boost whoosh, item sounds, crash, countdown beeps, and a simple procedural music loop per track theme.

## Performance
Steady 60 fps with 8 karts on an integrated-GPU laptop at 1080p. Use instancing for repeated decoration, keep draw calls low, and avoid allocations in the per-tick hot path. Keep it light enough that a mid-range Android phone browser is realistic later.

## Verification (do not stop until all of this passes)
1. `npm run typecheck` and `npm run build`: zero errors.
2. Vitest unit tests for the sim: lap counting, checkpoint anti-cheat, position ranking, drift tier timing and boost, each item's effect, wrong-way detection, serialization round-trip, and determinism (same seed + same inputs → identical state after 3,000 ticks).
3. **Headless track test:** for every track, run a sim-only race with 8 `AIInput` CPUs (no rendering, as fast as possible). Assert that every kart finishes all laps within a time limit and that no kart has near-zero progress for more than 5 sim-seconds. This is the test that proves each track is actually drivable. Fix the tracks or the AI until it passes.
4. Playwright smoke test: load the built game, go through the menus into a race on each track, drive for a few seconds with simulated keyboard input, take a screenshot, and assert there are no console errors. Also test `?viewports=2`.
5. Look at the screenshots yourself and fix anything visually broken (black screen, kart under the road, z-fighting, missing sky).

## Out of scope for Phase 1 (but must not be blocked by the architecture)
Online multiplayer, split-screen menus and setup, touch controls, battle mode, track editor.

## Deliverables
- Working game in this repo, committed in logical steps.
- `README.md`: how to run, controls, how to add a track, and how the sim/input/render split is meant to support split-screen and online play later.
- `docs/TUNING.md`: which constants control the driving feel and what to change for "more drifty" or "more grippy".
