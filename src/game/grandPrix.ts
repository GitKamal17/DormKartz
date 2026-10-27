import type { PlayerId, SpeedClass } from '../sim/types';

export const POINTS = [15, 12, 10, 8, 6, 4, 2, 1];

export interface Racer {
  id: PlayerId;
  characterId: string;
  local: boolean;
}

export class GrandPrix {
  raceIndex = 0;
  readonly points = new Map<PlayerId, number>();
  readonly lastRace: { id: PlayerId; place: number; gained: number }[] = [];

  constructor(
    readonly cupId: string,
    readonly trackIds: readonly string[],
    readonly cc: SpeedClass,
    readonly racers: Racer[],
  ) {
    for (const r of racers) this.points.set(r.id, 0);
  }

  get trackId(): string {
    return this.trackIds[this.raceIndex];
  }

  get done(): boolean {
    return this.raceIndex >= this.trackIds.length;
  }

  /** Grid for the next race: first race the humans start at the back; after that, reverse standings. */
  gridOrder(): Racer[] {
    if (this.raceIndex === 0) return [...this.racers.filter((r) => !r.local), ...this.racers.filter((r) => r.local)];
    return [...this.standings()].reverse().map((s) => this.racers.find((r) => r.id === s.id)!);
  }

  recordRace(order: PlayerId[]): void {
    this.lastRace.length = 0;
    order.forEach((id, i) => {
      const gained = POINTS[i] ?? 0;
      this.points.set(id, (this.points.get(id) ?? 0) + gained);
      this.lastRace.push({ id, place: i + 1, gained });
    });
    this.raceIndex++;
  }

  standings(): { id: PlayerId; points: number; characterId: string; local: boolean }[] {
    const last = new Map(this.lastRace.map((r) => [r.id, r.place]));
    return this.racers
      .map((r) => ({ id: r.id, points: this.points.get(r.id) ?? 0, characterId: r.characterId, local: r.local }))
      .sort((a, b) => b.points - a.points || (last.get(a.id) ?? 9) - (last.get(b.id) ?? 9));
  }
}
