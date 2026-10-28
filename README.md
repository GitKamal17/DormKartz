# DormKartz

A 3D arcade kart racer that runs in the browser. Race solo against 7 CPU drivers, 2 to 4 players in split screen on one computer, or online with friends on their own phones and computers using a room code, across 8 original tracks in 2 cups. It has drifting with mini-turbos, items, a Grand Prix with points, single races and a time trial with ghosts.

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

## Online: play with friends on other devices

Up to 8 players, each on their own phone, tablet or computer, race in one room. A small Node server runs the race; every device just sends its controls and draws what the server sends back.

1. Someone picks **Online → Create room** and gets a 4-letter code.
2. Everyone else opens the same web address, picks **Online**, types the code and taps **Join room**.
3. Each player picks a racer. The host picks the track, speed class and whether CPUs fill the grid, then taps **Start race**.

After the race everyone lands back in the room for the next one. If someone's connection drops, or a phone locks or reloads the page, they get their seat back automatically within a minute; a CPU drives their kart in the meantime.

**On a phone (Android Chrome, iPhone Safari):** hold it sideways. Drag anywhere on the left half of the screen to steer. Gas is automatic once the race starts. On the right are **DRIFT** (hold while steering), **ITEM**, **BRAKE** (also reverses), look-back **◀▶**, and **II** at the top for the menu. The first tap goes fullscreen. A keyboard or gamepad also works on any device.

### Run the server

The server serves the game and the online rooms on one port, so players only need its address.

```bash
npm run build      # builds the game (dist/) and the server (dist-server/)
npm start          # http://localhost:8787 (set PORT to change it)
```

That's enough for everyone on the same Wi-Fi: open `http://<your-computer's-ip>:8787` on the phone. To play with someone who isn't on your network, or without running it on your computer, host it:

**Render (free, no credit card):** push this repo to GitHub, then on [render.com](https://render.com) choose **New → Blueprint** and pick the repo. `render.yaml` sets everything up. You get an `https://….onrender.com` address to share. Free servers go to sleep after 15 minutes without visitors; the first visit after that takes about a minute to wake it up.

**Anywhere that runs Docker** (Fly.io, Railway, a VPS): the `Dockerfile` builds and runs the whole thing on port 8787.

To develop online play with hot reload, run `npm run server` in one terminal and `npm run dev` in another; the dev server forwards `/ws` to the game server. A page served from somewhere else can point at a server with `?server=wss://your-server`.

## Controls (solo)

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

## Party Race: 2 to 4 players, split screen

From the main menu pick **Party Race**. Each player joins by pressing a button on their own device:

| Device | Press to join | In the lobby |
|---|---|---|
| Keyboard, left side | **Space** | W A S D move · Space pick · Q back |
| Keyboard, arrow side | **Enter** | Arrows move · Enter pick · Backspace back |
| Any gamepad | **A** | Stick/D-pad move · A pick · B back |

