import { AIInput } from '../src/input/ai';
import { cpuConfig } from '../src/game/headless';
import { createRace, step } from '../src/sim/race';
import { getTrack } from '../src/sim/tracks';
import { SPEED_CLASS } from '../src/sim/config';
import type { FrameInput } from '../src/sim/types';
const id = process.argv[2] ?? 'starlight-ribbon';
const items = process.argv[3] !== 'noitems';
const cfg = { ...cpuConfig(id, 150), items };
const st = createRace(cfg, 1);
const track = getTrack(id);
const skill = SPEED_CLASS[150].cpuSkill;
const ais = cfg.karts.map((k, i) => new AIInput(Math.min(1, skill + (i % 4) * 0.03), `1:${k.id}`));
const inputs = new Map<number, FrameInput>();
const lastHit = new Map<number, number>();
const lastDrift = new Map<number, number>();
const lastBump = new Map<number, number>();
const lastRespawn = new Map<number, number>();
const causes: Record<string, number> = {};
const where: string[] = [];
while (st.phase !== 'finished' && st.tick < 60 * 300) {
  cfg.karts.forEach((k, i) => inputs.set(k.id, ais[i].poll({ state: st, track }, k.id)));
  step(st, inputs);
  for (const k of st.karts) if (k.drift !== 0) lastDrift.set(k.id, st.tick);
  for (const e of st.events) {
    if (e.type === 'hit') lastHit.set(e.kart, st.tick);
    if (e.type === 'bump') { lastBump.set(e.kart, st.tick); lastBump.set(e.other, st.tick); }
    if (e.type === 'respawn') lastRespawn.set(e.kart, st.tick);
    if (e.type === 'fall') {
      const k = st.karts[e.kart];
      const since = (m: Map<number, number>) => st.tick - (m.get(e.kart) ?? -9999);
      const c = since(lastHit) < 150 ? 'hit' : since(lastBump) < 90 ? 'bump' : since(lastRespawn) < 300 ? 'after-respawn' : since(lastDrift) < 60 ? 'drift' : 'driving';
      causes[c] = (causes[c] ?? 0) + 1;
      where.push(`${c}@${Math.round(k.lastSafeS)}`);
    }
  }
}
console.log(causes);
console.log(where.join(' '));
console.log('finished', st.karts.filter((k) => k.finished).length, 'tick', st.tick);
