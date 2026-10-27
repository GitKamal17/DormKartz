// Party lobby: up to 4 players join with their own device and pick racers at
// the same time, each with their own cursor.

import { CHARACTERS, getCharacter } from '../sim/characters';
import { controlsFor, deviceLabel, isPad, MAX_PLAYERS, PLAYER_COLORS, type DeviceId, type PartyMember } from '../game/party';
import type { DeviceAction } from '../input/devices';
import type { Preview } from './preview';

export interface LobbySounds {
  move(): void;
  confirm(): void;
  back(): void;
  deny(): void;
}

interface Seat {
  device: DeviceId;
  cursor: number;
  ready: boolean;
}

const COLS = 4;

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

const MENU_KEYS: Record<string, string> = {
  'kb-left': 'W A S D move · Space pick · Q back',
  'kb-right': 'Arrows move · Enter pick · Backspace back',
};

export class Lobby {
  readonly root: HTMLDivElement;
  readonly seats: Seat[] = [];
  private readonly grid: HTMLDivElement;
  private readonly seatEls: HTMLDivElement[] = [];
  private readonly footer: HTMLDivElement;
  private lastLineup = '';

  constructor(
    parent: HTMLElement,
    private readonly sounds: LobbySounds,
    private readonly preview: Preview,
    private readonly onDone: (members: PartyMember[]) => void,
    private readonly onExit: () => void,
    previous: PartyMember[] = [],
  ) {
    for (const m of previous.slice(0, MAX_PLAYERS)) {
      this.seats.push({ device: m.device, cursor: Math.max(0, CHARACTERS.findIndex((c) => c.id === m.characterId)), ready: false });
    }
    this.root = document.createElement('div');
    this.root.className = 'lobby-root';
    this.root.innerHTML = `
      <div class="screen lobby" data-screen="lobby">
        <h1>Party Race</h1>
        <p class="subtitle">2 to 4 players. One keyboard fits two players (left side + arrow side); players 3 and 4 need gamepads.</p>
        <div class="lobby-top"><div class="lobby-grid"></div><div class="lobby-preview"></div></div>
        <div class="lobby-seats"></div>
        <div class="lobby-footer"></div>
      </div>`;
    parent.appendChild(this.root);
    this.grid = this.root.querySelector('.lobby-grid')!;
    this.footer = this.root.querySelector('.lobby-footer')!;
    CHARACTERS.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'lobby-card';
      card.innerHTML = `<span class="swatch" style="background:${hex(c.color)};border-color:${hex(c.accent)}"></span><span class="name">${c.name}</span><span class="badges"></span>`;
      this.grid.appendChild(card);
    });
    const seatsEl = this.root.querySelector('.lobby-seats')!;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const el = document.createElement('div');
      el.className = 'lobby-seat';
      el.style.setProperty('--pc', PLAYER_COLORS[i]);
      seatsEl.appendChild(el);
      this.seatEls.push(el);
    }
    this.root.querySelector('.lobby-preview')!.appendChild(preview.canvas);
    preview.start();
    this.render();
  }

  get members(): PartyMember[] {
    return this.seats.map((s) => ({ device: s.device, characterId: CHARACTERS[s.cursor].id }));
  }

  private allReady(): boolean {
    return this.seats.length >= 2 && this.seats.every((s) => s.ready);
  }

  private takenBy(cursor: number, except: Seat): Seat | undefined {
    return this.seats.find((s) => s !== except && s.ready && s.cursor === cursor);
  }

  handle(device: DeviceId, action: DeviceAction): void {
    if (action === 'exit') {
      this.sounds.back();
      this.onExit();
      return;
    }
    const seat = this.seats.find((s) => s.device === device);
    if (!seat) {
      if (action === 'confirm' || action === 'start') {
        if (this.seats.length >= MAX_PLAYERS) return this.sounds.deny();
        let cursor = 0;
        const used = new Set(this.seats.map((s) => s.cursor));
        while (used.has(cursor) && cursor < CHARACTERS.length - 1) cursor++;
        this.seats.push({ device, cursor, ready: false });
        this.sounds.confirm();
      } else if (action === 'back' && this.seats.length === 0) {
        this.sounds.back();
        this.onExit();
        return;
      }
      this.render();
      return;
    }
    if (seat.ready) {
      if (action === 'back') {
        seat.ready = false;
        this.sounds.back();
      } else if (action === 'confirm' || action === 'start') {
        if (this.allReady()) {
          this.sounds.confirm();
          this.onDone(this.members);
          return;
        }
        this.sounds.deny();
      }
      this.render();
      return;
    }
    const n = CHARACTERS.length;
    switch (action) {
      case 'left':
        seat.cursor = (seat.cursor + n - 1) % n;
        this.sounds.move();
        break;
      case 'right':
        seat.cursor = (seat.cursor + 1) % n;
        this.sounds.move();
        break;
      case 'up':
      case 'down':
        seat.cursor = (seat.cursor + COLS) % n;
        this.sounds.move();
        break;
      case 'confirm':
      case 'start':
        if (this.takenBy(seat.cursor, seat)) this.sounds.deny();
        else {
          seat.ready = true;
          this.sounds.confirm();
        }
        break;
      case 'back':
        this.seats.splice(this.seats.indexOf(seat), 1);
        this.sounds.back();
        break;
    }
    this.render();
  }

  private render(): void {
    const members = this.members;
    // Character cards with player cursor badges.
    CHARACTERS.forEach((_, ci) => {
      const card = this.grid.children[ci] as HTMLDivElement;
      const here = this.seats.map((s, i) => ({ s, i })).filter(({ s }) => s.cursor === ci);
      card.classList.toggle('locked', here.some(({ s }) => s.ready));
      card.querySelector('.badges')!.innerHTML = here
        .map(({ s, i }) => `<b class="${s.ready ? 'ready' : ''}" style="background:${PLAYER_COLORS[i]}">P${i + 1}</b>`)
        .join('');
    });
    // Seat panels.
    this.seatEls.forEach((el, i) => {
      const s = this.seats[i];
      if (!s) {
        el.className = 'lobby-seat empty';
        el.innerHTML = `<div class="seat-head"><b>P${i + 1}</b> press to join</div>
          <div class="seat-join">Gamepad: <kbd>A</kbd><br>Keyboard left side: <kbd>Space</kbd><br>Keyboard arrow side: <kbd>Enter</kbd></div>`;
        return;
      }
      const c = getCharacter(CHARACTERS[s.cursor].id);
      const rows = controlsFor(s.device, members)
        .map((r) => `<tr><td>${r.action.replace(' / reverse', '')}</td><td>${r.keys.replace('Left stick or D-pad', 'Stick or D-pad')}</td></tr>`)
        .join('');
      el.className = `lobby-seat ${s.ready ? 'ready' : ''}`;
      el.dataset.device = s.device;
      el.innerHTML = `<div class="seat-head"><b>P${i + 1}</b> ${deviceLabel(s.device)}</div>
        <div class="seat-char">${c.name} <span class="state">${s.ready ? 'READY' : 'choosing…'}</span></div>
        <div class="seat-menu">${isPad(s.device) ? 'Stick/D-pad move · A pick · B back' : MENU_KEYS[s.device]}</div>
        <table class="seat-controls">${rows}</table>`;
    });
    // Footer status.
    let msg: string;
    if (this.seats.length === 0) msg = 'Each player presses a button on their own device to join. <b>Esc</b> to go back.';
    else if (this.seats.length === 1) msg = 'Waiting for at least one more player…';
    else if (!this.allReady()) msg = 'Pick a racer and press your pick button to lock in. Two players can’t pick the same racer.';
    else msg = '<b class="go">Everyone’s ready! Any player: press pick / Start to continue</b>';
    this.footer.innerHTML = msg;
    this.root.querySelector('.lobby')!.classList.toggle('all-ready', this.allReady());
    // 3D lineup of the current picks.
    const lineup = members.map((m) => m.characterId).join(',');
    if (lineup !== this.lastLineup) {
      this.lastLineup = lineup;
      this.preview.show(members.length ? members.map((m) => m.characterId) : [], 'lineup');
    }
  }

  destroy(): void {
    this.preview.stop();
    this.root.remove();
  }
}
