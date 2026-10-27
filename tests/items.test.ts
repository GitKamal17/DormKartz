import { describe, expect, it } from 'vitest';
import { PHYS, secondsToTicks } from '../src/sim/config';
import { rollItem } from '../src/sim/items';
import { ITEM_TYPES, type ItemType, type RaceState } from '../src/sim/types';
import { createRace, getTrack, input, multiConfig, place, run, skipCountdown, step } from './helpers';

const S = 20; // on Meadow Loop's long start straight

function setup(n = 2): RaceState {
  const st = createRace(multiConfig(n, 'meadow-loop', { items: true }), 7);
  skipCountdown(st);
  for (const k of st.karts) {
    k.lap = 1;
    k.nextCp = 0;
  }
  return st;
}

function give(st: RaceState, id: number, item: ItemType, count = 1): void {
  st.karts[id].item = item;
  st.karts[id].itemCount = count;
}

function tap(st: RaceState, id: number, extra: Record<string, unknown> = {}): void {
  step(st, new Map([[id, input({ useItem: true, ...extra })]]));
  step(st, new Map([[id, input({ ...extra })]]));
}

describe('items', () => {
  it('Zoom Pop gives an item boost and is consumed', () => {
    const st = setup(1);
    place(st, st.karts[0], S, 0, 10);
    give(st, 0, 'zoom');
    tap(st, 0);
    expect(st.karts[0].boostTicks).toBeGreaterThan(secondsToTicks(PHYS.itemBoostTime) - 3);
    expect(st.karts[0].item).toBeNull();
  });

  it('Triple Zoom has three uses', () => {
    const st = setup(1);
    place(st, st.karts[0], S, 0, 10);
    give(st, 0, 'tripleZoom', 3);
    tap(st, 0);
    expect(st.karts[0].itemCount).toBe(2);
    tap(st, 0);
    tap(st, 0);
    expect(st.karts[0].item).toBeNull();
  });

  it('Slick Peel spins out whoever drives into it', () => {
    const st = setup(2);
    const [a, b] = st.karts;
    place(st, a, S + 20, 0, 0);
    give(st, 0, 'peel');
    tap(st, 0);
    expect(st.peels.length).toBe(1);
    place(st, a, S + 60, 8, 0);
    place(st, b, S + 10, 0, 20);
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      step(st, new Map([[1, input({ throttle: 1 })]]));
      hit = st.events.some((e) => e.type === 'hit' && e.kart === 1 && e.hit === 'spin');
    }
    expect(hit).toBe(true);
    expect(st.peels.length).toBe(0);
  });

  it('Bounce Puck travels straight and knocks over the kart ahead', () => {
    const st = setup(2);
    const [a, b] = st.karts;
    place(st, a, S, 0, 0);
    place(st, b, S + 30, 0, 0);
    give(st, 0, 'bouncePuck');
    tap(st, 0);
    expect(st.projectiles.length).toBe(1);
    let hit = false;
    for (let i = 0; i < 90 && !hit; i++) {
      step(st, new Map());
      hit = st.events.some((e) => e.type === 'hit' && e.kart === 1 && e.hit === 'tumble');
    }
    expect(hit).toBe(true);
  });

  it('Bounce Puck ricochets off walls', () => {
    const st = setup(1);
    const k = st.karts[0];
    place(st, k, S, 0, 0);
    k.heading += 1.2; // aim at the side wall
    give(st, 0, 'bouncePuck');
    tap(st, 0);
    run(st, 40);
    expect(st.projectiles[0]?.bounces ?? 0).toBeGreaterThan(0);
  });

  it('Seeker Puck homes in on the kart one place ahead even off-line', () => {
    const st = setup(3);
    const [a, b, c] = st.karts;
    place(st, a, S, -8, 0);
    place(st, b, S + 40, 8, 0); // place 2: the target, offset to the side
    place(st, c, S + 90, 0, 0); // place 1
    step(st, new Map());
    expect(a.place).toBe(3);
    give(st, 0, 'seekerPuck');
    tap(st, 0);
    let hitKart = -1;
    for (let i = 0; i < 200 && hitKart < 0; i++) {
      step(st, new Map());
      const e = st.events.find((e) => e.type === 'hit');
      if (e && e.type === 'hit') hitKart = e.kart;
    }
    expect(hitKart).toBe(1);
  });

  it('a trailing item blocks a projectile and is used up', () => {
    const st = setup(2);
    const [a, b] = st.karts;
    place(st, a, S, 0, 0);
    place(st, b, S + 25, 0, 0);
    give(st, 1, 'peel');
    step(st, new Map([[1, input({ useItem: true })]]));
    expect(b.trailing).toBe('peel');
    give(st, 0, 'bouncePuck');
    let blocked = false, hit = false;
    step(st, new Map([[0, input({ useItem: true })], [1, input({ useItem: true })]]));
    for (let i = 0; i < 90 && !blocked && !hit; i++) {
      step(st, new Map([[1, input({ useItem: true })]]));
      blocked = st.events.some((e) => e.type === 'blocked');
      hit = st.events.some((e) => e.type === 'hit');
    }
    expect(blocked).toBe(true);
    expect(hit).toBe(false);
    expect(b.trailing).toBeNull();
  });

  it('Crown Comet hunts down the leader', () => {
    const st = setup(3);
    const [a, b, c] = st.karts;
    place(st, a, S, 0, 0);
    place(st, b, S + 30, -6, 0);
    place(st, c, S + 160, 4, 0);
    step(st, new Map());
    expect(c.place).toBe(1);
    give(st, 0, 'crownComet');
    tap(st, 0);
    let exploded = false, leaderHit = false, bHit = false;
    for (let i = 0; i < 400 && !exploded; i++) {
      step(st, new Map());
      for (const e of st.events) {
        if (e.type === 'explode') exploded = true;
        if (e.type === 'hit' && e.kart === 2) leaderHit = true;
        if (e.type === 'hit' && e.kart === 1) bHit = true;
      }
    }
    expect(exploded).toBe(true);
    expect(leaderHit).toBe(true);
    expect(bHit).toBe(false);
  });

  it('Supernova makes you invincible and faster, and flattens karts you hit', () => {
    const st = setup(2);
    const [a, b] = st.karts;
    place(st, a, S, 0, 20);
    place(st, b, S + 8, 0, 0);
    give(st, 0, 'supernova');
    tap(st, 0, { throttle: 1 });
    expect(a.starTicks).toBeGreaterThan(0);
    let hit = false;
    for (let i = 0; i < 60 && !hit; i++) {
      step(st, new Map([[0, input({ throttle: 1 })]]));
      hit = st.events.some((e) => e.type === 'hit' && e.kart === 1);
    }
    expect(hit).toBe(true);
    expect(a.hit).toBeNull();
  });

  it('Shrink Ray shrinks every opponent and takes their items', () => {
    const st = setup(4);
    st.karts.forEach((k, i) => place(st, k, S + i * 10, 0, 0));
    give(st, 2, 'zoom');
    give(st, 0, 'shrinkRay');
    tap(st, 0);
    expect(st.karts[0].shrinkTicks).toBe(0);
    for (const k of st.karts.slice(1)) expect(k.shrinkTicks).toBeGreaterThan(0);
    expect(st.karts[2].item).toBeNull();
  });

  it('item boxes hand out items with a roulette', () => {
    const st = setup(1);
    const k = st.karts[0];
    const box = getTrack(st.config.trackId).boxes[1];
    place(st, k, box.s - 12, box.d, 20);
    let got = false, ready = false;
    for (let i = 0; i < 200 && !ready; i++) {
      step(st, new Map([[0, input({ throttle: 1 })]]));
      for (const e of st.events) {
        if (e.type === 'itemGet') got = true;
        if (e.type === 'itemReady') ready = true;
      }
    }
    expect(got).toBe(true);
    expect(ready).toBe(true);
    expect(k.item).not.toBeNull();
    expect(st.boxes[1]).toBeGreaterThan(0);
  });

  it('gives stronger items further back', () => {
    const tally = (place: number) => {
      const h = { rng: 99 };
      const counts: Record<string, number> = {};
      for (let i = 0; i < 4000; i++) {
        const it = rollItem(h, place, 8, false);
        counts[it] = (counts[it] ?? 0) + 1;
      }
      return counts;
    };
    const first = tally(1), last = tally(8);
    expect(first.supernova ?? 0).toBe(0);
    expect(first.peel).toBeGreaterThan(1000);
    expect(last.supernova).toBeGreaterThan(800);
    expect(last.peel ?? 0).toBe(0);
    expect(ITEM_TYPES.length).toBe(8);
  });
});
