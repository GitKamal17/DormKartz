// Standard-mapping gamepad reading (Gamepad API).

export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SELECT: 8,
  START: 9,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
} as const;

export function getPad(index: number): Gamepad | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  const pads = navigator.getGamepads();
  return pads[index] ?? null;
}

export function firstPad(): Gamepad | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  for (const p of navigator.getGamepads()) if (p && p.connected) return p;
  return null;
}

export function pressed(p: Gamepad | null, b: number): boolean {
  return !!p && !!p.buttons[b] && (p.buttons[b].pressed || p.buttons[b].value > 0.5);
}

export function value(p: Gamepad | null, b: number): number {
  return p && p.buttons[b] ? p.buttons[b].value : 0;
}

export function axis(p: Gamepad | null, a: number, deadzone = 0.18): number {
  if (!p || p.axes[a] === undefined) return 0;
  const v = p.axes[a];
  if (Math.abs(v) < deadzone) return 0;
  return Math.sign(v) * ((Math.abs(v) - deadzone) / (1 - deadzone));
}
