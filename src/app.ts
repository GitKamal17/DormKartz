// Top-level game flow: menus, starting races, results, Grand Prix, settings.

import { AudioEngine, MENU_MUSIC } from './audio/audio';
import { FixedLoop } from './game/loop';
import { GrandPrix, type Racer } from './game/grandPrix';
import { loadGhost, loadRecord, saveGhost, saveRecord } from './game/ghost';
import { RaceSession, type GameMode, type PlayerSlot } from './game/session';
import { loadSettings, saveSettings, type Settings } from './game/settings';
import { AIInput } from './input/ai';
import { installKeyboard } from './input/keyboard';
import { LocalInput } from './input/local';
import { MenuInput, type MenuAction } from './input/menuInput';
import { GameRenderer } from './render/renderer';
import { CHARACTERS, getCharacter } from './sim/characters';
import { SPEED_CLASS, TICK_RATE } from './sim/config';
import { SeededRandom } from './sim/rng';
import { CUPS, getTrack, getTrackDef, TRACKS } from './sim/tracks';
import type { PlayerId, SpeedClass } from './sim/types';
import { Hud, Minimap } from './ui/hud';
import { formatTime, ordinalSuffix } from './ui/icons';
import { Menu, type Screen } from './ui/menu';
import { Preview } from './ui/preview';

const PLAYER_ID = 0;
const params = new URLSearchParams(location.search);
const DEBUG_VIEWPORTS = Math.max(1, Math.min(4, Number(params.get('viewports') ?? 1) || 1));
/** Dev/demo flag: a CPU drives your kart. */
const AUTOPILOT = params.has('autopilot');

