// A local human player: keyboard and/or gamepad merged into one FrameInput.

import { clamp } from '../sim/math';
import type { FrameInput } from '../sim/types';
import { axis, firstPad, getPad, PAD, pressed } from './gamepad';
import { anyHeld, DEFAULT_KEYS, type KeyBindings } from './keyboard';
import { blankInput, type InputSource } from './types';

export interface LocalInputOptions {
  keys?: KeyBindings | null;
  /** Gamepad index, 'any' for the first connected pad, or null for none. */
  pad?: number | 'any' | null;
}

export class LocalInput implements InputSource {
  readonly kind = 'local' as const;
  private readonly keys: KeyBindings | null;
  private readonly pad: number | 'any' | null;
  private steer = 0;
  private readonly out = blankInput();

  constructor(opts: LocalInputOptions = {}) {
    this.keys = opts.keys === undefined ? DEFAULT_KEYS : opts.keys;
    this.pad = opts.pad === undefined ? 'any' : opts.pad;
  }

  poll(): FrameInput {
    const o = this.out;
    const k = this.keys;
    const p = this.pad === null ? null : this.pad === 'any' ? firstPad() : getPad(this.pad);

    // Keyboard steering ramps in so tapping gives small corrections.
    let keySteer = 0;
    if (k) keySteer = (anyHeld(k.right) ? 1 : 0) - (anyHeld(k.left) ? 1 : 0);
    if (keySteer === 0) this.steer = 0;
    else {
      const rate = Math.sign(keySteer) !== Math.sign(this.steer) ? 0.35 : 0.14;
      this.steer = clamp(this.steer + keySteer * rate, -1, 1);
    }
    let padSteer = axis(p, 0);
    if (pressed(p, PAD.LEFT)) padSteer = -1;
    if (pressed(p, PAD.RIGHT)) padSteer = 1;
    o.steer = Math.abs(padSteer) > Math.abs(this.steer) ? padSteer : this.steer;

    o.throttle = Math.max(k && anyHeld(k.throttle) ? 1 : 0, pressed(p, PAD.A) ? 1 : 0);
    o.brake = Math.max(k && anyHeld(k.brake) ? 1 : 0, pressed(p, PAD.B) ? 1 : 0);
    o.drift = (!!k && anyHeld(k.drift)) || pressed(p, PAD.R1) || pressed(p, PAD.R2);
    o.useItem = (!!k && anyHeld(k.item)) || pressed(p, PAD.L1) || pressed(p, PAD.L2);
    o.lookBack = (!!k && anyHeld(k.lookBack)) || pressed(p, PAD.X) || axis(p, 1) > 0.7;
    return o;
  }
}
