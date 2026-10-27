import { TRACKS } from '../src/sim/tracks';
import { getTrack } from '../src/sim/tracks';
const id = process.argv[2] ?? 'starlight-ribbon';
const t = getTrack(id);
console.log('length', t.length.toFixed(1));
for (let s = 0; s < t.length; s += 10) {
  const i = Math.round(s / t.ds) % t.n;
  console.log(`s=${s} y=${t.py[i].toFixed(1)} ty=${t.ty[i].toFixed(2)} curv=${t.curv[i].toFixed(4)} R=${(1/Math.abs(t.curv[i])).toFixed(0)} hw=${t.hw[i].toFixed(1)} lim=${t.limL[i].toFixed(1)}/${t.limR[i].toFixed(1)} slope=${t.slope[i].toFixed(2)} rl=${t.racingLine[i].toFixed(1)} gap=${t.gap[i]} ramp=${t.rampAt[i]}`);
}
void TRACKS;