function hexColor(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function statBars(c: { speed: number; accel: number; handling: number; weight: number }): string {
  const row = (label: string, v: number) => `<div class="stat"><span>${label}</span><div class="bar"><div style="width:${v * 20}%"></div></div></div>`;
  return row('Speed', c.speed) + row('Accel', c.accel) + row('Handling', c.handling) + row('Weight', c.weight);
}

export class App {
  readonly renderer: GameRenderer;
  readonly audio = new AudioEngine();
  readonly menuInput: MenuInput;
  readonly menu: Menu;
  private readonly hudLayer: HTMLDivElement;
  private readonly fpsEl: HTMLDivElement;
  private readonly loop: FixedLoop;
  private settings: Settings;
  private preview: Preview | null = null;

  private mode: GameMode = 'single';
  private cc: SpeedClass = 100;
  private characterId = 'rosa';
  private trackId = TRACKS[0].id;
  private gp: GrandPrix | null = null;

  session: RaceSession | null = null;
  private attract = false;
  private huds: Hud[] = [];
  private paused = false;
  private resultsAt = 0;
  private resultsShown = false;
  private fpsFrames = 0;
  private fpsTime = 0;
  private lastTT: { total: number; best: number; newRecord: boolean; newLap: boolean } | null = null;

  constructor(private readonly container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.id = 'game';
    container.appendChild(canvas);
    this.renderer = new GameRenderer(canvas);
    this.hudLayer = document.createElement('div');
    this.hudLayer.className = 'hud-layer';
    container.appendChild(this.hudLayer);
    const ui = document.createElement('div');
    ui.className = 'ui-layer';
    container.appendChild(ui);
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps';
    container.appendChild(this.fpsEl);
    this.menu = new Menu(ui, {
      move: () => this.audio.menuMove(),
      confirm: () => this.audio.menuConfirm(),
      back: () => this.audio.menuBack(),
    });
    installKeyboard();
    this.menuInput = new MenuInput();
    this.menuInput.on((a, source) => this.onMenuAction(a, source));
    window.addEventListener('pointerdown', () => this.audio.unlock());
    window.addEventListener('keydown', () => this.audio.unlock());
    window.addEventListener('resize', () => this.renderer.resize());
    this.settings = loadSettings();
    this.applySettings();
    this.loop = new FixedLoop(
      () => this.session?.tick(),
      (alpha, dt) => this.frame(alpha, dt),
    );
  }

  start(): void {
    this.startAttract();
    this.loop.start();
    this.showTitle();
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private frame(alpha: number, dt: number): void {
    this.menuInput.pollGamepad(performance.now());
    const s = this.session;
    if (s) {
      const events = s.drainEvents();
      this.renderer.onEvents(events);
      if (!this.attract) {
        for (const h of this.huds) h.onEvents(events, s.state);
        const listeners = new Set(s.localSlots().map((x) => x.id));
        const me = s.kart(PLAYER_ID);
        this.audio.onEvents(events, listeners, (id) => {
          const k = s.kart(id);
          const d = Math.hypot(k.x - me.x, k.z - me.z);
          return Math.max(0, 1 - d / 60);
        });
        for (const slot of s.localSlots()) {
          const k = s.kart(slot.id);
          this.audio.updateEngine(slot.id, k, s.lastInput.get(slot.id)?.throttle ?? 0, !this.paused);
        }
      }
      this.renderer.render(alpha, dt);
      if (!this.attract) {
        this.renderer.viewports.forEach((vp, i) => {
          const g = s.ghost?.active ? s.ghost.state!.karts[0] : null;
          this.huds[i]?.update(s.state, s.kart(vp.follow), g, s.ghost ? s.ghost.data.lapTicks : null);
        });
        this.checkRaceEnd();
      } else if (s.state.phase === 'finished' || s.state.tick > 60 * TICK_RATE * 3) {
        this.startAttract();
      }
    }
    if (this.settings.showFps) {
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        const info = this.renderer.info.render;
        this.fpsEl.textContent = `${Math.round(this.fpsFrames / this.fpsTime)} fps · ${info.calls} draws`;
        this.fpsFrames = 0;
        this.fpsTime = 0;
      }
    }
  }

  private onMenuAction(a: MenuAction, source: 'key' | 'pad'): void {
    if (this.menu.visible) {
      this.menu.handle(a);
      return;
    }
    // On a gamepad B is the brake, so only Start pauses; on a keyboard Esc does.
    const wantsPause = a === 'pause' || (a === 'back' && source === 'key');
    if (!this.attract && this.session && wantsPause && !this.resultsShown) this.pause();
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  private startAttract(): void {
    const r = new SeededRandom(Date.now());
    const track = TRACKS[r.int(0, TRACKS.length - 1)];
    const slots: PlayerSlot[] = CHARACTERS.map((c, i) => ({
      id: i,
      kind: 'cpu',
      characterId: c.id,
      input: new AIInput(0.75 + r.next() * 0.2, `attract-${i}-${Date.now()}`),
      localIndex: -1,
    }));
    this.clearRace();
    this.attract = true;
    this.session = new RaceSession({ trackId: track.id, speedClass: 150, mode: 'single', slots, seed: r.int(0, 1e9) });
    this.renderer.load(this.session, [r.int(0, 7)]);
    this.loop.ticking = true;
  }

  private clearRace(): void {
    for (const h of this.huds) h.destroy();
    this.huds = [];
    this.audio.stopEngines();
    this.renderer.unload();
    this.session = null;
    this.paused = false;
    this.resultsShown = false;
    this.resultsAt = 0;
    this.container.classList.remove('racing');
  }

  private buildSlots(rng: SeededRandom): PlayerSlot[] {
    const player: PlayerSlot = {
      id: PLAYER_ID,
      kind: 'local',
      characterId: this.characterId,
      input: AUTOPILOT ? new AIInput(0.95, 'autopilot') : new LocalInput(),
      localIndex: 0,
    };
    if (this.mode === 'tt') return [player];
    const base = SPEED_CLASS[this.cc].cpuSkill;
    const makeCpu = (id: PlayerId, characterId: string, rank: number): PlayerSlot => ({
      id,
      kind: 'cpu',
      characterId,
      input: new AIInput(Math.min(1, Math.max(0.3, base - 0.12 + rank * 0.04)), `cpu-${id}-${rng.int(0, 1e9)}`),
      localIndex: -1,
    });
    if (this.gp) {
      return this.gp.gridOrder().map((r, i) => (r.local ? player : makeCpu(r.id, r.characterId, i % 7)));
    }
    const others = CHARACTERS.filter((c) => c.id !== this.characterId);
    for (let i = others.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [others[i], others[j]] = [others[j], others[i]];
    }
    const cpus = others.map((c, i) => makeCpu(i + 1, c.id, i));
    return [...cpus, player];
  }

  startRace(trackId: string): void {
    this.menu.close();
    this.preview?.stop();
    this.clearRace();
    this.attract = false;
    this.trackId = trackId;
    const rng = new SeededRandom(Date.now());
    const slots = this.buildSlots(rng);
    const ghost = this.mode === 'tt' ? loadGhost(trackId) : null;
    this.session = new RaceSession({ trackId, speedClass: this.mode === 'tt' ? 150 : this.cc, mode: this.mode, slots, seed: rng.int(0, 1e9), ghost });
    const follow: PlayerId[] = [PLAYER_ID];
    if (DEBUG_VIEWPORTS > 1) {
      for (const sl of slots) if (sl.kind === 'cpu' && follow.length < DEBUG_VIEWPORTS) follow.push(sl.id);
      while (follow.length < DEBUG_VIEWPORTS) follow.push(PLAYER_ID);
    }
    this.renderer.load(this.session, follow);
    this.huds = this.renderer.viewports.map((vp) => {
      const h = new Hud(this.hudLayer, this.session!.track, vp.follow, this.session!.state.config.laps, this.renderer.viewports.length > 1);
      h.setRect(vp.rect);
      return h;
    });
    this.audio.unlock();
    this.audio.startMusic(getTrackDef(trackId).music);
    this.audio.startEngines([PLAYER_ID]);
    this.container.classList.add('racing');
    this.loop.ticking = true;
    this.lastTT = null;
  }

  private checkRaceEnd(): void {
    const s = this.session;
    if (!s || this.resultsShown) return;
    const me = s.kart(PLAYER_ID);
    if (!me.finished && s.state.phase !== 'finished') return;
    if (!this.resultsAt) {
      this.resultsAt = performance.now() + 3500;
      if (this.mode === 'tt') this.saveTimeTrial();
    }
    if (performance.now() >= this.resultsAt) {
      this.resultsShown = true;
      this.showResults();
    }
  }

  private saveTimeTrial(): void {
    const s = this.session!;
    const me = s.kart(PLAYER_ID);
    const total = me.finishTick - s.state.goTick;
    const best = Math.min(...me.lapTimes);
    const prev = loadRecord(this.trackId);
    const newRecord = !prev || total < prev.total;
    const newLap = !prev || best < prev.lap;
    if (newRecord || newLap) {
      saveRecord(this.trackId, {
        total: newRecord ? total : prev!.total,
        lap: newLap ? best : prev!.lap,
        characterId: this.characterId,
      });
    }
    const ghost = s.recorder?.best;
    const stored = loadGhost(this.trackId);
    if (ghost && (!stored || ghost.lapTicks < stored.lapTicks)) saveGhost(ghost);
    this.lastTT = { total, best, newRecord, newLap };
  }

  private pause(): void {
    if (!this.session || this.paused) return;
    this.paused = true;
    this.loop.ticking = false;
    this.audio.suspend(true);
    const resume = () => {
      this.menu.close();
      this.paused = false;
      this.loop.ticking = true;
      this.audio.suspend(false);
    };
    this.menu.show({
      id: 'pause',
      title: 'Paused',
      className: 'overlay small',
      items: [
        { label: 'Resume', id: 'resume', action: resume },
        {
          label: 'Restart',
          id: 'restart',
          action: () => {
            this.audio.suspend(false);
            this.startRace(this.trackId);
          },
        },
        {
          label: 'Quit to Menu',
          id: 'quit',
          action: () => {
            this.audio.suspend(false);
            this.quitToMenu();
          },
        },
      ],
      onBack: resume,
    });
  }

  private quitToMenu(): void {
    this.gp = null;
    this.audio.stopMusic();
    this.startAttract();
    this.showMain();
  }

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  private showTitle(): void {
    this.menu.show({
      id: 'title',
      className: 'title',
      items: [{ label: 'Press Enter / A to start', id: 'start', className: 'press-start', action: () => this.showMain() }],
      extra: (root) => {
        root.innerHTML = '<div class="logo"><span>DORM</span><span>KARTZ</span></div>';
      },
      footer: 'Keyboard or gamepad · <b>Esc</b> pauses',
    });
  }

  private showMain(): void {
    this.gp = null;
    this.audio.unlock();
    this.audio.startMusic(MENU_MUSIC);
    this.menu.show({
      id: 'main',
      title: 'DormKartz',
      className: 'main',
      items: [
        { label: 'Grand Prix', id: 'gp', html: '<small>4 races · points · podium</small>', action: () => ((this.mode = 'gp'), this.showCC()) },
        { label: 'Single Race', id: 'single', html: '<small>any track, any class</small>', action: () => ((this.mode = 'single'), this.showCC()) },
        { label: 'Time Trial', id: 'tt', html: '<small>race your ghost</small>', action: () => ((this.mode = 'tt'), this.showCharacters()) },
        { label: 'Settings', id: 'settings', action: () => this.showSettings() },
      ],
      onBack: () => this.showTitle(),
      footer: '↑↓ choose · Enter/A select · Esc/B back',
    });
  }

  private showCC(): void {
    const order: SpeedClass[] = [50, 100, 150];
    this.menu.show({
      id: 'cc',
      title: this.mode === 'gp' ? 'Grand Prix' : 'Single Race',
      subtitle: 'Choose a speed class',
      items: order.map((cc) => ({
        label: `${cc}cc`,
        id: `cc-${cc}`,
        html: `<small>${cc === 50 ? 'relaxed' : cc === 100 ? 'standard' : 'fast and fierce'}</small>`,
        action: () => {
          this.cc = cc;
          this.showCharacters();
        },
      })),
      initial: order.indexOf(this.cc),
      onBack: () => this.showMain(),
    });
  }

  private showCharacters(): void {
    if (!this.preview) this.preview = new Preview();
    const preview = this.preview;
    let info: HTMLDivElement | null = null;
    const update = (i: number) => {
      const c = CHARACTERS[i];
      preview.show([c.id]);
      if (info) info.innerHTML = `<h2 style="color:${hexColor(c.color === 0xf0f0f5 ? 0xff5fa2 : c.color)}">${c.name}</h2><p>${c.blurb}</p>${statBars(c)}`;
    };
    this.menu.show({
      id: 'character',
      title: 'Choose your racer',
      layout: 'side',
      columns: 4,
      items: CHARACTERS.map((c) => ({
        label: c.name,
        id: `char-${c.id}`,
        className: 'char-card',
        html: `<span class="swatch" style="background:${hexColor(c.color)};border-color:${hexColor(c.accent)}"></span>`,
        action: () => {
          this.characterId = c.id;
          if (this.mode === 'gp') this.showCups();
          else this.showTracks();
        },
      })),
      initial: Math.max(0, CHARACTERS.findIndex((c) => c.id === this.characterId)),
      onFocus: update,
      extra: (root) => {
        root.appendChild(preview.canvas);
        info = document.createElement('div');
        info.className = 'char-info';
        root.appendChild(info);
        preview.start();
        update(Math.max(0, CHARACTERS.findIndex((c) => c.id === this.characterId)));
        return () => preview.stop();
      },
      onBack: () => (this.mode === 'tt' ? this.showMain() : this.showCC()),
    });
  }

  private showCups(): void {
    this.menu.show({
      id: 'cup',
      title: 'Choose a cup',
      subtitle: `${this.cc}cc · ${getCharacter(this.characterId).name}`,
      items: CUPS.map((cup) => ({
        label: cup.name,
        id: `cup-${cup.id}`,
        className: 'cup',
        html: `<small>${cup.tracks.map((t) => getTrackDef(t).name).join(' · ')}</small>`,
        action: () => this.startGrandPrix(cup.id),
      })),
      onBack: () => this.showCharacters(),
    });
  }

  private showTracks(): void {
    let detail: HTMLDivElement | null = null;
    const update = (i: number) => {
      const def = TRACKS[i];
      if (!detail) return;
      const mm = new Minimap(getTrack(def.id), 220);
      const rec = this.mode === 'tt' ? loadRecord(def.id) : null;
      detail.innerHTML = `<h2>${def.name}</h2><p>${def.description}</p><p class="cupname">${CUPS.find((c) => c.id === def.cup)!.name} · ${def.laps} laps</p>${
        this.mode === 'tt' ? `<p class="record">${rec ? `Record ${formatTime(rec.total)} · best lap ${formatTime(rec.lap)}` : 'No record yet'}</p>` : ''
      }`;
      detail.prepend(mm.canvas);
    };
    this.menu.show({
      id: 'track',
      title: this.mode === 'tt' ? 'Time Trial' : 'Choose a track',
      subtitle: this.mode === 'tt' ? 'Start with a Triple Zoom. Your best lap becomes a ghost.' : `${this.cc}cc`,
      layout: 'side',
      columns: 2,
      items: TRACKS.map((t) => ({
        label: t.name,
        id: `track-${t.id}`,
        className: `track-card cup-${t.cup}`,
        action: () => this.startRace(t.id),
      })),
      initial: Math.max(0, TRACKS.findIndex((t) => t.id === this.trackId)),
      onFocus: update,
      extra: (root) => {
        detail = document.createElement('div');
        detail.className = 'track-detail';
        root.appendChild(detail);
        update(Math.max(0, TRACKS.findIndex((t) => t.id === this.trackId)));
      },
      onBack: () => this.showCharacters(),
    });
  }

  private startGrandPrix(cupId: string): void {
    const cup = CUPS.find((c) => c.id === cupId)!;
    const others = CHARACTERS.filter((c) => c.id !== this.characterId);
    const racers: Racer[] = [{ id: PLAYER_ID, characterId: this.characterId, local: true }, ...others.map((c, i) => ({ id: i + 1, characterId: c.id, local: false }))];
    this.gp = new GrandPrix(cupId, cup.tracks, this.cc, racers);
    this.startRace(this.gp.trackId);
  }

  private showResults(): void {
    const s = this.session!;
    const order = s.resultOrder();
    const gp = this.gp;
    if (gp) gp.recordRace(order);
    const rows = order
      .map((id, i) => {
        const k = s.kart(id);
        const c = getCharacter(k.characterId);
        const time = k.finished ? formatTime(k.finishTick - s.state.goTick) : '--:--.--';
        const gained = gp ? gp.lastRace.find((r) => r.id === id)?.gained ?? 0 : null;
        return `<tr class="${id === PLAYER_ID ? 'me' : ''}"><td>${i + 1}${ordinalSuffix(i + 1)}</td><td><span class="dot" style="background:${hexColor(c.color)}"></span>${c.name}${id === PLAYER_ID ? ' (you)' : ''}</td><td>${time}</td>${gained !== null ? `<td>+${gained}</td>` : ''}</tr>`;
      })
      .join('');
    const me = s.kart(PLAYER_ID);
    let subtitle = `${getTrackDef(this.trackId).name} · you finished ${order.indexOf(PLAYER_ID) + 1}${ordinalSuffix(order.indexOf(PLAYER_ID) + 1)}`;
    if (this.mode === 'tt' && this.lastTT) {
      const tt = this.lastTT;
      subtitle = `Total ${formatTime(tt.total)}${tt.newRecord ? ' <b class="new">NEW RECORD!</b>' : ''} · best lap ${formatTime(tt.best)}${tt.newLap ? ' <b class="new">NEW BEST LAP!</b>' : ''}`;
    }
    const laps = me.lapTimes.map((t, i) => `L${i + 1} ${formatTime(t)}`).join(' · ');
    const items: Screen['items'] = [];
    if (gp) {
      items.push({ label: gp.done ? 'Final Standings' : 'Standings', id: 'standings', action: () => this.showStandings() });
    } else {
      items.push({ label: 'Retry', id: 'retry', action: () => this.startRace(this.trackId) });
      items.push({ label: 'Choose Track', id: 'tracks', action: () => (this.clearRaceKeepMenu(), this.showTracks()) });
      items.push({ label: 'Main Menu', id: 'menu', action: () => this.quitToMenu() });
    }
    this.menu.show({
      id: 'results',
      title: this.mode === 'tt' ? 'Time Trial' : 'Results',
      subtitle,
      className: 'overlay',
      horizontal: true,
      items,
      extra: (root) => {
        root.innerHTML = this.mode === 'tt' ? `<p class="laps">${laps}</p>` : `<table class="results">${rows}</table><p class="laps">${laps}</p>`;
      },
    });
  }

  private clearRaceKeepMenu(): void {
    this.audio.stopMusic();
    this.audio.startMusic(MENU_MUSIC);
    this.startAttract();
  }

  private showStandings(): void {
    const gp = this.gp!;
    const rows = gp
      .standings()
      .map((r, i) => {
        const c = getCharacter(r.characterId);
        return `<tr class="${r.local ? 'me' : ''}"><td>${i + 1}${ordinalSuffix(i + 1)}</td><td><span class="dot" style="background:${hexColor(c.color)}"></span>${c.name}</td><td>${r.points} pts</td></tr>`;
      })
      .join('');
    const items: Screen['items'] = gp.done
      ? [{ label: 'Podium', id: 'podium', action: () => this.showPodium() }]
      : [
          { label: `Next: ${getTrackDef(gp.trackId).name}`, id: 'next', action: () => this.startRace(gp.trackId) },
          { label: 'Quit Grand Prix', id: 'quit', action: () => this.quitToMenu() },
        ];
    this.menu.show({
      id: 'standings',
      horizontal: true,
      title: `${CUPS.find((c) => c.id === gp.cupId)!.name} — after race ${gp.raceIndex}/${gp.trackIds.length}`,
      className: 'overlay',
      items,
      extra: (root) => {
        root.innerHTML = `<table class="results">${rows}</table>`;
      },
    });
  }

  private showPodium(): void {
    const gp = this.gp!;
    const st = gp.standings();
    if (!this.preview) this.preview = new Preview();
    const preview = this.preview;
    const myPlace = st.findIndex((r) => r.local) + 1;
    this.audio.stopMusic();
    this.menu.show({
      id: 'podium',
      horizontal: true,
      title: myPlace === 1 ? 'Champion!' : `You placed ${myPlace}${ordinalSuffix(myPlace)}`,
      subtitle: `${CUPS.find((c) => c.id === gp.cupId)!.name} · ${gp.cc}cc · ${st[0].points} pts for the winner`,
      className: 'overlay podium',
      items: [
        {
          label: 'Race this cup again',
          id: 'again',
          action: () => {
            const cup = gp.cupId;
            this.startGrandPrix(cup);
          },
        },
        { label: 'Main Menu', id: 'menu', action: () => this.quitToMenu() },
      ],
      extra: (root) => {
        root.appendChild(preview.canvas);
        preview.show(st.slice(0, 3).map((r) => r.characterId), 'podium');
        preview.start();
        return () => preview.stop();
      },
    });
  }

  private showSettings(): void {
    const s = this.settings;
    const change = () => {
      this.applySettings();
      saveSettings(s);
    };
    this.menu.show({
      id: 'settings',
      title: 'Settings',
      items: [
        { label: 'Master volume', kind: 'slider', value: s.master, min: 0, max: 1, step: 0.1, onChange: (v) => ((s.master = v), change()) },
        { label: 'Music volume', kind: 'slider', value: s.music, min: 0, max: 1, step: 0.1, onChange: (v) => ((s.music = v), change()) },
        { label: 'Effects volume', kind: 'slider', value: s.sfx, min: 0, max: 1, step: 0.1, onChange: (v) => ((s.sfx = v), change()) },
        { label: 'Show FPS', kind: 'toggle', value: s.showFps ? 1 : 0, onChange: (v) => ((s.showFps = !!v), change()) },
        { label: 'Back', id: 'back', action: () => this.showMain() },
      ],
      layout: 'side',
      extra: (root) => {
        root.innerHTML = `<div class="controls"><h2>Controls</h2>
          <table>
            <tr><th></th><th>Keyboard</th><th>Gamepad</th></tr>
            <tr><td>Steer</td><td>← → / A D</td><td>Left stick / D-pad</td></tr>
            <tr><td>Accelerate</td><td>↑ / W</td><td>A</td></tr>
            <tr><td>Brake / reverse</td><td>↓ / S</td><td>B</td></tr>
            <tr><td>Drift / hop / trick</td><td>Space</td><td>R1 / R2</td></tr>
            <tr><td>Use item (hold to trail)</td><td>Shift / E</td><td>L1 / L2</td></tr>
            <tr><td>Look back / throw back</td><td>Q</td><td>X</td></tr>
            <tr><td>Pause</td><td>Esc / P</td><td>Start</td></tr>
          </table>
          <p>Hold drift while steering to build sparks: blue → orange → purple. Let go for a boost.<br>Press accelerate just as the "1" disappears for a rocket start.<br>Tap drift as you leave a ramp to do a trick.</p></div>`;
      },
      onBack: () => this.showMain(),
    });
  }

  private applySettings(): void {
    this.audio.setVolumes(this.settings.master, this.settings.music, this.settings.sfx);
    this.fpsEl.style.display = this.settings.showFps ? 'block' : 'none';
  }

  /** Read-only status for automated tests. */
  status(): Record<string, unknown> {
    const s = this.session;
    const me = s && !this.attract ? s.kart(PLAYER_ID) : null;
    return {
      screen: this.menu.current?.id ?? null,
      racing: !!s && !this.attract,
      track: s?.track.def.id ?? null,
      phase: s?.state.phase ?? null,
      tick: s?.state.tick ?? 0,
      viewports: this.renderer.viewports.length,
      draws: this.renderer.info.render.calls,
      player: me ? { lap: me.lap, s: me.s, place: me.place, speed: Math.hypot(me.vx, me.vz), finished: me.finished, fallTicks: me.fallTicks } : null,
    };
  }
}
