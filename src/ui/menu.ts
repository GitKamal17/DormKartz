// Small menu framework: a screen is a list (or grid) of items navigable with
// keyboard, gamepad or mouse.

import type { MenuAction } from '../input/menuInput';

export interface MenuItem {
  label: string;
  /** Extra HTML inside the item (icons, details). */
  html?: string;
  action?: () => void;
  kind?: 'button' | 'slider' | 'toggle';
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (v: number) => void;
  disabled?: boolean;
  className?: string;
  /** Test hook / stable identifier. */
  id?: string;
}

export interface Screen {
  id: string;
  title?: string;
  subtitle?: string;
  className?: string;
  items: MenuItem[];
  /** Grid columns for left/right/up/down navigation. */
  columns?: number;
  initial?: number;
  onBack?: () => void;
  onFocus?: (index: number) => void;
  /** Adds custom content; returns an optional cleanup. */
  extra?: (root: HTMLElement) => (() => void) | void;
  /** Where the item list goes relative to extra content. */
  layout?: 'stack' | 'side';
  /** Items are laid out in a row (left/right also navigate). */
  horizontal?: boolean;
  footer?: string;
}

export interface MenuSounds {
  move(): void;
  confirm(): void;
  back(): void;
}

export class Menu {
  private screen: Screen | null = null;
  private focus = 0;
  private itemEls: HTMLElement[] = [];
  private cleanup: (() => void) | void = undefined;
  private shownAt = 0;
  readonly root: HTMLDivElement;

  constructor(
    parent: HTMLElement,
    private readonly sounds: MenuSounds,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'menu-root';
    parent.appendChild(this.root);
  }

  get current(): Screen | null {
    return this.screen;
  }

  get visible(): boolean {
    return this.screen !== null;
  }

  show(s: Screen): void {
    this.close();
    this.screen = s;
    this.shownAt = performance.now();
    this.focus = Math.min(s.initial ?? 0, s.items.length - 1);
    const wrap = document.createElement('div');
    wrap.className = `screen screen-${s.id} ${s.className ?? ''}`;
    wrap.dataset.screen = s.id;
    if (s.title) {
      const h = document.createElement('h1');
      h.textContent = s.title;
      wrap.appendChild(h);
    }
    if (s.subtitle) {
      const p = document.createElement('p');
      p.className = 'subtitle';
      p.innerHTML = s.subtitle;
      wrap.appendChild(p);
    }
    const body = document.createElement('div');
    body.className = 'screen-body ' + (s.layout === 'side' ? 'side' : 'stack');
    wrap.appendChild(body);
    const list = document.createElement('div');
    list.className = 'menu-list' + (s.columns ? ' grid' : '');
    if (s.columns) list.style.gridTemplateColumns = `repeat(${s.columns}, 1fr)`;
    body.appendChild(list);
    this.itemEls = s.items.map((it, i) => {
      const b = document.createElement('div');
      b.className = `menu-item ${it.kind ?? 'button'} ${it.className ?? ''}${it.disabled ? ' disabled' : ''}`;
      if (it.id) b.dataset.id = it.id;
      b.tabIndex = -1;
      b.addEventListener('mouseenter', () => this.setFocus(i, false));
      b.addEventListener('click', () => {
        this.setFocus(i, false);
        this.activate();
      });
      list.appendChild(b);
      return b;
    });
    s.items.forEach((_, i) => this.renderItem(i));
    if (s.extra) {
      const ex = document.createElement('div');
      ex.className = 'menu-extra';
      body.appendChild(ex);
      this.cleanup = s.extra(ex);
    }
    if (s.footer) {
      const f = document.createElement('div');
      f.className = 'menu-footer';
      f.innerHTML = s.footer;
      wrap.appendChild(f);
    }
    this.root.appendChild(wrap);
    this.setFocus(this.focus, false);
  }

  close(): void {
    if (this.cleanup) this.cleanup();
    this.cleanup = undefined;
    this.root.innerHTML = '';
    this.screen = null;
    this.itemEls = [];
  }

  private renderItem(i: number): void {
    const it = this.screen!.items[i];
    const b = this.itemEls[i];
    if (it.kind === 'slider') {
      const pct = ((it.value! - (it.min ?? 0)) / ((it.max ?? 1) - (it.min ?? 0))) * 100;
      b.innerHTML = `<span class="label">${it.label}</span><span class="slider"><span class="fill" style="width:${pct}%"></span></span><span class="val">${Math.round(pct)}%</span>`;
    } else if (it.kind === 'toggle') {
      b.innerHTML = `<span class="label">${it.label}</span><span class="toggle ${it.value ? 'on' : ''}">${it.value ? 'ON' : 'OFF'}</span>`;
    } else {
      b.innerHTML = (it.html ?? '') + `<span class="label">${it.label}</span>`;
    }
  }

  private setFocus(i: number, sound = true): void {
    const items = this.screen?.items;
    if (!items || !items.length) return;
    i = Math.max(0, Math.min(items.length - 1, i));
    if (i !== this.focus && sound) this.sounds.move();
    this.itemEls[this.focus]?.classList.remove('focus');
    this.focus = i;
    this.itemEls[i]?.classList.add('focus');
    this.itemEls[i]?.scrollIntoView?.({ block: 'nearest' });
    this.screen?.onFocus?.(i);
  }

  private activate(): void {
    const it = this.screen?.items[this.focus];
    if (!it || it.disabled) return;
    if (it.kind === 'toggle') {
      it.value = it.value ? 0 : 1;
      it.onChange?.(it.value);
      this.renderItem(this.focus);
      this.sounds.move();
      return;
    }
    if (it.kind === 'slider') return;
    this.sounds.confirm();
    it.action?.();
  }

  private adjust(dir: number): boolean {
    const it = this.screen?.items[this.focus];
    if (!it) return false;
    if (it.kind === 'slider') {
      it.value = Math.max(it.min ?? 0, Math.min(it.max ?? 1, (it.value ?? 0) + dir * (it.step ?? 0.1)));
      it.value = Math.round(it.value * 100) / 100;
      it.onChange?.(it.value);
      this.renderItem(this.focus);
      this.sounds.move();
      return true;
    }
    if (it.kind === 'toggle') {
      this.activate();
      return true;
    }
    return false;
  }

  handle(a: MenuAction): void {
    const s = this.screen;
    if (!s) return;
    // Ignore presses that land as a screen appears (e.g. still mashing buttons
    // when the results pop up mid-race).
    if (performance.now() - this.shownAt < 300 && (a === 'confirm' || a === 'back')) return;
    const cols = s.columns ?? 1;
    switch (a) {
      case 'up':
        this.setFocus(this.focus - cols);
        break;
      case 'down':
        this.setFocus(this.focus + cols);
        break;
      case 'left':
        if (!this.adjust(-1) && (cols > 1 || s.horizontal)) this.setFocus(this.focus - 1);
        break;
      case 'right':
        if (!this.adjust(1) && (cols > 1 || s.horizontal)) this.setFocus(this.focus + 1);
        break;
      case 'confirm':
        this.activate();
        break;
      case 'back':
      case 'pause':
        if (s.onBack) {
          this.sounds.back();
          s.onBack();
        }
        break;
    }
  }
}
