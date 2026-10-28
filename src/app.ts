// Top-level game flow: menus, the party lobby, starting races, results,
// Grand Prix and settings.

import { AudioEngine, MENU_MUSIC } from './audio/audio';
import { FixedLoop } from './game/loop';
import { GrandPrix, type Racer } from './game/grandPrix';
import { loadGhost, loadRecord, saveGhost, saveRecord } from './game/ghost';
import { controlsFor, deviceLabel, inputOptionsFor, isPad, padIndex, PLAYER_COLORS, type DeviceId, type PartyMember } from './game/party';
import { RaceSession, type GameMode, type PlayerSlot } from './game/session';
import { loadSettings, saveSettings, type Settings } from './game/settings';
import { load, save } from './game/storage';
import { AIInput } from './input/ai';
import { DeviceInput } from './input/devices';
import { getPad } from './input/gamepad';
import { installKeyboard } from './input/keyboard';
import { LocalInput } from './input/local';
import { MenuInput, type MenuAction } from './input/menuInput';
import { TouchControls, TouchInput, touchDevice } from './input/touch';
import type { InputSource } from './input/types';
import { NetClient, type NetStatus } from './net/client';
import { NetRace } from './net/netRace';
import { CODE_LENGTH, MAX_PLAYERS as MAX_ROOM_PLAYERS, normalizeCode, type RaceStart, type RoomPlayer, type ServerMessage } from './net/protocol';
import { GameRenderer } from './render/renderer';
import { CHARACTERS, getCharacter } from './sim/characters';
import { SPEED_CLASS, TICK_RATE } from './sim/config';
import { SeededRandom } from './sim/rng';
import { CUPS, getTrack, getTrackDef, TRACKS } from './sim/tracks';
import type { PlayerId, SpeedClass } from './sim/types';
import { Hud, Minimap } from './ui/hud';
import { formatTime, ordinalSuffix } from './ui/icons';
import { Lobby } from './ui/lobby';
import { Menu, type Screen } from './ui/menu';
import { Preview } from './ui/preview';

const params = new URLSearchParams(location.search);
const DEBUG_VIEWPORTS = Math.max(1, Math.min(2, Number(params.get('viewports') ?? 1) || 1));
/** Dev/demo flag: a CPU drives your kart. */
const AUTOPILOT = params.has('autopilot');

