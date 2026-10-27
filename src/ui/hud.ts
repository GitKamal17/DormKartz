// Race HUD, one per viewport. Plain DOM over the canvas.

import { getCharacter } from '../sim/characters';
import { ITEMS } from '../sim/items';
import type { Track } from '../sim/track/build';
import { ITEM_TYPES, type KartState, type PlayerId, type RaceEvent, type RaceState } from '../sim/types';
import { formatTime, ITEM_ICONS, ordinalSuffix } from './icons';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly base: HTMLCanvasElement;
  private readonly size: number;
  private readonly scale: number;
  private readonly ox: number;
  private readonly oz: number;

  constructor(track: Track, size: number) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d')!;
    const b = track.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    this.scale = (size * 0.86) / span;
    this.ox = (b.minX + b.maxX) / 2;
    this.oz = (b.minZ + b.maxZ) / 2;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = size;
    const c = this.base.getContext('2d')!;
    c.lineJoin = c.lineCap = 'round';
    for (const [w, col] of [[Math.max(5, size * 0.05), 'rgba(0,0,0,0.55)'], [Math.max(3, size * 0.028), 'rgba(255,255,255,0.92)']] as const) {
      c.strokeStyle = col;
      c.lineWidth = w;
      c.beginPath();
      for (let i = 0; i <= track.n; i += 2) {
        const j = i % track.n;
        const [x, y] = this.map(track.px[j], track.pz[j]);
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      c.stroke();
    }
    const [sx, sy] = this.map(track.px[0], track.pz[0]);
    c.fillStyle = '#ffd23a';
    c.fillRect(sx - 3, sy - 3, 6, 6);
    this.ctx.drawImage(this.base, 0, 0);
  }

  /** World (x, z) to minimap pixels; x is mirrored so right turns look right-handed. */
  map(x: number, z: number): [number, number] {
    return [this.size / 2 - (x - this.ox) * this.scale, this.size / 2 - (z - this.oz) * this.scale];
  }

  draw(state: RaceState, focus: PlayerId, ghost: KartState | null, humans?: ReadonlyMap<PlayerId, string>): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.size, this.size);
    c.drawImage(this.base, 0, 0);
    if (ghost) {
      const [x, y] = this.map(ghost.x, ghost.z);
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.beginPath();
      c.arc(x, y, 4, 0, Math.PI * 2);
      c.fill();
    }
    for (const p of state.projectiles) {
      if (p.kind !== 'comet') continue;
      const [x, y] = this.map(p.x, p.z);
      c.fillStyle = '#ffcf3a';
      c.beginPath();
      c.arc(x, y, 4, 0, Math.PI * 2);
      c.fill();
    }
    const ks = [...state.karts].sort((a, b) => (a.id === focus ? 1 : 0) - (b.id === focus ? 1 : 0));
    for (const k of ks) {
      const [x, y] = this.map(k.x, k.z);
      const me = k.id === focus;
      const human = humans?.get(k.id);
      c.fillStyle = '#' + getCharacter(k.characterId).color.toString(16).padStart(6, '0');
      c.strokeStyle = me ? '#ffffff' : human ?? '#000000';
      c.lineWidth = me ? 3 : human ? 3 : 1.5;
      c.beginPath();
      c.arc(x, y, me ? 6.5 : human ? 5.5 : 4.5, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
  }
}

export class Hud {
  readonly root: HTMLDivElement;
  private readonly place: HTMLDivElement;
  private readonly placeNum: HTMLSpanElement;
  private readonly placeSuf: HTMLSpanElement;
  private readonly lap: HTMLDivElement;
  private readonly time: HTMLDivElement;
  private readonly splits: HTMLDivElement;
  private readonly itemBox: HTMLDivElement;
  private readonly itemIcon: HTMLDivElement;
  private readonly itemCount: HTMLDivElement;
  private readonly center: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly wrong: HTMLDivElement;
  private readonly minimap: Minimap;
  private readonly speedo: HTMLDivElement;
  private bannerUntil = 0;
  private centerUntil = 0;
  private lastPlace = 0;
  private lastSplitCount = -1;
  private lastIcon = '';
  private readonly ghostLabel: HTMLDivElement;
  private readonly humans?: ReadonlyMap<PlayerId, string>;

