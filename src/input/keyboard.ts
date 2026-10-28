// Tracks which keys are held. One listener for the whole page; individual
// KeyboardInput sources read from it with their own bindings (so two local
// players could share a keyboard later).

const held = new Set<string>();
let installed = false;

export function installKeyboard(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    held.add(e.code);
    if (GAME_KEYS.has(e.code)) e.preventDefault();
  });
  target.addEventListener('keyup', (e) => held.delete(e.code));
  target.addEventListener('blur', () => held.clear());
}

/** True when a key press is going into a text field (room code, name), not the game. */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

export function isHeld(code: string): boolean {
  return held.has(code);
}

/** Lets tests and the smoke test simulate keys without real events. */
export function setHeld(code: string, down: boolean): void {
  if (down) held.add(code);
  else held.delete(code);
}

export interface KeyBindings {
  left: string[];
  right: string[];
  throttle: string[];
  brake: string[];
  drift: string[];
  item: string[];
  lookBack: string[];
}

export const DEFAULT_KEYS: KeyBindings = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  drift: ['Space'],
  item: ['ShiftLeft', 'ShiftRight', 'KeyE'],
  lookBack: ['KeyQ'],
};

/** Left half of a shared keyboard. Same keys as solo play, minus the arrows. */
export const KEYS_LEFT: KeyBindings = {
  left: ['KeyA'],
  right: ['KeyD'],
  throttle: ['KeyW'],
  brake: ['KeyS'],
  drift: ['Space'],
  item: ['ShiftLeft', 'KeyE'],
  lookBack: ['KeyQ'],
};

/**
 * Right half of a shared keyboard: I J K L, the mirror image of W A S D.
 * The pinky rests on ";" for drift (Right Shift works too); U and O sit where
 * E and Q are for the left player.
 */
export const KEYS_RIGHT: KeyBindings = {
  left: ['KeyJ'],
  right: ['KeyL'],
  throttle: ['KeyI'],
  brake: ['KeyK'],
  drift: ['Semicolon', 'ShiftRight'],
  item: ['KeyU'],
  lookBack: ['KeyO'],
};

// Keys whose browser default must be blocked: scrolling (arrows, Space),
// Firefox quick find ("/" and "'"), and history navigation (Backspace).
const GAME_KEYS = new Set<string>(['Backspace', 'Quote', ...[DEFAULT_KEYS, KEYS_LEFT, KEYS_RIGHT].flatMap((k) => Object.values(k).flat())]);

export function anyHeld(codes: string[]): boolean {
  for (const c of codes) if (held.has(c)) return true;
  return false;
}
