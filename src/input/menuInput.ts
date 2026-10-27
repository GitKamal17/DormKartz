// Menu navigation from keyboard and gamepad, as discrete actions with key repeat.

import { firstPad, PAD, pressed, axis } from './gamepad';

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
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Escape: 'back',
  Backspace: 'back',
};

export class MenuInput {
  private listeners: ((a: MenuAction, source: 'key' | 'pad') => void)[] = [];
  private padHeld = new Map<MenuAction, number>();
  private padWasConnected = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat && (e.code === 'Escape' || e.code === 'Enter')) return;
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

  /** Call once per frame to turn gamepad state into actions. */
  pollGamepad(now: number): void {
    const p = firstPad();
    if (!p) {
      this.padWasConnected = false;
      return;
    }
    const state: [MenuAction, boolean][] = [
      ['up', pressed(p, PAD.UP) || axis(p, 1) < -0.6],
      ['down', pressed(p, PAD.DOWN) || axis(p, 1) > 0.6],
      ['left', pressed(p, PAD.LEFT) || axis(p, 0) < -0.6],
      ['right', pressed(p, PAD.RIGHT) || axis(p, 0) > 0.6],
      ['confirm', pressed(p, PAD.A)],
      ['back', pressed(p, PAD.B)],
      ['pause', pressed(p, PAD.START)],
    ];
    const fresh = !this.padWasConnected;
    this.padWasConnected = true;
    for (const [a, down] of state) {
      const since = this.padHeld.get(a);
      if (down) {
        if (since === undefined) {
          this.padHeld.set(a, now);
          // Ignore buttons already held when the pad is first seen.
          if (!fresh) this.emit(a, 'pad');
        } else if (a !== 'confirm' && a !== 'back' && a !== 'pause' && now - since > 420) {
          this.padHeld.set(a, now - 300);
          this.emit(a, 'pad');
        }
      } else this.padHeld.delete(a);
    }
  }
}