  constructor(
    parent: HTMLElement,
    track: Track,
    private readonly follow: PlayerId,
    private readonly laps: number,
    opts: { tag?: { label: string; color: string; name: string } | null; humans?: ReadonlyMap<PlayerId, string> } = {},
  ) {
    this.humans = opts.humans;
    this.root = el('div', 'hud' + (opts.tag ? ' player' : ''), parent);
    if (opts.tag) {
      this.root.style.setProperty('--pc', opts.tag.color);
      const tag = el('div', 'hud-tag', this.root);
      tag.innerHTML = `<b>${opts.tag.label}</b> ${opts.tag.name}`;
    }
    const tl = el('div', 'hud-tl', this.root);
    this.itemBox = el('div', 'item-box', tl);
    this.itemIcon = el('div', 'item-icon', this.itemBox);
    this.itemCount = el('div', 'item-count', this.itemBox);
    const tr = el('div', 'hud-tr', this.root);
    this.lap = el('div', 'hud-lap', tr);
    this.time = el('div', 'hud-time', tr);
    this.splits = el('div', 'hud-splits', tr);
    this.ghostLabel = el('div', 'hud-ghost', tr);
    this.minimap = new Minimap(track, 190);
    const mm = el('div', 'hud-minimap', this.root);
    mm.appendChild(this.minimap.canvas);
    this.place = el('div', 'hud-place', this.root);
    this.placeNum = el('span', 'num', this.place);
    this.placeSuf = el('span', 'suf', this.place);
    this.speedo = el('div', 'hud-speed', this.root);
    this.center = el('div', 'hud-center', this.root);
    this.banner = el('div', 'hud-banner', this.root);
    this.wrong = el('div', 'hud-wrong', this.root);
    this.wrong.textContent = 'WRONG WAY';
  }

