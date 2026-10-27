import { describe, expect, it } from 'vitest';
import { packInput, quantize, unpackInput } from '../src/game/ghost';
import { RaceSession } from '../src/game/session';
import { AIInput } from '../src/input/ai';
import type { InputSource } from '../src/input/types';
import type { FrameInput } from '../src/sim/types';

describe('ghost input packing', () => {
  it('round-trips every quantized input exactly', () => {
    const out: FrameInput = { steer: 0, throttle: 0, brake: 0, drift: false, useItem: false, lookBack: false };
    for (let i = 0; i < 2000; i++) {
      const q = quantize(
        { steer: Math.sin(i) * 1.2, throttle: (i % 7) / 6, brake: (i % 5) / 4, drift: i % 3 === 0, useItem: i % 4 === 1, lookBack: i % 11 === 0 },
        { ...out },
      );
      expect(unpackInput(packInput(q), out)).toEqual(q);
    }
  });
});

describe('time trial ghost', () => {
  it('replaying the recorded best lap reproduces it tick for tick', () => {
    // A CPU drives the "human" slot so the run is reproducible.
    const driver: InputSource = new AIInput(0.9, 'ghost-test');
    const session = new RaceSession({
      trackId: 'meadow-loop',
      speedClass: 150,
      mode: 'tt',
      seed: 3,
      slots: [{ id: 0, kind: 'local', characterId: 'zip', input: driver, localIndex: 0 }],
    });
    while (!session.state.karts[0].finished && session.state.tick < 60 * 240) session.tick();
    const k = session.state.karts[0];
    expect(k.finished).toBe(true);
    const ghost = session.recorder!.best!;
    expect(ghost.lapTicks).toBe(Math.min(...k.lapTimes));

    // Replay with a second session that only runs the ghost.
    const replay = new RaceSession({
      trackId: 'meadow-loop',
      speedClass: 150,
      mode: 'tt',
      seed: 3,
      slots: [{ id: 0, kind: 'local', characterId: 'zip', input: new AIInput(0.9, 'other') }].map((s) => ({ ...s, localIndex: 0, kind: 'local' as const })),
      ghost,
    });
    replay.ghost!.restart();
    const startLap = replay.ghost!.state!.karts[0].lap;
    let ticks = 0;
    while (replay.ghost!.active) {
      replay.ghost!.step();
      ticks++;
    }
    const g = replay.ghost!.state!.karts[0];
    expect(ticks).toBe(ghost.lapTicks);
    expect(g.lap > startLap || g.finished).toBe(true);
    expect(g.lapTimes[g.lapTimes.length - 1]).toBe(ghost.lapTicks);
  });
});
