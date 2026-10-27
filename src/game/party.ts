// Local multiplayer ("party") setup: which device each player uses, what keys
// that gives them, and how the screen is split. Pure functions, no DOM.

import { DEFAULT_KEYS, KEYS_LEFT, KEYS_RIGHT, type KeyBindings } from '../input/keyboard';
import type { LocalInputOptions } from '../input/local';

/** A physical input device a player can join with. */
export type DeviceId = 'kb-left' | 'kb-right' | `pad-${number}`;

export interface PartyMember {
  device: DeviceId;
  characterId: string;
}

export const MAX_PLAYERS = 4;
export const PLAYER_COLORS = ['#ff4d5a', '#3aa0ff', '#45d35a', '#ffc21a'];

export { KEYS_LEFT, KEYS_RIGHT } from '../input/keyboard';

export function isPad(d: DeviceId): d is `pad-${number}` {
  return d.startsWith('pad-');
}

export function padIndex(d: DeviceId): number {
  return isPad(d) ? Number(d.slice(4)) : -1;
}

/** True when both halves of the keyboard are taken, so each gets half the keys. */
export function keyboardShared(members: readonly PartyMember[]): boolean {
  return members.some((m) => m.device === 'kb-left') && members.some((m) => m.device === 'kb-right');
}

/** The key set a keyboard player actually gets (the whole keyboard if they're alone on it). */
export function keysFor(device: DeviceId, members: readonly PartyMember[]): KeyBindings | null {
  if (isPad(device)) return null;
  if (!keyboardShared(members)) return DEFAULT_KEYS;
  return device === 'kb-left' ? KEYS_LEFT : KEYS_RIGHT;
}

export function inputOptionsFor(device: DeviceId, members: readonly PartyMember[]): LocalInputOptions {
  if (isPad(device)) return { keys: null, pad: padIndex(device) };
  return { keys: keysFor(device, members), pad: null };
}

export function deviceLabel(d: DeviceId): string {
  if (d === 'kb-left') return 'Keyboard · left side';
  if (d === 'kb-right') return 'Keyboard · arrow side';
  return `Gamepad ${padIndex(d) + 1}`;
}

const KEY_NAMES: Record<string, string> = {
  KeyA: 'A', KeyD: 'D', KeyW: 'W', KeyS: 'S', KeyE: 'E', KeyQ: 'Q', Space: 'Space',
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlRight: 'Right Ctrl',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Slash: '/', Period: '.',
  Numpad0: 'Num 0', Numpad1: 'Num 1', Numpad2: 'Num 2', Numpad4: 'Num 4', Numpad5: 'Num 5',
  Numpad6: 'Num 6', Numpad8: 'Num 8', NumpadDecimal: 'Num .',
};

const keyName = (c: string) => KEY_NAMES[c] ?? c;

export interface ControlRow {
  action: string;
  keys: string;
}

/** Human-readable controls for one player, given who else is playing. */
export function controlsFor(device: DeviceId, members: readonly PartyMember[]): ControlRow[] {
  if (isPad(device)) {
    return [
      { action: 'Steer', keys: 'Left stick or D-pad' },
      { action: 'Accelerate', keys: 'A' },
      { action: 'Brake / reverse', keys: 'B' },
      { action: 'Drift / hop', keys: 'R1 or R2' },
      { action: 'Item', keys: 'L1 or L2' },
      { action: 'Look back', keys: 'X' },
      { action: 'Pause', keys: 'Start' },
    ];
  }
  const k = keysFor(device, members)!;
  const first = (codes: string[]) => keyName(codes[0]);
  const all = (codes: string[]) => codes.filter((c) => !c.startsWith('Numpad')).map(keyName).join(' or ');
  const steer = `${keyName(k.left[0])} ${keyName(k.right[0])}`;
  return [
    { action: 'Steer', keys: steer },
    { action: 'Accelerate', keys: all(k.throttle) },
    { action: 'Brake / reverse', keys: all(k.brake) },
    { action: 'Drift / hop', keys: all(k.drift) },
    { action: 'Item', keys: all(k.item) },
    { action: 'Look back', keys: first(k.lookBack) },
    { action: 'Pause', keys: 'Esc' },
  ];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Screen regions (normalized, origin top-left) for n players.
 * 1: full. 2: top/bottom, or left/right when sideBySide. 3-4: 2x2 grid
 * (with 3 players the bottom-right quarter is left for the map panel).
 */
export function viewportRects(n: number, sideBySide = false): Rect[] {
  if (n <= 1) return [{ x: 0, y: 0, w: 1, h: 1 }];
  if (n === 2) {
    return sideBySide
      ? [{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }]
      : [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }];
  }
  const quads = [
    { x: 0, y: 0, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0, w: 0.5, h: 0.5 },
    { x: 0, y: 0.5, w: 0.5, h: 0.5 },
    { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
  ];
  return quads.slice(0, Math.min(4, n));
}
