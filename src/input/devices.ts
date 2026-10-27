// Per-device menu actions for the party lobby: each half of the keyboard and
// each gamepad is a separate "device", so players can pick racers at the same time.

import type { DeviceId } from '../game/party';
import { axis, PAD, pressed } from './gamepad';

export type DeviceAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'start' | 'exit';

const KEYS: Record<string, [DeviceId, DeviceAction]> = {
  KeyW: ['kb-left', 'up'],
  KeyS: ['kb-left', 'down'],
  KeyA: ['kb-left', 'left'],
  KeyD: ['kb-left', 'right'],
  Space: ['kb-left', 'confirm'],
  KeyE: ['kb-left', 'confirm'],
  KeyQ: ['kb-left', 'back'],
  ArrowUp: ['kb-right', 'up'],
  ArrowDown: ['kb-right', 'down'],
  ArrowLeft: ['kb-right', 'left'],
  ArrowRight: ['kb-right', 'right'],
  Enter: ['kb-right', 'confirm'],
  NumpadEnter: ['kb-right', 'confirm'],
  ShiftRight: ['kb-right', 'confirm'],
  Backspace: ['kb-right', 'back'],
  ControlRight: ['kb-right', 'back'],
  Escape: ['kb-left', 'exit'],
};

type Listener = (device: DeviceId, action: DeviceAction) => void;

export class DeviceInput {
  private listeners: Listener[] = [];
  private held = new Map<string, number>();
  private activatedAt = 0;
  active = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      // Ignore the key press that opened the lobby.
      if (!this.active || e.repeat || e.timeStamp <= this.activatedAt) return;
      const hit = KEYS[e.code];
      if (hit) {
        e.preventDefault();
        this.emit(hit[0], hit[1]);
      }
    });
  }

  on(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  private emit(d: DeviceId, a: DeviceAction): void {
    for (const l of [...this.listeners]) l(d, a);
  }

  /** Call every frame. Presses on newly connected pads count (that's how they join). */
  poll(now: number): void {
    if (!this.active || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    for (const p of navigator.getGamepads()) {
      if (!p || !p.connected) continue;
      const dev: DeviceId = `pad-${p.index}`;
      const state: [DeviceAction, boolean][] = [
        ['up', pressed(p, PAD.UP) || axis(p, 1) < -0.6],
        ['down', pressed(p, PAD.DOWN) || axis(p, 1) > 0.6],
        ['left', pressed(p, PAD.LEFT) || axis(p, 0) < -0.6],
        ['right', pressed(p, PAD.RIGHT) || axis(p, 0) > 0.6],
        ['confirm', pressed(p, PAD.A)],
        ['back', pressed(p, PAD.B)],
        ['start', pressed(p, PAD.START)],
      ];
      for (const [a, down] of state) {
        const key = `${p.index}:${a}`;
        const since = this.held.get(key);
        if (down) {
          if (since === undefined) {
            this.held.set(key, now);
            this.emit(dev, a);
          } else if ((a === 'up' || a === 'down' || a === 'left' || a === 'right') && now - since > 380) {
            this.held.set(key, now - 260);
            this.emit(dev, a);
          }
        } else this.held.delete(key);
      }
    }
  }

  /** Starts listening. Buttons already held (e.g. the press that opened the lobby) don't count. */
  activate(): void {
    this.held.clear();
    this.activatedAt = performance.now();
    if (typeof navigator !== 'undefined' && navigator.getGamepads) {
      for (const p of navigator.getGamepads()) {
        if (!p || !p.connected) continue;
        for (const [a, b] of [['confirm', PAD.A], ['back', PAD.B], ['start', PAD.START]] as const) {
          if (pressed(p, b)) this.held.set(`${p.index}:${a}`, this.activatedAt);
        }
      }
    }
    this.active = true;
  }

  deactivate(): void {
    this.active = false;
  }
}
