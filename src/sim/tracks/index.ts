import { buildTrack, type Track } from '../track/build';
import type { TrackDef } from '../track/types';
import { duneRun } from './duneRun';
import { frostbitePass } from './frostbitePass';
import { harborBoardwalk } from './harborBoardwalk';
import { hollowManor } from './hollowManor';
import { magmaKeep } from './magmaKeep';
import { meadowLoop } from './meadowLoop';
import { neonAvenue } from './neonAvenue';
import { starlightRibbon } from './starlightRibbon';

/** All tracks in cup order. Adding a track = adding a data file and listing it here. */
export const TRACKS: readonly TrackDef[] = [
  meadowLoop,
  duneRun,
  harborBoardwalk,
  frostbitePass,
  hollowManor,
  neonAvenue,
  magmaKeep,
  starlightRibbon,
];

export const CUPS = [
  { id: 'sprout', name: 'Sprout Cup', tracks: TRACKS.filter((t) => t.cup === 'sprout').map((t) => t.id) },
  { id: 'ember', name: 'Ember Cup', tracks: TRACKS.filter((t) => t.cup === 'ember').map((t) => t.id) },
] as const;

const cache = new Map<string, Track>();

export function getTrackDef(id: string): TrackDef {
  const def = TRACKS.find((t) => t.id === id);
  if (!def) throw new Error(`Unknown track ${id}`);
  return def;
}

/** Built geometry for a track id. Built once and cached (pure function of the def). */
export function getTrack(id: string): Track {
  let t = cache.get(id);
  if (!t) {
    t = buildTrack(getTrackDef(id));
    cache.set(id, t);
  }
  return t;
}
