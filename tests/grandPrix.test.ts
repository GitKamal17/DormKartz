import { describe, expect, it } from 'vitest';
import { GrandPrix, POINTS } from '../src/game/grandPrix';

const racers = Array.from({ length: 8 }, (_, i) => ({ id: i, characterId: `c${i}`, local: i === 0 }));

describe('Grand Prix', () => {
  it('awards points by finishing position and ends after 4 races', () => {
    const gp = new GrandPrix('sprout', ['a', 'b', 'c', 'd'], 100, racers);
    expect(gp.trackId).toBe('a');
    gp.recordRace([3, 0, 1, 2, 4, 5, 6, 7]);
    expect(gp.points.get(3)).toBe(POINTS[0]);
    expect(gp.points.get(0)).toBe(POINTS[1]);
    expect(gp.trackId).toBe('b');
    gp.recordRace([0, 3, 1, 2, 4, 5, 6, 7]);
    gp.recordRace([0, 3, 1, 2, 4, 5, 6, 7]);
    expect(gp.done).toBe(false);
    gp.recordRace([0, 1, 3, 2, 4, 5, 6, 7]);
    expect(gp.done).toBe(true);
    const st = gp.standings();
    expect(st[0].id).toBe(0);
    expect(st[0].points).toBe(POINTS[1] + POINTS[0] * 3);
    expect(st.reduce((a, r) => a + r.points, 0)).toBe(POINTS.reduce((a, b) => a + b, 0) * 4);
  });

  it('starts the human at the back, then grids in reverse standings', () => {
    const gp = new GrandPrix('sprout', ['a', 'b', 'c', 'd'], 100, racers);
    const first = gp.gridOrder();
    expect(first[first.length - 1].local).toBe(true);
    gp.recordRace([0, 1, 2, 3, 4, 5, 6, 7]);
    const second = gp.gridOrder();
    expect(second[0].id).toBe(7);
    expect(second[second.length - 1].id).toBe(0);
  });
});