function hexColor(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function escapeHtml(t: string): string {
  return t.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function statBars(c: { speed: number; accel: number; handling: number; weight: number }): string {
  const row = (label: string, v: number) => `<div class="stat"><span>${label}</span><div class="bar"><div style="width:${v * 20}%"></div></div></div>`;
  return row('Speed', c.speed) + row('Accel', c.accel) + row('Handling', c.handling) + row('Weight', c.weight);
}

/** A human in the current race. Ids 0..n-1 are humans, CPUs come after. */
interface Human {
  id: PlayerId;
  characterId: string;
  device: DeviceId | null;
  label: string;
  color: string;
}

export class App {
  readonly renderer: GameRenderer;
  readonly audio = new AudioEngine();
  readonly menuInput: MenuInput;
  readonly devices: DeviceInput;
  readonly menu: Menu;
  private readonly hudLayer: HTMLDivElement;
  private readonly uiLayer: HTMLDivElement;
  private readonly fpsEl: HTMLDivElement;
  private readonly loop: FixedLoop;
  private settings: Settings;
  private preview: Preview | null = null;
  private lobby: Lobby | null = null;

  private mode: GameMode = 'single';
  private cc: SpeedClass = 100;
  private characterId = 'rosa';
  private trackId = TRACKS[0].id;
  private gp: GrandPrix | null = null;
  /** Local multiplayer party, or null for solo play. */
  private party: PartyMember[] | null = null;
  private lastParty: PartyMember[] = [];
  private cpus = true;

  session: RaceSession | null = null;
  private humans: Human[] = [];
  private attract = false;
  private huds: Hud[] = [];
  private paused = false;
  private resultsAt = 0;
  private resultsShown = false;
  private fpsFrames = 0;
  private fpsTime = 0;
  private lastTT: { total: number; best: number; newRecord: boolean; newLap: boolean } | null = null;

  readonly touch: TouchControls;
  private touchMode = touchDevice();
  readonly net: NetClient;
  /** The online race on screen, if any (the server runs it). */
  private netRace: NetRace | null = null;
  /** In the online menus/room (pickers send choices to the room instead of starting races). */
  private online = false;
  private onlineMessage = '';
  /** Which of this device's online players the racer picker is for. */
  private pickFor: PlayerId = -1;
  private readonly banner: HTMLDivElement;
  private bannerTimer = 0;

  constructor(private readonly container: HTMLElement) {
    const canvas = document.createElement('canvas');
    canvas.id = 'game';
    container.appendChild(canvas);
    this.renderer = new GameRenderer(canvas);
    this.hudLayer = document.createElement('div');
    this.hudLayer.className = 'hud-layer';
    container.appendChild(this.hudLayer);
    this.touch = new TouchControls(container, () => {
      if (!this.menu.visible) this.pause();
    });
    this.uiLayer = document.createElement('div');
    this.uiLayer.className = 'ui-layer';
    container.appendChild(this.uiLayer);
    this.banner = document.createElement('div');
    this.banner.className = 'net-banner';
    container.appendChild(this.banner);
    container.classList.toggle('touch', this.touchMode);
    this.touch.active = this.touchMode;
    this.net = new NetClient(
      (m) => this.onNet(m),
      (st) => this.onNetStatus(st),
    );
    this.fpsEl = document.createElement('div');
    this.fpsEl.className = 'fps';
    container.appendChild(this.fpsEl);
    this.menu = new Menu(this.uiLayer, {
      move: () => this.audio.menuMove(),
      confirm: () => this.audio.menuConfirm(),
      back: () => this.audio.menuBack(),
    });
    installKeyboard();
    this.menuInput = new MenuInput();
    this.menuInput.on((a, source) => this.onMenuAction(a, source));
    this.devices = new DeviceInput();
    this.devices.on((d, a) => this.lobby?.handle(d, a));
    window.addEventListener('pointerdown', (e) => {
      this.audio.unlock();
      if (e.pointerType === 'touch') this.enterTouchMode();
    });
    window.addEventListener('keydown', () => this.audio.unlock());
    window.addEventListener('resize', () => {
      this.renderer.resize();
      for (const h of this.huds) h.rescale();
    });
    this.settings = loadSettings();
    this.applySettings();
    this.loop = new FixedLoop(
      () => (this.netRace ? this.netTick() : this.session?.tick()),
      (alpha, dt) => this.frame(alpha, dt),
    );
  }

  start(): void {
    this.startAttract();
    this.loop.start();
    if (this.net.resume()) {
      this.online = true;
      this.showBanner('Rejoining your room…');
      return;
    }
    this.showTitle();
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private frame(alpha: number, dt: number): void {
    const now = performance.now();
    if (this.lobby) this.devices.poll(now);
    else this.menuInput.pollGamepad(now);
    const s = this.session;
    if (this.netRace) {
      this.netRace.frame(dt);
      this.loop.rate = this.netRace.rate;
    }
    // Touch controls while racing; once you finish a CPU drives you home, so they go away.
    this.touch.show(this.touchMode && this.humans.length === 1 && !!s && !this.attract && !this.resultsShown && !this.menu.visible && this.humans.some((h) => !s.kart(h.id).finished));
    if (s) {
      const events = s.drainEvents();
      this.renderer.onEvents(events);
      if (!this.attract) {
        for (const h of this.huds) h.onEvents(events, s.state);
        const listeners = new Set(this.humans.map((h) => h.id));
        this.audio.onEvents(events, listeners, (id) => {
          const k = s.kart(id);
          let best = Infinity;
          for (const h of this.humans) {
            const me = s.kart(h.id);
            best = Math.min(best, Math.hypot(k.x - me.x, k.z - me.z));
          }
          return Math.max(0, 1 - best / 60);
        });
        for (const h of this.humans) {
          this.audio.updateEngine(h.id, s.kart(h.id), s.lastInput.get(h.id)?.throttle ?? 0, !this.paused);
        }
      }
      this.renderer.render(alpha, dt);
      if (!this.attract) {
        this.renderer.viewports.forEach((vp, i) => {
          const g = s.ghost?.active ? s.ghost.state!.karts[0] : null;
          this.huds[i]?.update(s.state, s.kart(vp.follow), g, s.ghost ? s.ghost.data.lapTicks : null);
        });
        this.checkControllers();
        if (!this.netRace) this.checkRaceEnd();
      } else if (s.state.phase === 'finished' || s.state.tick > 60 * TICK_RATE * 3) {
        this.startAttract();
      }
    }
    if (this.settings.showFps) {
      this.fpsFrames++;
      this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        const info = this.renderer.info.render;
        this.fpsEl.textContent = `${Math.round(this.fpsFrames / this.fpsTime)} fps · ${info.calls} draws/view`;
        this.fpsFrames = 0;
        this.fpsTime = 0;
      }
    }
  }

  private onMenuAction(a: MenuAction, source: 'key' | 'pad'): void {
    if (this.lobby) return;
    if (this.menu.visible) {
      this.menu.handle(a);
      return;
    }
    // On a gamepad B is the brake, so only Start pauses; on a keyboard Esc does.
    const wantsPause = a === 'pause' || (a === 'back' && source === 'key');
    if (!this.attract && this.session && wantsPause && !this.resultsShown) this.pause();
  }

  /** Pauses the race if a player's gamepad drops out. */
  private checkControllers(): void {
    if (this.paused || this.resultsShown || !this.session || this.session.state.phase === 'finished') return;
    for (const h of this.humans) {
      if (!h.device || !isPad(h.device)) continue;
      const p = getPad(padIndex(h.device));
      if (!p || !p.connected) {
        this.pause(`${h.label}'s gamepad disconnected. Reconnect it, then resume.`);
        return;
      }
    }
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
    this.netRace = null;
    this.loop.rate = 1;
    this.loop.maxSteps = 6;
    this.humans = [];
    this.paused = false;
    this.resultsShown = false;
    this.resultsAt = 0;
    this.container.classList.remove('racing');
  }

  /** Humans for the next race: the party, or the solo player. */
  private makeHumans(): Human[] {
    if (this.party) {
      return this.party.map((m, i) => ({ id: i, characterId: m.characterId, device: m.device, label: `P${i + 1}`, color: PLAYER_COLORS[i] }));
    }
    return [{ id: 0, characterId: this.characterId, device: null, label: 'You', color: PLAYER_COLORS[0] }];
  }

  private humanInput(h: Human): InputSource {
    if (AUTOPILOT) return new AIInput(0.95, `autopilot-${h.id}`);
    return h.device ? new LocalInput(inputOptionsFor(h.device, this.party ?? [])) : new TouchInput(this.touch);
  }

  private buildSlots(humans: Human[], rng: SeededRandom): PlayerSlot[] {
    const people: PlayerSlot[] = humans.map((h, i) => ({ id: h.id, kind: 'local', characterId: h.characterId, input: this.humanInput(h), localIndex: i }));
    if (this.mode === 'tt') return people.slice(0, 1);
    const base = SPEED_CLASS[this.cc].cpuSkill;
    const makeCpu = (id: PlayerId, characterId: string, rank: number): PlayerSlot => ({
      id,
      kind: 'cpu',
      characterId,
      input: new AIInput(Math.min(1, Math.max(0.3, base - 0.12 + rank * 0.04)), `cpu-${id}-${rng.int(0, 1e9)}`),
      localIndex: -1,
    });
    if (this.gp) {
      return this.gp.gridOrder().map((r, i) => (r.local ? people.find((p) => p.id === r.id)! : makeCpu(r.id, r.characterId, i % 7)));
    }
    const cpuChars = this.cpuCharacters(humans, rng);
    const cpus = cpuChars.map((c, i) => makeCpu(humans.length + i, c, i));
    return [...cpus, ...people];
  }

  /** Characters for CPUs: everyone the humans didn't pick (none if CPUs are off). */
  private cpuCharacters(humans: Human[], rng: SeededRandom): string[] {
    if (this.party && !this.cpus) return [];
    const taken = new Set(humans.map((h) => h.characterId));
    const others = CHARACTERS.filter((c) => !taken.has(c.id)).map((c) => c.id);
    for (let i = others.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [others[i], others[j]] = [others[j], others[i]];
    }
    return others.slice(0, 8 - humans.length);
  }

  startRace(trackId: string): void {
    this.menu.close();
    this.closeLobby();
    this.preview?.stop();
    this.clearRace();
    this.attract = false;
    this.trackId = trackId;
    const rng = new SeededRandom(Date.now());
    this.humans = this.makeHumans();
    const slots = this.buildSlots(this.humans, rng);
    const ghost = this.mode === 'tt' ? loadGhost(trackId) : null;
    this.session = new RaceSession({ trackId, speedClass: this.mode === 'tt' ? 150 : this.cc, mode: this.mode, slots, seed: rng.int(0, 1e9), ghost });
    const follow: PlayerId[] = this.humans.map((h) => h.id);
    if (!this.party && DEBUG_VIEWPORTS > 1) {
      for (const sl of slots) if (sl.kind === 'cpu' && follow.length < DEBUG_VIEWPORTS) follow.push(sl.id);
    }
    const sideBySide = this.settings.splitSideBySide;
    this.renderer.load(this.session, follow, sideBySide);
    const colors = new Map(this.party ? this.humans.map((h) => [h.id, h.color] as const) : []);
    this.huds = this.renderer.viewports.map((vp) => {
      const human = this.party ? this.humans.find((h) => h.id === vp.follow) : undefined;
      const h = new Hud(this.hudLayer, this.session!.track, vp.follow, this.session!.state.config.laps, {
        tag: human ? { label: human.label, color: human.color, name: getCharacter(human.characterId).name } : null,
        humans: colors,
      });
      h.setRect(vp.rect);
      return h;
    });
    this.audio.unlock();
    this.audio.startMusic(getTrackDef(trackId).music);
    this.audio.startEngines(this.humans.map((h) => h.id));
    this.container.classList.add('racing');
    this.loop.ticking = true;
    this.lastTT = null;
  }

  private checkRaceEnd(): void {
    const s = this.session;
    if (!s || this.resultsShown) return;
    const allDone = this.humans.every((h) => s.kart(h.id).finished);
    if (!allDone && s.state.phase !== 'finished') return;
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
    const me = s.kart(this.humans[0].id);
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

  private pause(reason?: string): void {
    if (!this.session || this.paused) return;
    if (this.netRace) {
      this.pauseOnline();
      return;
    }
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
      subtitle: reason,
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
    this.leaveOnline();
    this.gp = null;
    this.party = null;
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
      items: [{ label: this.touchMode ? 'Tap to start' : 'Press Enter / A to start', id: 'start', className: 'press-start', action: () => this.showMain() }],
      extra: (root) => {
        root.innerHTML = '<div class="logo"><span>DORM</span><span>KARTZ</span></div>';
      },
      footer: this.touchMode ? 'Tap to start · landscape works best' : 'Keyboard, gamepad or touch · <b>Esc</b> pauses',
    });
  }

  private showMain(): void {
    this.leaveOnline();
    this.gp = null;
    this.party = null;
    this.audio.unlock();
    this.audio.startMusic(MENU_MUSIC);
    this.menu.show({
      id: 'main',
      title: 'DormKartz',
      className: 'main',
      items: [
        { label: 'Grand Prix', id: 'gp', html: '<small>4 races · points · podium</small>', action: () => ((this.mode = 'gp'), this.showCC()) },
        { label: 'Single Race', id: 'single', html: '<small>any track, any class</small>', action: () => ((this.mode = 'single'), this.showCC()) },
        { label: 'Party Race', id: 'party', html: '<small>2 players, one screen: W A S D vs I J K L</small>', action: () => this.showLobby() },
        { label: 'Online', id: 'online', html: '<small>friends on their own phone or computer · room code</small>', action: () => this.showOnline() },
        { label: 'Time Trial', id: 'tt', html: '<small>race your ghost</small>', action: () => ((this.mode = 'tt'), this.showCharacters()) },
        { label: 'Settings', id: 'settings', action: () => this.showSettings() },
      ],
      onBack: () => this.showTitle(),
      footer: '↑↓ choose · Enter/A select · Esc/B back',
    });
  }

  // --- Party -------------------------------------------------------------------

  private showLobby(): void {
    this.menu.close();
    this.closeLobby();
    if (!this.preview) this.preview = new Preview();
    this.devices.activate();
    this.lobby = new Lobby(
      this.uiLayer,
      { move: () => this.audio.menuMove(), confirm: () => this.audio.menuConfirm(), back: () => this.audio.menuBack(), deny: () => this.audio.menuDeny() },
      this.preview,
      (members) => {
        this.party = members;
        this.lastParty = members;
        this.closeLobby();
        this.showPartySetup();
      },
      () => {
        this.closeLobby();
        this.showMain();
      },
      // Re-seat last time's players, except gamepads that are no longer plugged in.
      this.lastParty.filter((m) => !isPad(m.device) || !!getPad(padIndex(m.device))?.connected),
    );
  }

  private closeLobby(): void {
    if (!this.lobby) return;
    this.lobby.destroy();
    this.lobby = null;
    this.devices.deactivate();
    this.menuInput.swallowHeld();
  }

  private showPartySetup(): void {
    const party = this.party!;
    const names = party.map((m, i) => `<b style="color:${PLAYER_COLORS[i]}">P${i + 1}</b> ${getCharacter(m.characterId).name}`).join(' · ');
    this.menu.show({
      id: 'party-setup',
      title: `${party.length}-player race`,
      subtitle: names,
      items: [
        { label: 'VS Race', id: 'vs', html: '<small>one race, any track</small>', action: () => ((this.mode = 'single'), this.showCC()) },
        { label: 'Grand Prix', id: 'gp', html: '<small>4 races, points for everyone</small>', action: () => ((this.mode = 'gp'), this.showCC()) },
        { label: 'CPU racers', kind: 'toggle', value: this.cpus ? 1 : 0, onChange: (v) => (this.cpus = !!v) },
        { label: 'Change racers', id: 'lobby', action: () => this.showLobby() },
      ],
      onBack: () => this.showLobby(),
      footer: 'Anyone can drive these menus. Esc / B goes back.',
    });
  }

  // --- Solo / shared flow ---------------------------------------------------------

  private showCC(): void {
    const order: SpeedClass[] = [50, 100, 150];
    this.menu.show({
      id: 'cc',
      title: this.party ? (this.mode === 'gp' ? 'Party Grand Prix' : 'VS Race') : this.mode === 'gp' ? 'Grand Prix' : 'Single Race',
      subtitle: 'Choose a speed class',
      items: order.map((cc) => ({
        label: `${cc}cc`,
        id: `cc-${cc}`,
        html: `<small>${cc === 50 ? 'relaxed' : cc === 100 ? 'standard' : 'fast and fierce'}</small>`,
        action: () => {
          this.cc = cc;
          if (!this.party) this.showCharacters();
          else if (this.mode === 'gp') this.showCups();
          else this.showTracks();
        },
      })),
      initial: order.indexOf(this.cc),
      onBack: () => (this.party ? this.showPartySetup() : this.showMain()),
    });
  }

  private showCharacters(): void {
    if (!this.preview) this.preview = new Preview();
    // Online, each racer can only be picked by one player in the room.
    const room = this.online ? this.net.room : null;
    const picker = this.net.mine.includes(this.pickFor) ? this.pickFor : this.net.mine[0];
    if (room) this.characterId = room.players.find((p) => p.id === picker)?.characterId ?? this.characterId;
    const taken = new Set(room ? room.players.filter((p) => p.id !== picker).map((p) => p.characterId) : []);
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
        disabled: taken.has(c.id),
        action: () => {
          this.characterId = c.id;
          if (this.online) {
            this.net.send({ type: 'pick', characterId: c.id, id: picker });
            this.showRoom();
            return;
          }
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
      onBack: () => (this.online ? this.showRoom() : this.mode === 'tt' ? this.showMain() : this.showCC()),
    });
  }

  private showCups(): void {
    this.menu.show({
      id: 'cup',
      title: 'Choose a cup',
      subtitle: `${this.cc}cc · ${this.party ? `${this.party.length} players` : getCharacter(this.characterId).name}`,
      items: CUPS.map((cup) => ({
        label: cup.name,
        id: `cup-${cup.id}`,
        className: 'cup',
        html: `<small>${cup.tracks.map((t) => getTrackDef(t).name).join(' · ')}</small>`,
        action: () => this.startGrandPrix(cup.id),
      })),
      onBack: () => (this.party ? this.showCC() : this.showCharacters()),
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
      subtitle: this.mode === 'tt' ? 'Start with a Triple Zoom. Your best lap becomes a ghost.' : `${this.cc}cc${this.party ? ` · ${this.party.length} players` : ''}`,
      layout: 'side',
      columns: 2,
      items: TRACKS.map((t) => ({
        label: t.name,
        id: `track-${t.id}`,
        className: `track-card cup-${t.cup}`,
        action: () => {
          if (!this.online) return this.startRace(t.id);
          this.trackId = t.id;
          this.net.send({ type: 'settings', settings: { trackId: t.id } });
          this.showRoom();
        },
      })),
      initial: Math.max(0, TRACKS.findIndex((t) => t.id === (this.online ? this.net.room?.settings.trackId : this.trackId))),
      onFocus: update,
      extra: (root) => {
        detail = document.createElement('div');
        detail.className = 'track-detail';
        root.appendChild(detail);
        update(Math.max(0, TRACKS.findIndex((t) => t.id === (this.online ? this.net.room?.settings.trackId : this.trackId))));
      },
      onBack: () => (this.online ? this.showRoom() : this.party ? this.showCC() : this.showCharacters()),
    });
  }

  private startGrandPrix(cupId: string): void {
    const cup = CUPS.find((c) => c.id === cupId)!;
    const humans = this.makeHumans();
    const rng = new SeededRandom(Date.now());
    const cpuChars = this.cpuCharacters(humans, rng);
    const racers: Racer[] = [
      ...humans.map((h) => ({ id: h.id, characterId: h.characterId, local: true })),
      ...cpuChars.map((c, i) => ({ id: humans.length + i, characterId: c, local: false })),
    ];
    this.gp = new GrandPrix(cupId, cup.tracks, this.cc, racers);
    this.startRace(this.gp.trackId);
  }

  /** "P1 " tag (party) or " (you)" marker (solo) for a result row. */
  private humanTag(id: PlayerId): { before: string; after: string } {
    const h = this.humans.find((x) => x.id === id);
    if (!h) return { before: '', after: '' };
    if (!this.party) return { before: '', after: ' (you)' };
    return { before: `<b class="ptag" style="background:${h.color}">${h.label}</b>`, after: '' };
  }

  private showResults(): void {
    const s = this.session!;
    const order = s.resultOrder();
    const gp = this.gp;
    if (gp) gp.recordRace(order);
    const isHuman = (id: PlayerId) => this.humans.some((h) => h.id === id);
    const rows = order
      .map((id, i) => {
        const k = s.kart(id);
        const c = getCharacter(k.characterId);
        const time = k.finished ? formatTime(k.finishTick - s.state.goTick) : '--:--.--';
        const gained = gp ? gp.lastRace.find((r) => r.id === id)?.gained ?? 0 : null;
        const tag = this.humanTag(id);
        return `<tr class="${isHuman(id) ? 'me' : ''}"><td>${i + 1}${ordinalSuffix(i + 1)}</td><td>${tag.before}<span class="dot" style="background:${hexColor(c.color)}"></span>${c.name}${tag.after}</td><td>${time}</td>${gained !== null ? `<td>+${gained}</td>` : ''}</tr>`;
      })
      .join('');
    const placeOf = (id: PlayerId) => order.indexOf(id) + 1;
    let subtitle = this.party
      ? `${getTrackDef(this.trackId).name} · ` + this.humans.map((h) => `<b style="color:${h.color}">${h.label}</b> ${placeOf(h.id)}${ordinalSuffix(placeOf(h.id))}`).join(' · ')
      : `${getTrackDef(this.trackId).name} · you finished ${placeOf(this.humans[0].id)}${ordinalSuffix(placeOf(this.humans[0].id))}`;
    if (this.mode === 'tt' && this.lastTT) {
      const tt = this.lastTT;
      subtitle = `Total ${formatTime(tt.total)}${tt.newRecord ? ' <b class="new">NEW RECORD!</b>' : ''} · best lap ${formatTime(tt.best)}${tt.newLap ? ' <b class="new">NEW BEST LAP!</b>' : ''}`;
    }
    const me = s.kart(this.humans[0].id);
    const laps = this.party ? '' : me.lapTimes.map((t, i) => `L${i + 1} ${formatTime(t)}`).join(' · ');
    const items: Screen['items'] = [];
    if (gp) {
      items.push({ label: gp.done ? 'Final Standings' : 'Standings', id: 'standings', action: () => this.showStandings() });
    } else {
      items.push({ label: 'Retry', id: 'retry', action: () => this.startRace(this.trackId) });
      items.push({ label: 'Choose Track', id: 'tracks', action: () => (this.clearRaceKeepMenu(), this.showTracks()) });
      if (this.party) items.push({ label: 'Change Racers', id: 'lobby', action: () => (this.clearRaceKeepMenu(), this.showLobby()) });
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
        root.innerHTML = this.mode === 'tt' ? `<p class="laps">${laps}</p>` : `<table class="results">${rows}</table>${laps ? `<p class="laps">${laps}</p>` : ''}`;
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
        const tag = this.humanTag(r.id);
        return `<tr class="${r.local ? 'me' : ''}"><td>${i + 1}${ordinalSuffix(i + 1)}</td><td>${tag.before}<span class="dot" style="background:${hexColor(c.color)}"></span>${c.name}${tag.after}</td><td>${r.points} pts</td></tr>`;
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
    const best = st.findIndex((r) => r.local) + 1;
    const winner = st[0];
    let title = best === 1 ? 'Champion!' : `You placed ${best}${ordinalSuffix(best)}`;
    if (this.party) {
      const h = this.humans.find((x) => x.id === winner.id);
      title = h ? `${h.label} wins the cup!` : `${getCharacter(winner.characterId).name} wins the cup`;
    }
    this.audio.stopMusic();
    this.menu.show({
      id: 'podium',
      horizontal: true,
      title,
      subtitle: `${CUPS.find((c) => c.id === gp.cupId)!.name} · ${gp.cc}cc · ${winner.points} pts for the winner`,
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

  // --- Touch ----------------------------------------------------------------------

  private enterTouchMode(): void {
    if (this.touchMode) return;
    this.touchMode = true;
    this.touch.active = true;
    this.container.classList.add('touch');
    // Phones: go fullscreen in landscape on the first tap (both can fail; that's fine).
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => {});
    }
  }

  // --- Online ---------------------------------------------------------------------

  private showBanner(text: string, ms = 0): void {
    clearTimeout(this.bannerTimer);
    this.banner.textContent = text;
    this.banner.classList.toggle('show', !!text);
    if (ms) this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('show'), ms);
  }

  private leaveOnline(): void {
    this.online = false;
    if (this.net.status !== 'idle') this.net.leave();
    this.showBanner('');
  }

  private netTick(): void {
    const sent = this.netRace!.tick(this.paused);
    if (sent) this.net.send({ type: 'input', s: sent.s, i: sent.i });
  }

  private onNetStatus(st: NetStatus): void {
    if (st === 'reconnecting' && this.net.inRoom) this.showBanner('Connection lost · reconnecting…');
    else if (st === 'open') this.showBanner('');
  }

  private onNet(m: ServerMessage): void {
    switch (m.type) {
      case 'joined':
        this.onlineMessage = '';
        if (!this.netRace) this.showRoom();
        break;
      case 'room':
        if (this.menu.current?.id === 'room') this.showRoom();
        break;
      case 'start':
        this.startOnlineRace(m.race);
        break;
      case 'snap':
        this.netRace?.onSnapshot(m.s);
        break;
      case 'end':
        if (this.netRace && !this.resultsShown) {
          this.netRace.order = m.order;
          this.showOnlineResults();
        }
        break;
      case 'error':
        if (!this.online) break;
        if (this.net.inRoom) {
          this.showBanner(m.message, 3000);
        } else {
          // Couldn't connect, or lost the room for good.
          this.onlineMessage = m.message;
          if (this.netRace) {
            this.audio.stopMusic();
            this.audio.startMusic(MENU_MUSIC);
            this.startAttract();
          }
          this.showBanner('');
          this.showOnline();
        }
        break;
    }
  }

  private showOnline(): void {
    this.online = true;
    this.mode = 'single';
    this.party = null;
    this.gp = null;
    let nameEl: HTMLInputElement | null = null;
    let codeEl: HTMLInputElement | null = null;
    let msgEl: HTMLParagraphElement | null = null;
    const say = (t: string) => {
      this.onlineMessage = t;
      if (msgEl) msgEl.textContent = t;
    };
    const name = () => {
      const n = nameEl?.value.trim() ?? '';
      save('online.name', n);
      return n || getCharacter(this.characterId).name;
    };
    const join = () => {
      const code = normalizeCode(codeEl?.value ?? '');
      if (code.length !== CODE_LENGTH) {
        say(`Type the ${CODE_LENGTH}-letter room code first.`);
        codeEl?.focus();
        return;
      }
      say(`Joining ${code}…`);
      this.net.join(code, name());
    };
    this.menu.show({
      id: 'online',
      title: 'Online',
      subtitle: 'Race friends on their own phone or computer. One person creates a room and shares the code.',
      items: [
        {
          label: 'Create room',
          id: 'create',
          html: '<small>get a code to share</small>',
          action: () => {
            say('Creating a room…');
            this.net.create(name());
          },
        },
        { label: 'Join room', id: 'join', html: '<small>with the code from your friend</small>', action: join },
        { label: 'Back', id: 'back', action: () => this.showMain() },
      ],
      extra: (root) => {
        root.innerHTML = `<div class="net-form">
          <label>Your name<input class="net-name" maxlength="14" autocomplete="nickname" enterkeyhint="done"></label>
          <label>Room code<input class="net-code" maxlength="${CODE_LENGTH}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" enterkeyhint="go"></label>
        </div><p class="net-msg"></p>`;
        nameEl = root.querySelector('.net-name');
        codeEl = root.querySelector('.net-code');
        msgEl = root.querySelector('.net-msg');
        nameEl!.value = load('online.name', '');
        msgEl!.textContent = this.onlineMessage;
        codeEl!.addEventListener('input', () => (codeEl!.value = normalizeCode(codeEl!.value)));
        codeEl!.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') join();
        });
        nameEl!.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') nameEl!.blur();
        });
      },
      onBack: () => this.showMain(),
      footer: `Server: ${location.host}`,
    });
  }

  /** This device's players in the room, P1 first. */
  private localPlayers(): RoomPlayer[] {
    const room = this.net.room;
    return room ? this.net.mine.map((id) => room.players.find((p) => p.id === id)).filter((p): p is RoomPlayer => !!p) : [];
  }

  private showRoom(): void {
    const room = this.net.room;
    if (!room || !this.net.inRoom) return this.showOnline();
    this.online = true;
    const locals = this.localPlayers();
    const two = locals.length > 1;
    const host = this.net.isHost;
    const st = room.settings;
    const focus = this.menu.current?.id === 'room' ? this.menu.focusIndex : 0;
    const items: Screen['items'] = locals.map((p, n) => ({
      label: `${two ? `P${n + 1} ${p.name}` : 'Racer'}: ${getCharacter(p.characterId).name}`,
      id: `pick-${n}`,
      action: () => {
        this.pickFor = p.id;
        this.showCharacters();
      },
    }));
    if (two) items.push({ label: `Remove P2 (${locals[1].name})`, id: 'drop', action: () => this.net.dropLocal(locals[1].id) });
    else if (!this.touchMode) items.push({ label: 'Add a 2nd player here', id: 'add', html: '<small>split screen: W A S D vs I J K L</small>', disabled: room.players.length >= MAX_ROOM_PLAYERS, action: () => this.showAddPlayer() });
    if (host) {
      const ccs: SpeedClass[] = [50, 100, 150];
      items.push(
        { label: `Track: ${getTrackDef(st.trackId).name}`, id: 'track', action: () => this.showTracks() },
        { label: `Speed: ${st.cc}cc`, id: 'cc', action: () => this.net.send({ type: 'settings', settings: { cc: ccs[(ccs.indexOf(st.cc) + 1) % 3] } }) },
        { label: 'CPU racers', kind: 'toggle', value: st.cpus ? 1 : 0, onChange: (v) => this.net.send({ type: 'settings', settings: { cpus: !!v } }) },
        { label: room.racing ? 'Race in progress…' : 'Start race', id: 'start', className: 'start', disabled: room.racing, action: () => this.net.send({ type: 'start' }) },
      );
    } else {
      items.push({ label: room.racing ? 'Race in progress · you’re in the next one' : 'Waiting for the host to start', id: 'wait', disabled: true });
    }
    items.push({ label: 'Leave room', id: 'leave', action: () => this.quitToMenu() });
    const hostName = room.players.find((p) => p.id === room.hostId)?.name ?? '';
    const rows = room.players
      .map((p) => {
        const c = getCharacter(p.characterId);
        const n = this.net.mine.indexOf(p.id);
        const tags = [p.id === room.hostId ? 'host' : '', n < 0 ? '' : two ? `P${n + 1} here` : 'you', p.connected ? '' : 'reconnecting…'].filter(Boolean).join(' · ');
        return `<li class="${p.connected ? '' : 'away'}"><span class="dot" style="background:${hexColor(c.color)}"></span><b>${escapeHtml(p.name)}</b> ${c.name}${tags ? ` <small>${tags}</small>` : ''}</li>`;
      })
      .join('');
    const keys = two
      ? `<p class="room-keys"><b style="color:${PLAYER_COLORS[0]}">P1</b> W A S D · Space drift · E item &nbsp; <b style="color:${PLAYER_COLORS[1]}">P2</b> I J K L · ; drift · U item</p>`
      : '';
    this.menu.show({
      id: 'room',
      title: 'Room',
      layout: 'side',
      items,
      initial: focus,
      extra: (root) => {
        root.innerHTML = `<div class="room-code"><small>Room code</small><b>${room.code}</b></div>
          <p class="room-share">Friends open <b>${escapeHtml(location.host)}</b>, tap <b>Online</b>, then <b>Join room</b> with this code.</p>
          <ul class="room-players">${rows}</ul>${keys}
          ${host ? '' : `<p class="room-settings">${escapeHtml(hostName)} picks the race: <b>${getTrackDef(st.trackId).name}</b> · ${st.cc}cc · CPUs ${st.cpus ? 'on' : 'off'}</p>`}`;
      },
    });
  }

  /** A second player on this keyboard: they get their own name, racer and spot on the grid. */
  private showAddPlayer(): void {
    let nameEl: HTMLInputElement | null = null;
    const add = () => {
      const n = nameEl?.value.trim() ?? '';
      save('online.name2', n);
      this.net.addLocal(n || 'Player 2');
    };
    this.menu.show({
      id: 'online-add',
      title: 'Add player 2',
      subtitle: 'Split screen on this computer. Player 1 drives with <b>W A S D</b>, player 2 with <b>I J K L</b>.',
      items: [
        { label: 'Add player', id: 'add-confirm', action: add },
        { label: 'Back', id: 'back', action: () => this.showRoom() },
      ],
      extra: (root) => {
        root.innerHTML = `<div class="net-form one"><label>Player 2 name<input class="net-name" maxlength="14" autocomplete="off" enterkeyhint="done"></label></div>
          <table class="add-keys"><tr><td>Steer</td><td>J L</td></tr><tr><td>Accelerate / brake</td><td>I / K</td></tr><tr><td>Drift</td><td>; (or Right Shift)</td></tr><tr><td>Item / look back</td><td>U / O</td></tr></table>`;
        nameEl = root.querySelector('.net-name');
        nameEl!.value = load('online.name2', '');
        nameEl!.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') add();
        });
        setTimeout(() => nameEl?.focus(), 50);
      },
      onBack: () => this.showRoom(),
    });
  }

  private startOnlineRace(start: RaceStart): void {
    const mine = this.net.mine.filter((id) => start.humans.some((h) => h.id === id));
    if (this.netRace?.id === start.id || !mine.length) return;
    this.menu.close();
    this.closeLobby();
    this.preview?.stop();
    this.clearRace();
    this.attract = false;
    this.mode = 'single';
    // One player: the whole keyboard, touch and any gamepad. Two: each gets half the keyboard and a gamepad.
    const split: PartyMember[] = [
      { device: 'kb-left', characterId: '' },
      { device: 'kb-right', characterId: '' },
    ];
    const two = mine.length > 1;
    const inputFor = (id: PlayerId, n: number): InputSource => {
      if (AUTOPILOT) return new AIInput(0.95, `autopilot-${id}`);
      if (!two) return new TouchInput(this.touch);
      return new LocalInput({ ...inputOptionsFor(split[n].device, split), pad: n });
    };
    const nr = new NetRace(
      start,
      mine.map((id, n) => ({ id, input: inputFor(id, n) })),
    );
    this.netRace = nr;
    this.session = nr.session;
    this.trackId = start.config.trackId;
    this.cc = start.config.speedClass;
    const names = new Map(start.humans.map((h) => [h.id, h.name] as const));
    this.humans = mine.map((id, n) => ({
      id,
      characterId: start.config.karts.find((k) => k.id === id)!.characterId,
      device: two ? split[n].device : null,
      label: two ? `P${n + 1}` : 'You',
      color: PLAYER_COLORS[n],
    }));
    this.renderer.load(nr.session, mine, this.settings.splitSideBySide);
    // Everyone else who's human gets a colored ring on the minimap too.
    const others = start.humans.filter((h) => !mine.includes(h.id));
    const colors = new Map([...this.humans.map((h) => [h.id, h.color] as const), ...others.map((h, i) => [h.id, PLAYER_COLORS[(mine.length + i) % PLAYER_COLORS.length]] as const)]);
    this.huds = this.renderer.viewports.map((vp) => {
      const h = this.humans.find((x) => x.id === vp.follow)!;
      const hud = new Hud(this.hudLayer, nr.session.track, vp.follow, start.config.laps, {
        tag: two ? { label: h.label, color: h.color, name: escapeHtml(names.get(h.id) ?? '') } : null,
        humans: colors,
      });
      hud.setRect(vp.rect);
      return hud;
    });
    this.audio.unlock();
    this.audio.startMusic(getTrackDef(this.trackId).music);
    this.audio.startEngines(mine);
    this.container.classList.add('racing');
    this.loop.ticking = true;
    this.loop.maxSteps = 15;
  }

  /** Online races can't pause; this just covers the screen (your kart coasts). */
  private pauseOnline(): void {
    this.paused = true;
    const resume = () => {
      this.menu.close();
      this.paused = false;
    };
    this.menu.show({
      id: 'pause',
      title: 'Online race',
      subtitle: 'The race keeps going while this is open.',
      className: 'overlay small',
      items: [
        { label: 'Resume', id: 'resume', action: resume },
        { label: 'Leave room', id: 'quit', action: () => this.quitToMenu() },
      ],
      onBack: resume,
    });
  }

  private showOnlineResults(): void {
    const nr = this.netRace!;
    const s = nr.session;
    this.paused = false;
    this.resultsShown = true;
    const order = nr.order ?? s.resultOrder();
    const names = new Map(nr.humans.map((h) => [h.id, h.name] as const));
    const rows = order
      .map((id, i) => {
        const k = s.kart(id);
        const c = getCharacter(k.characterId);
        const time = k.finished ? formatTime(k.finishTick - s.state.goTick) : '--:--.--';
        const who = names.has(id) ? `<b class="pname">${escapeHtml(names.get(id)!)}</b> ` : '';
        const h = this.humans.length > 1 ? this.humans.find((x) => x.id === id) : undefined;
        const tag = h ? `<b class="ptag" style="background:${h.color}">${h.label}</b>` : '';
        return `<tr class="${this.humans.some((h) => h.id === id) ? 'me' : ''}"><td>${i + 1}${ordinalSuffix(i + 1)}</td><td>${tag}<span class="dot" style="background:${hexColor(c.color)}"></span>${who}${c.name}</td><td>${time}</td></tr>`;
      })
      .join('');
    const place = (id: PlayerId) => order.indexOf(id) + 1;
    const placed =
      this.humans.length > 1
        ? this.humans.map((h) => `<b style="color:${h.color}">${h.label}</b> ${place(h.id)}${ordinalSuffix(place(h.id))}`).join(' · ')
        : `you finished ${place(nr.you)}${ordinalSuffix(place(nr.you))}`;
    this.menu.show({
      id: 'results',
      title: 'Results',
      subtitle: `${getTrackDef(this.trackId).name} · ${placed}`,
      className: 'overlay',
      horizontal: true,
      items: [
        { label: 'Back to room', id: 'room', action: () => (this.clearRaceKeepMenu(), this.showRoom()) },
        { label: 'Leave room', id: 'menu', action: () => this.quitToMenu() },
      ],
      extra: (root) => {
        root.innerHTML = `<table class="results">${rows}</table>`;
      },
    });
  }

  private showSettings(): void {
    const s = this.settings;
    const change = () => {
      this.applySettings();
      saveSettings(s);
    };
    const both: PartyMember[] = [
      { device: 'kb-left', characterId: 'pip' },
      { device: 'kb-right', characterId: 'zip' },
    ];
    const table = (device: DeviceId, members: PartyMember[]) =>
      controlsFor(device, members)
        .map((r) => `<tr><td>${r.action}</td><td>${r.keys}</td></tr>`)
        .join('');
    this.menu.show({
      id: 'settings',
      title: 'Settings',
      items: [
        { label: 'Master volume', kind: 'slider', value: s.master, min: 0, max: 1, step: 0.1, onChange: (v) => ((s.master = v), change()) },
        { label: 'Music volume', kind: 'slider', value: s.music, min: 0, max: 1, step: 0.1, onChange: (v) => ((s.music = v), change()) },
        { label: 'Effects volume', kind: 'slider', value: s.sfx, min: 0, max: 1, step: 0.1, onChange: (v) => ((s.sfx = v), change()) },
        { label: '2-player split side by side', kind: 'toggle', value: s.splitSideBySide ? 1 : 0, onChange: (v) => ((s.splitSideBySide = !!v), change()) },
        { label: 'Show FPS', kind: 'toggle', value: s.showFps ? 1 : 0, onChange: (v) => ((s.showFps = !!v), change()) },
        { label: 'Back', id: 'back', action: () => this.showMain() },
      ],
      layout: 'side',
      extra: (root) => {
        root.innerHTML = `<div class="controls"><h2>Controls</h2>
          <h3>Solo (keyboard or any gamepad)</h3>
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
          <h3>Two players on one keyboard (Party Race, or Online with a second player)</h3>
          <div class="two-col"><table><tr><th colspan="2">${deviceLabel('kb-left')}</th></tr>${table('kb-left', both)}</table>
          <table><tr><th colspan="2">${deviceLabel('kb-right')}</th></tr>${table('kb-right', both)}</table></div>
          <p>Either player can use a gamepad instead (same buttons as solo). If only one person is on the keyboard, they get the full solo layout.</p>
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
    const racing = !!s && !this.attract;
    const players = racing
      ? this.humans.map((h) => {
          const k = s!.kart(h.id);
          return { id: h.id, lap: k.lap, s: k.s, heading: k.heading, place: k.place, speed: Math.hypot(k.vx, k.vz), finished: k.finished, fallTicks: k.fallTicks, characterId: k.characterId };
        })
      : [];
    return {
      screen: this.lobby ? 'lobby' : (this.menu.current?.id ?? null),
      racing,
      track: s?.track.def.id ?? null,
      phase: s?.state.phase ?? null,
      tick: s?.state.tick ?? 0,
      viewports: this.renderer.viewports.length,
      karts: s?.state.karts.length ?? 0,
      draws: this.renderer.info.render.calls,
      lobby: this.lobby ? this.lobby.seats.map((x) => ({ device: x.device, ready: x.ready, characterId: CHARACTERS[x.cursor].id })) : null,
      player: players[0] ?? null,
      players,
      online: { status: this.net.status, code: this.net.room?.code ?? null, you: this.net.mine, host: this.net.isHost, players: this.net.room?.players.length ?? 0, racing: !!this.netRace, rate: this.loop.rate, correction: this.netRace?.lastCorrection.get(this.netRace.you) ?? null, splitInputs: this.netRace?.locals.length ?? 0 },
      touch: this.touchMode,
    };
  }
}
