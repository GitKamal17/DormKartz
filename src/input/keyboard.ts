// Tracks which keys are held. One listener for the whole page; individual
// KeyboardInput sources read from it with their own bindings (so two local
// players could share a keyboard later).

const held = new Set<string>();
let installed = false;

export function installKeyboard(target: Window = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('keydown', (e) => {
    held.add(e.code);
    if (GAME_KEYS.has(e.code)) e.preventDefault();
  });
  target.addEventListener('keyup', (e) => held.delete(e.code));
  target.addEventListener('blur', () => held.clear());
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

const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);

export function anyHeld(codes: string[]): boolean {
  for (const c of codes) if (held.has(c)) return true;
  return false;
}
