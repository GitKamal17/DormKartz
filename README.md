# DormKartz

A 3D arcade kart racer that runs in a desktop browser. You race 7 CPU drivers across 8 original tracks in 2 cups. It has drifting with mini-turbos, items, a Grand Prix with points, single races and a time trial with ghosts.

Everything is original: the characters, tracks, items, art (built in code from primitives) and sound (synthesized with Web Audio). No asset files are downloaded.

## Play

```bash
npm install
npm run dev          # open the printed URL (http://localhost:5173)
```

### Playing on a friend's computer

```bash
npm run build                      # writes a static site to dist/
npx vite preview --host --port 8080
```

`--host` makes the game reachable from other devices on the same network: open `http://<your-ip>:8080` on your friend's machine. You can also copy `dist/` anywhere and serve it with any static web server. It needs to be served over HTTP; opening `index.html` from disk won't work.

Use a recent Chrome, Edge or Firefox. A real GPU is strongly recommended (see [Known limitations](#known-limitations)).

## Controls

| Action | Keyboard | Gamepad (standard mapping) |
|---|---|---|
| Steer | ← → or A D | Left stick / D-pad |
| Accelerate | ↑ or W | A |
| Brake / reverse | ↓ or S | B |
| Drift / hop / trick | Space | R1 or R2 |
| Use item (hold to trail it behind you) | Shift or E | L1 or L2 |
| Look back / throw backwards | Q | X |
| Pause | Esc or P | Start |
| Menus | Arrows + Enter, Esc to go back | D-pad/stick + A, B to go back |

Driving tips:

- **Drift:** while steering, hold drift. Sparks go blue → orange → purple. Let go for a mini-turbo; longer drifts give longer boosts. Steering *into* the drift charges it faster.
- **Rocket start:** press accelerate just after the **1** appears. Holding it from the start gives you a burnout instead.
- **Tricks:** tap drift as you leave a ramp. You get a small boost on landing.
- **Off-road** slows you down unless you're boosting. Every track has a shortcut that's worth taking with a boost.

## Modes

- **Grand Prix:** 4 races in a cup. Points per place: 15/12/10/8/6/4/2/1. There's a standings screen after each race and a podium at the end. You start the first race at the back; after that the grid is reverse standings.
- **Single Race:** any track, at 50cc, 100cc or 150cc.
- **Time Trial:** no CPUs, and you start with a Triple Zoom. Your best lap is saved in `localStorage` as a ghost you race against next time.

## Tracks

| Sprout Cup | | Ember Cup | |
|---|---|---|---|
| Meadow Loop | wide beginner hills, grass shortcut | Hollow Manor | rail-less boards over a void, a jump, a bridge over itself |
| Dune Run | quicksand pit, tumbleweeds, sand shortcut | Neon Avenue | night city, traffic, tunnels, plaza cut |
| Harbor Boardwalk | two water jumps, crates, beach cut | Magma Keep | crushers, lava edges, lava jump, courtyard cut |
| Frostbite Pass | low-grip ice, switchbacks, snowballs, frozen lake | Starlight Ribbon | no walls anywhere, big drops |

**Racers:** Bolt, Pip, Rosa, Grit, Mabel, Tank, Zip and Nova. Each has different speed, acceleration, handling and weight; weight decides who wins a bump.

**Items:**

| Item | What it does |
|---|---|
| Zoom Pop | Boost |
| Triple Zoom | Three boosts |
| Slick Peel | Dropped hazard that spins karts out |
| Bounce Puck | Fires straight and ricochets off walls |
| Seeker Puck | Homes in on the kart ahead |
| Crown Comet | Hunts down 1st place |
| Supernova | Invincibility plus speed |
| Shrink Ray | Shrinks everyone else |

Odds depend on your position. Peels and pucks can be held behind you as a shield.

## Project layout

```
src/sim/        Pure simulation. No Three.js, no DOM, no clock, no Math.random.
  race.ts         createRace(config, seed) / step(state, inputs) at a fixed 60 Hz
  config.ts       every driving-feel constant (see docs/TUNING.md)
  track/          track format (types.ts), loop authoring helper (path.ts), geometry builder (build.ts)
  tracks/         one data file per track
src/input/      InputSource implementations: keyboard+gamepad (LocalInput), AIInput
src/game/       RaceSession (slots, inputs, ticking), fixed-step loop, ghosts, Grand Prix
src/render/     Three.js: world mesh from track data, kart models, effects, N viewports
src/audio/      Web Audio engine sounds, SFX and procedural music
src/ui/         HUD, minimap, menus
tests/          Vitest: sim unit tests + full CPU races on every track
e2e/            Playwright smoke test
scripts/        dev tools: track layout plotter, headless race report
```

## Architecture (and why it's ready for split-screen and online)

The game is split so that later features are additions, not rewrites:

1. **The simulation is pure.** `src/sim` never imports Three.js or the DOM. `step(state, inputs)` advances exactly one 1/60 s tick. All randomness comes from a seeded RNG stored in the state, and the whole `RaceState` is plain JSON (a test checks that it round-trips and keeps simulating identically). The same code could run on a Node server.
2. **Every kart is driven by a `FrameInput`.** `{ steer, throttle, brake, drift, useItem, lookBack }` comes from an `InputSource`: `LocalInput` (keyboard/gamepad), `AIInput`, or later a `NetworkInput`. The sim cannot tell them apart. The only per-kart flag it knows about is `catchUp` (mild rubber-banding), which the session sets for CPU slots.
3. **Players are slots.** A `RaceSession` holds `PlayerSlot { id, kind: 'local' | 'cpu', input, characterId, localIndex }`. Nothing assumes there's one human or that the human is kart 0 in the sim.
4. **Rendering only reads.** It interpolates between the previous and current tick, and draws a list of viewports, each with its own chase camera and HUD. `?viewports=2` splits the screen today, following you and a CPU, to prove it works.

### Adding local split-screen

- Create two `LocalInput`s: one with `{ keys: DEFAULT_KEYS, pad: null }`, the other with `{ keys: <second key set>, pad: 0 }` (or pads 0 and 1).
- Create two `local` slots with `localIndex` 0 and 1.
- Pass both ids to `renderer.load(session, [id0, id1])` and create one `Hud` per viewport (`App.startRace` already does this for the debug flag).
- What's missing is the menu flow for picking two characters and joining with a second pad.

### Adding online / Android

The realistic design is **server-authoritative**: run `step()` on a small Node server, have clients send their `FrameInput` each tick, and broadcast state snapshots that clients interpolate. Client-side prediction of the local kart is optional polish. Don't build lockstep peer-to-peer across different devices: floating-point results can differ between browsers and CPUs, so "same inputs → same state" only holds on the same machine and engine. That's enough for replays and ghosts, but not for cross-device lockstep.

Phones can open the same web build (Three.js runs in mobile browsers). They'll need a touch `InputSource` and an on-screen layout; the input abstraction is where that plugs in.

## Adding a track

1. Copy a file in `src/sim/tracks/`. Describe the loop with `PathBuilder`:

   ```ts
   const p = new PathBuilder('my-track', 22)        // id, road width
     .mark('start')
     .straight(100, { adjust: true })                 // first segment = start straight
     .right(40, 90, { dy: 5 })                        // radius, degrees, elevation change
     .mark('jump')
     .straight(60, { adjust: true })
     .left(30, 180)
     // ... turns must add up to ±360°
     .build();
   ```

   Flag at least two non-parallel straights with `adjust: true`. The builder solves their lengths so the loop closes exactly. Use `at(p, 'mark', offset)` to place features.
2. Fill in the `TrackDef`: walls/open edges, shoulders (wide inside shoulders make shortcuts), gaps, ramps, boost pads, slow zones, item rows, hazards (rollers, traffic, crushers, crates), decorations, theme colors and music.
3. Add it to `TRACKS` in `src/sim/tracks/index.ts` (and give it a `cup`).
4. Run `npm run plot` and open `plots/index.html` to see the layout from above.
5. Run `npm test`. The track tests check closure, self-overlap, the grid and box placement, the shortcut requirement, and that **8 CPUs finish a full race at 150cc and 50cc without getting stuck**. If CPUs stall or fall, `npm run report` prints timings and stall locations.

Nothing in the renderer needs to change; the road, walls, terrain, props and minimap are all generated from the data.

## Development commands

| Command | What it does |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm run build` | typecheck + production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm test` | Vitest: sim unit tests, determinism, ghost replay, every-track CPU races |
| `npm run test:e2e` | build, then Playwright smoke test (menus → race on each track, split screen, pause, time trial). Needs `npx playwright install chromium` the first time. Screenshots go to `e2e/screenshots/` |
| `npm run report [cc] [seed] [track]` | headless CPU race on each track with timings |
| `npm run plot` | top-down SVG of every layout in `plots/` |

URL flags for development: `?viewports=2` (split screen following you and a CPU), `?autopilot` (a CPU drives your kart, which is handy for demos and for watching a whole race). `node e2e/peek.mjs <trackIndex>` runs an autopiloted race in a headless browser and saves screenshots plus the results screen.

## Known limitations

These are honest gaps, not polish items:

- **Driving feel has not been tuned by humans.** The constants are tested for consistency (tiers, boosts, CPU races complete), not for fun. Expect to tweak `src/sim/config.ts` after your first session; `docs/TUNING.md` explains each knob.
- **Performance on real hardware is unmeasured.** It was only run in a headless browser with a software GPU, which is much slower than any real graphics card. The scene is built to be cheap (instanced props, merged track meshes, no real-time shadows, pooled particles), but check the FPS counter in Settings on the actual laptop. If it struggles, lower the pixel ratio in `src/render/renderer.ts`.
- **CPU drivers are competent but simple.** They follow a precomputed racing line, drift on long corners, dodge hazards and use items with basic rules. They don't plan overtakes.
- **Music is procedural and basic:** generated chord loops per track, not composed songs.
- **No touch controls, online play, battle mode or track editor yet.** That's by design for Phase 1.
