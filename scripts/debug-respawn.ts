import { AIInput } from '../src/input/ai';
import { cpuConfig } from '../src/game/headless';
import { createRace, step } from '../src/sim/race';
import { getTrack } from '../src/sim/tracks';
import { SPEED_CLASS } from '../src/sim/config';
import type { FrameInput } from '../src/sim/types';
const id = 'starlight-ribbon';
const cfg = cpuConfig(id, 150);
const st = createRace(cfg, 1);
const track = getTrack(id);
const skill = SPEED_CLASS[150].cpuSkill;
const ais = cfg.karts.map((k, i) => new AIInput(Math.min(1, skill + (i % 4) * 0.03), `1:${k.id}`));
const inputs = new Map<number, FrameInput>();
let watch = -1, until = 0, n = 0;
while (st.phase !== 'finished' && st.tick < 60 * 120) {
  cfg.karts.forEach((k, i) => inputs.set(k.id, { ...ais[i].poll({ state: st, track }, k.id) }));
  step(st, inputs);
  for (const e of st.events) if (e.type === 'respawn' && watch < 0 && n < 2) { watch = e.kart; until = st.tick + 150; n++; console.log('--- respawn kart', e.kart); }
  if (watch >= 0) {
    const k = st.karts[watch];
    const i = inputs.get(watch)!;
    if (st.tick % 4 === 0) console.log(`t${st.tick} s=${k.s.toFixed(1)} d=${k.d.toFixed(1)} y=${k.y.toFixed(1)} hdg=${k.heading.toFixed(2)} vx=${k.vx.toFixed(1)} vz=${k.vz.toFixed(1)} g=${k.grounded} fall=${k.fallTicks} hit=${k.hit} shrink=${k.shrinkTicks} in: st=${i.steer.toFixed(2)} th=${i.throttle} br=${i.brake} dr=${i.drift} item=${i.useItem} trail=${k.trailing} item=${k.item}`);
    if (st.tick > until || k.fallTicks > 0) { if (k.fallTicks > 0) console.log('FELL'); watch = -1; }
  }
}
