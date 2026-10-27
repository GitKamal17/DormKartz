// Dev tool: renders every track layout to an SVG so layouts can be checked by eye.
// Usage: npm run plot  (writes plots/<id>.svg and plots/index.html)
import { mkdirSync, writeFileSync } from 'node:fs';
import { TRACKS } from '../src/sim/tracks';
import { buildTrack, worldAt } from '../src/sim/track/build';
import { PATH_ERRORS } from '../src/sim/track/path';

mkdirSync('plots', { recursive: true });
let html = '<html><body style="background:#222;color:#eee;font-family:sans-serif">';
for (const def of TRACKS) {
  const t = buildTrack(def);
  const b = t.bounds;
  const pad = 10;
  const w = b.maxX - b.minX + pad * 2, h = b.maxZ - b.minZ + pad * 2;
  const X = (x: number) => (b.maxX + pad - x).toFixed(1); // mirror so right turns look right-handed from above
  const Z = (z: number) => (b.maxZ + pad - z).toFixed(1);
  const parts: string[] = [];
  const line = (pts: [number, number][], stroke: string, width: number, extra = '') =>
    parts.push(`<polyline fill="none" stroke="${stroke}" stroke-width="${width}" ${extra} points="${pts.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}"/>`);
  const edge = (side: 1 | -1) => {
    let cur: [number, number][] = [];
    let curWall = -1;
    for (let j = 0; j <= t.n; j++) {
      const i = j % t.n;
      const lim = side > 0 ? t.limR[i] : t.limL[i];
      const wall = (side > 0 ? t.wallR[i] : t.wallL[i]) && !t.gap[i] ? 1 : t.gap[i] ? 2 : 0;
      const p: [number, number] = [t.px[i] + t.rx[i] * lim * side, t.pz[i] + t.rz[i] * lim * side];
      if (wall !== curWall && cur.length) {
        cur.push(p);
        line(cur, curWall === 1 ? '#ddd' : curWall === 2 ? '#29f' : '#f44', 1.2, curWall === 0 ? 'stroke-dasharray="3 2"' : '');
        cur = [];
      }
      curWall = wall;
      cur.push(p);
    }
    line(cur, curWall === 1 ? '#ddd' : curWall === 2 ? '#29f' : '#f44', 1.2);
  };
  // road
  const road: [number, number][] = [];
  for (let j = 0; j <= t.n; j++) { const i = j % t.n; road.push([t.px[i], t.pz[i]]); }
  let roadW = 0; for (let i = 0; i < t.n; i++) roadW += t.hw[i]; roadW = (roadW / t.n) * 2;
  line(road, '#555', roadW);
  edge(1); edge(-1);
  const rl: [number, number][] = [];
  for (let j = 0; j <= t.n; j += 2) { const i = j % t.n; rl.push([t.px[i] + t.rx[i] * t.racingLine[i], t.pz[i] + t.rz[i] * t.racingLine[i]]); }
  line(rl, '#ff0', 0.6);
  for (let i = 0; i < t.n; i += 1) if (t.gap[i]) parts.push(`<circle cx="${X(t.px[i])}" cy="${Z(t.pz[i])}" r="3" fill="#29f"/>`);
  for (const r of t.ramps) { const p = worldAt(t, r.sLip, r.d); parts.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="3" fill="#f0f"/>`); }
  for (const pd of t.pads) { const p = worldAt(t, pd.s, pd.d); parts.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="2.5" fill="#0ff"/>`); }
  for (const bx of t.boxes) parts.push(`<circle cx="${X(bx.x)}" cy="${Z(bx.z)}" r="1.5" fill="#fa0"/>`);
  for (const g of t.grid) parts.push(`<circle cx="${X(g.x)}" cy="${Z(g.z)}" r="1.2" fill="#0f0"/>`);
  for (const hz of t.hazards) {
    if ('s' in hz) { const p = worldAt(t, hz.s, 'd' in hz ? hz.d : 0); parts.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="3" fill="none" stroke="#f00" stroke-width="1.5"/>`); }
  }
  for (const z of t.slows) { const p = worldAt(t, (z.s0 + z.s1) / 2, (z.dMin + z.dMax) / 2); parts.push(`<circle cx="${X(p.x)}" cy="${Z(p.z)}" r="${(z.dMax - z.dMin) / 2}" fill="#a62" opacity="0.7"/>`); }
  const s0 = worldAt(t, 0, 0);
  parts.push(`<circle cx="${X(s0.x)}" cy="${Z(s0.z)}" r="4" fill="#fff"/>`);
  for (let k = 0; k < t.checkpoints.length; k++) { const p = worldAt(t, t.checkpoints[k], 0); parts.push(`<text x="${X(p.x)}" y="${Z(p.z)}" fill="#8f8" font-size="6">${k}</text>`); }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(w * 1.4).toFixed(0)}" height="${(h * 1.4).toFixed(0)}" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" style="background:#1a2a1a">${parts.join('')}</svg>`;
  writeFileSync(`plots/${def.id}.svg`, svg);
  let minR = Infinity; for (let i = 0; i < t.n; i++) if (Math.abs(t.curv[i]) > 1e-4) minR = Math.min(minR, 1 / Math.abs(t.curv[i]));
  html += `<h3>${def.name} — length ${t.length.toFixed(0)}, y ${b.minY.toFixed(0)}..${b.maxY.toFixed(0)}, min radius ${minR.toFixed(1)}</h3>${svg}`;
}
writeFileSync('plots/index.html', html + '</body></html>');
console.log('wrote plots/');
for (const e of PATH_ERRORS) console.log('LAYOUT ERROR', e);
