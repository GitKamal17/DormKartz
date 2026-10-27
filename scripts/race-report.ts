// Dev tool: runs a CPU-only race on every track and prints timings.
import { runHeadlessRace, cpuConfig } from '../src/game/headless';
import { TRACKS } from '../src/sim/tracks';
import { TICK_RATE } from '../src/sim/config';
import type { SpeedClass } from '../src/sim/types';

const cc = Number(process.argv[2] ?? 150) as SpeedClass;
const seed = Number(process.argv[3] ?? 1);
const only = process.argv[4];
for (const def of TRACKS) {
  if (only && !def.id.includes(only)) continue;
  const t0 = Date.now();
  const r = runHeadlessRace(cpuConfig(def.id, cc), seed);
  const done = r.state.karts.filter((k) => k.finished).length;
  const times = r.state.karts.filter((k) => k.finished).map((k) => ((k.finishTick - r.state.goTick) / TICK_RATE).toFixed(1));
  const laps = r.state.karts.map((k) => k.lapTimes.map((t) => (t / TICK_RATE).toFixed(1)).join('/')).slice(0, 3);
  console.log(`${def.id.padEnd(18)} finished ${done}/8 in ${((r.ticks - r.state.goTick) / TICK_RATE).toFixed(1)}s  falls ${r.falls} hits ${r.hits}  worstStall ${r.worstStall.seconds.toFixed(1)}s (kart ${r.worstStall.kart} @s=${r.worstStall.s.toFixed(0)})  times [${times.join(', ')}]  laps ${laps.join(' | ')}  (${Date.now() - t0}ms)`);
}