  setRect(r: { x: number; y: number; w: number; h: number }): void {
    Object.assign(this.root.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
    this.rect = r;
    this.rescale();
  }

  private rect = { x: 0, y: 0, w: 1, h: 1 };

  /** Shrinks HUD elements to fit smaller split-screen viewports. */
  rescale(): void {
    const w = this.rect.w * window.innerWidth, h = this.rect.h * window.innerHeight;
    const s = Math.max(0.5, Math.min(1, w / 1100, h / 640));
    this.root.style.setProperty('--s', s.toFixed(3));
  }

  showCenter(text: string, ms: number, cls = ''): void {
    this.center.textContent = text;
    this.center.className = 'hud-center show ' + cls;
    this.centerUntil = performance.now() + ms;
  }

  showBanner(text: string, ms: number, cls = ''): void {
    this.banner.textContent = text;
    this.banner.className = 'hud-banner show ' + cls;
    this.bannerUntil = performance.now() + ms;
  }

  onEvents(events: RaceEvent[], state: RaceState): void {
    for (const e of events) {
      if (e.type === 'countdown') this.showCenter(e.n === 0 ? 'GO!' : String(e.n), e.n === 0 ? 900 : 950, e.n === 0 ? 'go' : 'count');
      if (e.type === 'lap' && e.kart === this.follow) {
        if (e.lap === this.laps) this.showBanner('FINAL LAP!', 2200, 'final');
        else this.showBanner(`LAP ${e.lap}`, 1500);
      }
      if (e.type === 'finish' && e.kart === this.follow) this.showBanner(`FINISH! ${e.place}${ordinalSuffix(e.place)}`, 600000, 'finish');
      if (e.type === 'boost' && e.kart === this.follow && e.kind === 'start') this.showBanner('ROCKET START!', 1300, 'small');
      if (e.type === 'boost' && e.kart === this.follow && e.kind === 'trick') this.showBanner('TRICK!', 800, 'small');
      if (e.type === 'blocked' && e.kart === this.follow) this.showBanner('BLOCKED!', 900, 'small');
      if (e.type === 'shrink' && e.by !== this.follow) this.showBanner('ZAP!', 900, 'small');
    }
    void state;
  }

  update(state: RaceState, k: KartState, ghost: KartState | null, ghostBest: number | null): void {
    const now = performance.now();
    if (now > this.centerUntil) this.center.classList.remove('show');
    if (now > this.bannerUntil) this.banner.classList.remove('show');
    if (k.place !== this.lastPlace) {
      this.lastPlace = k.place;
      this.placeNum.textContent = String(k.place);
      this.placeSuf.textContent = ordinalSuffix(k.place);
      this.place.className = `hud-place p${k.place}`;
      this.place.animate([{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 250 });
    }
    const lap = Math.max(1, Math.min(this.laps, k.lap));
    this.lap.innerHTML = `LAP <b>${lap}</b>/${this.laps}`;
    const raceTicks = state.phase === 'countdown' ? 0 : k.finished ? k.finishTick - state.goTick : state.tick - state.goTick;
    this.time.textContent = formatTime(raceTicks);
    if (k.lapTimes.length !== this.lastSplitCount) {
      this.lastSplitCount = k.lapTimes.length;
      this.splits.innerHTML = k.lapTimes.map((t, i) => `<div>L${i + 1} ${formatTime(t)}</div>`).join('');
    }
    this.ghostLabel.textContent = ghostBest !== null ? `Best lap ${formatTime(ghostBest)}` : '';
    // Item slot with roulette.
    let icon = '';
    let count = '';
    if (k.rouletteTicks > 0) {
      icon = ITEM_TYPES[Math.floor(now / 70) % ITEM_TYPES.length];
      this.itemBox.classList.add('rolling');
    } else {
      this.itemBox.classList.remove('rolling');
      if (k.trailing) icon = k.trailing;
      else if (k.item) {
        icon = k.item;
        if (k.itemCount > 1) count = `×${k.itemCount}`;
      }
    }
    if (icon !== this.lastIcon) {
      this.lastIcon = icon;
      this.itemIcon.innerHTML = icon ? ITEM_ICONS[icon as keyof typeof ITEM_ICONS] : '';
      this.itemBox.title = icon ? ITEMS[icon as keyof typeof ITEMS].name : '';
    }
    this.itemCount.textContent = count;
    this.itemBox.classList.toggle('held', !!k.trailing);
    this.wrong.classList.toggle('show', k.wrongWay && !k.finished);
    const speed = Math.hypot(k.vx, k.vz);
    this.speedo.textContent = `${Math.round(speed * 3.6)} km/h`;
    this.minimap.draw(state, this.follow, ghost, this.humans);
  }

  destroy(): void {
    this.root.remove();
  }
}

/** Fills the spare quarter of a 3-player split: big live map and standings. */
export class MapPanel {
  readonly root: HTMLDivElement;
  private readonly minimap: Minimap;
  private readonly list: HTMLDivElement;
  private last = '';

  constructor(
    parent: HTMLElement,
    track: Track,
    rect: { x: number; y: number; w: number; h: number },
    private readonly humans: ReadonlyMap<PlayerId, string>,
  ) {
    this.root = el('div', 'map-panel', parent);
    Object.assign(this.root.style, { left: rect.x * 100 + '%', top: rect.y * 100 + '%', width: rect.w * 100 + '%', height: rect.h * 100 + '%' });
    const size = Math.round(Math.min(rect.w * window.innerWidth * 0.55, rect.h * window.innerHeight * 0.85));
    this.minimap = new Minimap(track, Math.max(120, size));
    this.root.appendChild(this.minimap.canvas);
    this.list = el('div', 'map-standings', this.root);
  }

  update(state: RaceState): void {
    this.minimap.draw(state, -1, null, this.humans);
    const order = [...state.karts].sort((a, b) => a.place - b.place);
    const key = order.map((k) => k.id).join(',');
    if (key === this.last) return;
    this.last = key;
    let n = 0;
    const tags = new Map([...this.humans.keys()].map((id) => [id, `P${++n}`]));
    this.list.innerHTML = order
      .map((k) => {
        const c = getCharacter(k.characterId);
        const color = this.humans.get(k.id);
        const tag = color ? `<b style="background:${color}">${tags.get(k.id)}</b>` : '';
        return `<div class="${color ? 'human' : ''}"><span class="pl">${k.place}</span>${tag}<span class="dot" style="background:#${c.color.toString(16).padStart(6, '0')}"></span>${c.name}</div>`;
      })
      .join('');
  }

  destroy(): void {
    this.root.remove();
  }
}
