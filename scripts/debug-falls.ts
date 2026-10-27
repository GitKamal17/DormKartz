import { AIInput } from '../src/input/ai';
import { cpuConfig } from '../src/game/headless';
import { createRace, step } from '../src/sim/race';
import { getTrack } from '../src/sim/tracks';
import type { FrameInput } from '../src/sim/types';
const id = process.argv[2] ?? 'starlight-ribbon';
const cfg = cpuConfig(id, 150);
const st = createRace(cfg, 1);
const track = getTrack(id);
const ais = cfg.karts.map((k) => new AIInput(0.92, `1:${k.id}`));
const inputs = new Map<number, FrameInput>();
const counts = new Map<number, number>();
let printed = 0;
const hist: string[][] = cfg.karts.map(() => []);
while (st.phase !== 'finished' && st.tick < 60 * 200) {
  cfg.karts.forEach((k, i) => inputs.set(k.id, { ...ais[i].poll({ state: st, track }, k.id) }));
  step(st, inputs);
  for (const k of st.karts) {
    const inp = inputs.get(k.id)!;
    hist[k.id].push(`t${st.tick} s=${k.s.toFixed(1)} d=${k.d.toFixed(1)} y=${k.y.toFixed(1)} v=${Math.hypot(k.vx, k.vz).toFixed(1)} g=${k.grounded} drift=${k.drift} steer=${inp.steer.toFixed(2)} thr=${inp.throttle.toFixed(1)} brk=${inp.brake.toFixed(1)} hit=${k.hit} boost=${k.boostTicks}`);
    if (hist[k.id].length > 200) hist[k.id].shift();
  }
  for (const e of st.events) if (e.type === 'fall') {
    const k = st.karts[e.kart];
    const key = Math.round(k.s / 10) * 10;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (printed < 2 && k.s > 440 && k.s < 520) { printed++; console.log(`--- fall kart ${e.kart} at s=${k.s.toFixed(1)}`); console.log(hist[e.kart].slice(-200).filter((_, i) => i % 3 === 0).slice(-40).join('\n')); }
  }
}
console.log('falls by s:', [...counts.entries()].sort((a, b) => a[0] - b[0]));
console.log('L', track.length.toFixed(0), 'hw@478', track.hw[478].toFixed(1), 'lims', track.limL[478].toFixed(1), track.limR[478].toFixed(1), 'curv', track.curv[478].toFixed(4), 'rl', track.racingLine[478].toFixed(2));