Everyone moves their own cursor and locks in a racer at the same time (two players can't pick the same one). When everyone is ready, any player presses pick again. Then choose **VS Race** or **Grand Prix**, whether to fill the grid with **CPU racers**, the speed class and the track. Anyone can drive those menus.

One keyboard fits **two** players. Players 3 and 4 need gamepads; any mix works, e.g. two on the keyboard plus two gamepads, or four gamepads.

### Each player's controls in a party race

**Player on the left side of the keyboard:**

| Action | Key |
|---|---|
| Steer | A / D |
| Accelerate | W |
| Brake / reverse | S |
| Drift / hop / trick | Space |
| Use item | Left Shift or E |
| Look back | Q |
| Pause (for everyone) | Esc |

**Player on the arrow side of the keyboard:**

| Action | Key | Numpad alternative |
|---|---|---|
| Steer | ← / → | 4 / 6 |
| Accelerate | ↑ | 8 |
| Brake / reverse | ↓ | 5 or 2 |
| Drift / hop / trick | Right Shift | 0 |
| Use item | / or Right Ctrl | . (decimal) |
| Look back | . (period) | 1 |
| Pause (for everyone) | Esc | |

**Players on gamepads** (each has their own; same layout as solo):

| Action | Button |
|---|---|
| Steer | Left stick or D-pad |
| Accelerate | A |
| Brake / reverse | B |
| Drift / hop / trick | R1 or R2 |
| Use item | L1 or L2 |
| Look back | X |
| Pause (for everyone) | Start |

On a Mac, the arrow-side player should use **/** for items: most Mac keyboards have no Right Ctrl, and Ctrl+arrow switches desktops.

If only **one** person is on the keyboard (everyone else on gamepads), they get the full solo layout: arrows *or* WASD, Space, Shift/E, Q. The lobby shows each player's exact controls under their name, and Settings → Controls lists them too.

### Screen layout

- **2 players:** top/bottom. Switch to side by side in Settings → "2-player split side by side".
- **3 players:** 2×2 grid; the fourth quarter shows a live map and the standings.
- **4 players:** 2×2 grid.

Each player's screen has a colored frame and P1–P4 tag, and other players show up ringed in their color on the minimap. The race ends when every human has crossed the line; finished players are driven by a CPU until then. If a player's gamepad disconnects mid-race, the game pauses until it's back.

### Shared-keyboard caveat

Many keyboards, especially laptop ones, can't register more than a few keys at once ("ghosting"). Two people holding accelerate, steering and drifting at the same time can hit that limit, and a key press gets dropped. If one player's inputs seem to stick or vanish, that's the keyboard, not the game. Plugging in a gamepad for one of them fixes it. Most USB/Bluetooth controllers (Xbox, PlayStation, Switch Pro, generic) work in Chrome and Edge; press a button once after plugging in so the browser sees it.

## Modes

- **Grand Prix:** 4 races in a cup. Points per place: 15/12/10/8/6/4/2/1. There's a standings screen after each race and a podium at the end. You start the first race at the back; after that the grid is reverse standings.
- **Single Race:** any track, at 50cc, 100cc or 150cc.
- **Party Race:** 2–4 players in split screen, as a single VS race or a Grand Prix, with or without CPUs.
- **Online:** up to 8 players on their own devices, joined with a room code, with or without CPUs (single races).
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
src/input/      InputSource implementations: keyboard+gamepad (LocalInput), touch (TouchInput), AIInput; per-device lobby input
src/game/       RaceSession (slots, inputs, ticking), fixed-step loop, ghosts, Grand Prix, party setup
src/render/     Three.js: world mesh from track data, kart models, effects, N viewports
src/audio/      Web Audio engine sounds, SFX and procedural music
src/net/        online play: wire protocol + snapshots, WebSocket client, interpolated NetRace
src/ui/         HUD, minimap, menus, party lobby
server/         Node game server: rooms and codes, authoritative races, static file serving
tests/          Vitest: sim unit tests + full CPU races on every track
e2e/            Playwright smoke test
scripts/        dev tools: track layout plotter, headless race report
```

## Architecture (and why it's ready for split-screen and online)

The game is split so that later features are additions, not rewrites:

1. **The simulation is pure.** `src/sim` never imports Three.js or the DOM. `step(state, inputs)` advances exactly one 1/60 s tick. All randomness comes from a seeded RNG stored in the state, and the whole `RaceState` is plain JSON (a test checks that it round-trips and keeps simulating identically). The same code could run on a Node server.
2. **Every kart is driven by a `FrameInput`.** `{ steer, throttle, brake, drift, useItem, lookBack }` comes from an `InputSource`: `LocalInput` (keyboard/gamepad), `AIInput`, or later a `NetworkInput`. The sim cannot tell them apart. The only per-kart flag it knows about is `catchUp` (mild rubber-banding), which the session sets for CPU slots.
3. **Players are slots.** A `RaceSession` holds `PlayerSlot { id, kind: 'local' | 'cpu', input, characterId, localIndex }`. Nothing assumes there's one human or that the human is kart 0 in the sim.
4. **Rendering only reads.** It interpolates between the previous and current tick, and draws a list of viewports, each with its own chase camera and HUD. Party Race uses this for 2–4 player split screen.

### How split screen is built

Party mode uses exactly the pieces above, with no special cases in the simulation:

- `src/game/party.ts` maps each joined device to a `LocalInput` (keyboard half or gamepad index) and lays out the viewports. It's pure and unit-tested.
- `src/input/devices.ts` turns each keyboard half and each gamepad into a separate menu device, so the lobby can have one cursor per player.
- Each human is a `local` slot with its own `LocalInput`; the renderer draws one viewport per human, each with its own chase camera and HUD.
- Kart models are merged into a few draw calls each, so drawing the scene four times stays affordable.

### How online play is built

It's **server-authoritative**, not peer-to-peer lockstep: floating-point results can differ between browsers and CPUs, so "same inputs → same state" only holds on one machine and engine.

- `server/rooms.ts` runs the same `RaceSession` the offline game uses. Each remote human is a `remote` slot whose `InputSource` is just the last packed `FrameInput` that device sent (the same 32-bit packing ghosts use). A dropped player's slot is switched to an `AIInput` until they reconnect.
- The server steps every room at 60 Hz and sends a snapshot every 2 ticks (30 Hz): the `RaceState` minus config and RNG, karts as value arrays, numbers rounded, plus every event since the last snapshot. With WebSocket compression that's a few dozen KB/s per player.
- `src/net/netRace.ts` keeps a short buffer and draws about 100 ms behind the newest snapshot, interpolating between the two that bracket that time. Rendering, HUD and audio don't know the race is remote: they read a `RaceSession` like always.
- Clients send input when it changes (and a few times a second anyway). There is no client-side prediction yet, so your own kart reacts after one round trip plus the interpolation delay.
- `tests/online.test.ts` drives the room server with fake connections: create, join by code, race, drop and rejoin, results.

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
| `npm run build` | typecheck + production build to `dist/`, plus the server bundle in `dist-server/` |
| `npm start` | run the online server (game + rooms) on port 8787 |
| `npm run server` | rebuild the server bundle, then run it |
| `npm run typecheck` | TypeScript only |
| `npm test` | Vitest: sim unit tests, determinism, ghost replay, every-track CPU races |
| `npm run test:e2e` | build, then Playwright smoke test: menus → race on each track, pause, time trial, and party races with 2, 3 and 4 players (gamepads are simulated). Needs `npx playwright install chromium` the first time. Screenshots go to `e2e/screenshots/` |
| `npm run report [cc] [seed] [track]` | headless CPU race on each track with timings |
| `npm run plot` | top-down SVG of every layout in `plots/` |

URL flags for development: `?viewports=2` (split screen following you and a CPU), `?autopilot` (a CPU drives your kart, which is handy for demos and for watching a whole race). `node e2e/peek.mjs <trackIndex>` runs an autopiloted race in a headless browser and saves screenshots plus the results screen.

## Known limitations

These are honest gaps, not polish items:

- **Driving feel has not been tuned by humans.** The constants are tested for consistency (tiers, boosts, CPU races complete), not for fun. Expect to tweak `src/sim/config.ts` after your first session; `docs/TUNING.md` explains each knob.
- **Split screen multiplies the rendering work.** Four players means drawing the scene four times. It's been checked for correctness, not speed on a real laptop; if 3–4 players stutters, turn on the FPS counter and see the note below.
- **Performance on real hardware is unmeasured.** It was only run in a headless browser with a software GPU, which is much slower than any real graphics card. The scene is built to be cheap (instanced props, merged track meshes, no real-time shadows, pooled particles), but check the FPS counter in Settings on the actual laptop. If it struggles, lower the pixel ratio in `src/render/renderer.ts`.
- **CPU drivers are competent but simple.** They follow a precomputed racing line, drift on long corners, dodge hazards and use items with basic rules. They don't plan overtakes.
- **Music is procedural and basic:** generated chord loops per track, not composed songs.
- **Online has no prediction for your own kart.** Steering reacts after your ping plus ~100 ms. On the same Wi-Fi that's barely noticeable; over mobile data to a far-away server it feels a bit floaty. Host the server near the players.
- **Online is single races only** (no online Grand Prix yet), and there's no chat or spectating; someone who joins mid-race waits in the room for the next one.
- **Touch controls haven't been tried on a real phone yet**, only in a phone-sized emulated browser. Expect to adjust button sizes and steering sensitivity (`src/input/touch.ts`, `.tc-*` in `src/style.css`).
- **No battle mode or track editor yet.**
