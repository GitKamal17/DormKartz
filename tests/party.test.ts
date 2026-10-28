import { describe, expect, it } from 'vitest';
import { controlsFor, inputOptionsFor, KEYS_LEFT, KEYS_RIGHT, viewportRects, type PartyMember } from '../src/game/party';
import { DEFAULT_KEYS } from '../src/input/keyboard';

const m = (...devices: PartyMember['device'][]): PartyMember[] => devices.map((device) => ({ device, characterId: 'pip' }));

describe('party input assignment', () => {
  it('splits the keyboard only when two people share it', () => {
    const both = m('kb-left', 'kb-right');
    expect(inputOptionsFor('kb-left', both)).toEqual({ keys: KEYS_LEFT, pad: null });
    expect(inputOptionsFor('kb-right', both)).toEqual({ keys: KEYS_RIGHT, pad: null });
    // Alone on the keyboard you get the whole solo layout, plus I J K L if you joined from that side.
    expect(inputOptionsFor('kb-left', m('kb-left', 'pad-0'))).toEqual({ keys: DEFAULT_KEYS, pad: null });
    const solo = inputOptionsFor('kb-right', m('kb-right', 'pad-0')).keys!;
    expect(solo.throttle).toEqual(['ArrowUp', 'KeyW', 'KeyI']);
    expect(solo.drift).toEqual(['Space', 'Semicolon']);
    const codes = Object.values(solo).flat();
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives each gamepad its own index and no keys', () => {
    const party = m('pad-0', 'pad-2');
    expect(inputOptionsFor('pad-0', party)).toEqual({ keys: null, pad: 0 });
    expect(inputOptionsFor('pad-2', party)).toEqual({ keys: null, pad: 2 });
  });

  it('never gives two keyboard players the same key', () => {
    const all = (k: typeof KEYS_LEFT) => Object.values(k).flat();
    const left = new Set(all(KEYS_LEFT));
    for (const code of all(KEYS_RIGHT)) expect(left.has(code), code).toBe(false);
  });

  it('describes controls per device', () => {
    const both = m('kb-left', 'kb-right');
    const left = controlsFor('kb-left', both);
    expect(left.find((r) => r.action === 'Drift / hop')!.keys).toBe('Space');
    const right = controlsFor('kb-right', both);
    expect(right.find((r) => r.action === 'Steer')!.keys).toBe('J L');
    expect(right.find((r) => r.action === 'Accelerate')!.keys).toBe('I');
    expect(right.find((r) => r.action === 'Drift / hop')!.keys).toBe('; or Right Shift');
    expect(controlsFor('pad-1', both).find((r) => r.action === 'Accelerate')!.keys).toBe('A');
  });
});

describe('viewport layout', () => {
  it('splits 2 players top/bottom or side by side', () => {
    expect(viewportRects(2)).toEqual([{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }]);
    expect(viewportRects(2, true)).toEqual([{ x: 0, y: 0, w: 0.5, h: 1 }, { x: 0.5, y: 0, w: 0.5, h: 1 }]);
  });
});
