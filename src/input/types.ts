import type { Track } from '../sim/track/build';
import type { FrameInput, PlayerId, RaceState } from '../sim/types';

/** Read-only view of the race an input source may inspect (only the AI does). */
export interface RaceView {
  state: RaceState;
  track: Track;
}

/**
 * Anything that can drive a kart: keyboard, gamepad, CPU, and later a network
 * peer. The simulation only ever sees the FrameInput it returns.
 */
export interface InputSource {
  readonly kind: 'keyboard' | 'gamepad' | 'local' | 'ai' | 'replay' | 'remote';
  poll(view: RaceView, id: PlayerId): FrameInput;
  dispose?(): void;
}

export function blankInput(): FrameInput {
  return { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false, lookBack: false };
}
