// Menu navigation from keyboard and gamepad, as discrete actions with key repeat.

import { PAD, pressed, axis } from './gamepad';
import { isTyping } from './keyboard';

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause';

const KEY_ACTIONS: Record<string, MenuAction> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyI: 'up',
  KeyK: 'down',
  KeyJ: 'left',
  KeyL: 'right',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Escape: 'back',
  Backspace: 'back',
};

export class MenuInput {
  private listeners: ((a: MenuAction, source: 'key' | 'pad') => void)[] = [];
  private padHeld = new Map<string, number>();
  private padsSeen = new Set<number>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat && (e.code === 'Escape' || e.code === 'Enter')) return;
      // Text fields handle their own keys; only Escape still means "back".
      if (isTyping(e) && e.code !== 'Escape') return;
      // One action per key press: Escape is "back" (which also pauses a race).
      const a = e.code === 'KeyP' ? 'pause' : KEY_ACTIONS[e.code];
      if (a) this.emit(a, 'key');
    });
  }

  on(fn: (a: MenuAction, source: 'key' | 'pad') => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(a: MenuAction, source: 'key' | 'pad'): void {
    for (const l of [...this.listeners]) l(a, source);
  }

  /** Call once per frame to turn gamepad state into actions. Every connected pad can drive menus. */
  pollGamepad(now: number): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const seen = new Set<number>();
    for (const p of navigator.getGamepads()) {
      if (!p || !p.connected) continue;
      seen.add(p.index);
      const state: [MenuAction, boolean][] = [
        ['up', pressed(p, PAD.UP) || axis(p, 1) < -0.6],
        ['down', pressed(p, PAD.DOWN) || axis(p, 1) > 0.6],
        ['left', pressed(p, PAD.LEFT) || axis(p, 0) < -0.6],
        ['right', pressed(p, PAD.RIGHT) || axis(p, 0) > 0.6],
        ['confirm', pressed(p, PAD.A)],
        ['back', pressed(p, PAD.B)],
        ['pause', pressed(p, PAD.START)],
      ];
      // Ignore buttons already held when a pad is first seen.
      const fresh = !this.padsSeen.has(p.index);
      this.padsSeen.add(p.index);
      for (const [a, down] of state) {
        const key = `${p.index}:${a}`;
        const since = this.padHeld.get(key);
        if (down) {
          if (since === undefined) {
            this.padHeld.set(key, now);
            if (!fresh) this.emit(a, 'pad');
          } else if (a !== 'confirm' && a !== 'back' && a !== 'pause' && now - since > 420) {
            this.padHeld.set(key, now - 300);
            this.emit(a, 'pad');
          }
        } else this.padHeld.delete(key);
      }
    }
    for (const i of [...this.padsSeen]) if (!seen.has(i)) this.padsSeen.delete(i);
  }

  /** Treat everything currently held as already handled (used when screens switch). */
  swallowHeld(): void {
    for (const i of [...this.padsSeen]) this.padsSeen.delete(i);
  }
}
