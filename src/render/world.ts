// Turns a built Track into Three.js meshes. Everything is generated from the
// track data, so a new track needs no rendering code.

import * as THREE from 'three';
import { SeededRandom } from '../sim/rng';
import { clamp, mod, smoothstep } from '../sim/math';
import { frameAt, groundHeight, inURange, newLoc, type Track } from '../sim/track/build';
import type { DecorationType, ThemeDef } from '../sim/track/types';
import { buildProp, islandGeometry, propTint } from './decor';
import {
  boostPadTexture,
  checkerTexture,
  itemBoxTexture,
  noiseTexture,
  roadTexture,
  stripeTexture,
  windowTexture,
} from './textures';

const loc = newLoc();

export interface World {
  root: THREE.Group;
  boxes: THREE.InstancedMesh;
  padTexture: THREE.Texture;
  liquid: THREE.Texture | null;
  sunLight: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  theme: ThemeDef;
  /** Terrain/ground height lookup used for blob shadows and effects. */
  dispose(): void;
}

interface StripOpts {
  yAdd?: (s: number, d: number) => number;
  include?: (i: number) => boolean;
  vScale?: number;
  color?: (s: number, u: number) => THREE.Color;
}

/** A ribbon following the track between lateral offsets dL(s) and dR(s). */
function strip(track: Track, s0: number, s1: number, step: number, dL: (s: number, i: number) => number, dR: (s: number, i: number) => number, o: StripOpts = {}): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const m = Math.max(1, Math.ceil((s1 - s0) / step));
  let prevOk = false;
  for (let k = 0; k <= m; k++) {
    const s = Math.min(s1, s0 + k * step);
    frameAt(track, s, loc);
    const i = loc.i;
    const ok = o.include ? o.include(i) : true;
    for (let side = 0; side < 2; side++) {
      const d = side === 0 ? dL(s, i) : dR(s, i);
      const y = loc.cy + d * track.slope[i] + (o.yAdd ? o.yAdd(s, d) : 0);
      pos.push(loc.cx + loc.rx * d, y, loc.cz + loc.rz * d);
      uv.push(side, s / (o.vScale ?? 12));
      if (o.color) {
        const c = o.color(s, side);
        col.push(c.r, c.g, c.b);
      }
    }
    if (k > 0 && ok && prevOk) {
      const a = (k - 1) * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    prevOk = ok;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (o.color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Vertical band at a lateral offset, from the surface up by h (negative h hangs down). */
function band(track: Track, side: 1 | -1, h: (i: number) => number, include: (i: number) => boolean, offset = 0, vScale = 4): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = track.n;
  for (let k = 0; k <= n; k++) {
    const i = k % n;
    const lim = (side > 0 ? track.limR[i] : track.limL[i]) + offset;
    const d = side * lim;
    const x = track.px[i] + track.rx[i] * d, z = track.pz[i] + track.rz[i] * d;
    const y = track.py[i] + d * track.slope[i];
    pos.push(x, y, z, x, y + h(i), z);
    const v = (k * track.ds) / vScale;
    uv.push(v, 0, v, 1);
    if (k > 0 && include(i) && include((k - 1) % n)) {
      const a = (k - 1) * 2;
      if (side > 0) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function lambert(params: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial(params);
}

function wallHeight(style: string): number {
  return { barrier: 1.1, fence: 1.4, rail: 0.9, stone: 1.8, neon: 1.0, ice: 1.3, rope: 0.9 }[style] ?? 1.1;
}

/** Height of terrain at (x, z) for tracks that sit on the ground. */
function makeTerrainFn(track: Track, theme: ThemeDef, baseY: number): (x: number, z: number) => number {
  // Coarse spatial hash of centerline samples for nearest-sample lookups.
  const cell = 24;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < track.n; i += 2) {
    const key = `${Math.floor(track.px[i] / cell)},${Math.floor(track.pz[i] / cell)}`;
    let a = grid.get(key);
    if (!a) grid.set(key, (a = []));
    a.push(i);
  }
  const amp = theme.ground === 'sand' ? 5 : theme.ground === 'snow' ? 4 : theme.ground === 'grass' ? 2.5 : 0.6;
  return (x: number, z: number) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    let best = Infinity, bi = -1;
    for (let r = 0; r <= 5 && (bi < 0 || r <= 2); r++) {
      for (let gx = cx - r; gx <= cx + r; gx++) {
        for (let gz = cz - r; gz <= cz + r; gz++) {
          if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) !== r) continue;
          const a = grid.get(`${gx},${gz}`);
          if (!a) continue;
          for (const i of a) {
            const d = (track.px[i] - x) ** 2 + (track.pz[i] - z) ** 2;
            if (d < best) {
              best = d;
              bi = i;
            }
          }
        }
      }
    }
    const noise = Math.sin(x * 0.031) * Math.cos(z * 0.027) + 0.5 * Math.sin(x * 0.07 + z * 0.05);
    const far = baseY + noise * amp;
    if (bi < 0) return far;
    const dist = Math.sqrt(best);
    const lim = Math.max(track.limL[bi], track.limR[bi]);
    const near = track.py[bi] - Math.abs(track.slope[bi]) * lim - 0.45;
    const t = smoothstep(lim + 2, lim + 55, dist);
    return near + (far - near) * t;
  };
}

export function buildWorld(track: Track): World {
  const def = track.def;
  const theme = def.theme;
  const root = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const add = <T extends THREE.Object3D>(o: T): T => {
    root.add(o);
    return o;
  };
  const mat = <T extends THREE.Material>(m: T): T => {
    disposables.push(m);
    return m;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T): T => {
    disposables.push(g);
    return g;
  };
  const tex = <T extends THREE.Texture>(t: T): T => {
    disposables.push(t);
    return t;
  };
  const L = track.length;
  const rainbow = theme.road === 'rainbow';
  const groundY = track.bounds.minY - theme.groundDepth;
  const onGround = theme.ground === 'grass' || theme.ground === 'sand' || theme.ground === 'snow' || theme.ground === 'city' || theme.ground === 'dirt';

  // --- Lights and sky -------------------------------------------------------
  const hemi = new THREE.HemisphereLight(theme.ambient, theme.groundColor, theme.ambientIntensity);
  add(hemi);
  const sun = new THREE.DirectionalLight(theme.sunColor, theme.sunIntensity);
  sun.position.set(...theme.sunDir).multiplyScalar(100);
  add(sun);

  const skyGeo = geo(new THREE.SphereGeometry(1600, 32, 16));
  const skyMat = mat(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(theme.skyTop) }, horizon: { value: new THREE.Color(theme.skyHorizon) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader:
        'uniform vec3 top; uniform vec3 horizon; varying vec3 vP; void main(){ float h = normalize(vP).y; float t = clamp(h*1.6+0.08,0.0,1.0); gl_FragColor = vec4(mix(horizon, top, pow(t,0.8)),1.0); }',
    }),
  );
  const sky = add(new THREE.Mesh(skyGeo, skyMat));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  sky.name = 'sky';
  if (theme.stars) {
    const r = new SeededRandom(def.id + 'stars');
    const pts: number[] = [];
    for (let i = 0; i < 900; i++) {
      const u = r.next() * 2 - 1, a = r.next() * Math.PI * 2;
      const y = Math.abs(u) * (r.next() < 0.85 ? 1 : -1);
      const rr = Math.sqrt(1 - y * y);
      pts.push(Math.cos(a) * rr * 1400, y * 1400, Math.sin(a) * rr * 1400);
    }
    const sg = geo(new THREE.BufferGeometry());
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const stars = add(new THREE.Points(sg, mat(new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false }))));
    stars.frustumCulled = false;
    stars.name = 'sky';
  }

  // --- Road and shoulders -----------------------------------------------------
  const notGap = (i: number) => track.gap[i] === 0;
  const roadTex = tex(roadTexture(theme.road, theme.roadColor, theme.lineColor));
  const hueAt = (s: number) => new THREE.Color().setHSL(mod(s / 70, 1), 0.9, 0.6);
  const roadGeo = geo(
    strip(track, 0, L, track.ds, (_s, i) => -track.hw[i], (_s, i) => track.hw[i], {
      include: notGap,
      vScale: 14,
      color: rainbow ? (s) => hueAt(s) : undefined,
    }),
  );
  const roadMat = rainbow
    ? mat(new THREE.MeshBasicMaterial({ map: roadTex, vertexColors: true, transparent: true, opacity: 0.92, side: THREE.DoubleSide }))
    : mat(lambert({ map: roadTex, side: THREE.DoubleSide }));
  add(new THREE.Mesh(roadGeo, roadMat)).name = 'road';

  const shoulderTex = tex(noiseTexture(theme.shoulderColor, 3, 0.15, 128));
  shoulderTex.repeat.set(1, 1);
  const shoulderMat = rainbow
    ? mat(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }))
    : mat(lambert({ map: shoulderTex, side: THREE.DoubleSide }));
  for (const side of [-1, 1] as const) {
    const g = geo(
      strip(
        track,
        0,
        L,
        track.ds,
        (_s, i) => (side < 0 ? -track.limL[i] : track.hw[i]),
        (_s, i) => (side < 0 ? -track.hw[i] : track.limR[i]),
        { include: notGap, vScale: 10, yAdd: () => -0.04 },
      ),
    );
    add(new THREE.Mesh(g, shoulderMat));
  }

  // Curbs on the inside of tight corners.
  const curbTex = tex(stripeTexture(0xffffff, theme.wallColor, 2));
  const curbMat = mat(lambert({ map: curbTex }));
  for (const side of [-1, 1] as const) {
    const inc = (i: number) => notGap(i) && track.curv[i] * side > 1 / 70 && (side > 0 ? track.limR[i] : track.limL[i]) - track.hw[i] > 1.2;
    const g = geo(
      strip(track, 0, L, track.ds, (_s, i) => (side < 0 ? -track.hw[i] - 1.1 : track.hw[i]), (_s, i) => (side < 0 ? -track.hw[i] : track.hw[i] + 1.1), {
        include: inc,
        vScale: 4,
        yAdd: () => 0.03,
      }),
    );
    add(new THREE.Mesh(g, curbMat));
  }

  // --- Walls -----------------------------------------------------------------
  const wh = wallHeight(theme.wallStyle);
  const wallTex =
    theme.wallStyle === 'barrier'
      ? tex(stripeTexture(0xffffff, theme.wallColor, 2))
      : theme.wallStyle === 'stone'
        ? tex(noiseTexture(theme.wallColor, 9, 0.25, 64))
        : null;
  if (wallTex) wallTex.rotation = Math.PI / 2;
  const wallMat =
    theme.wallStyle === 'neon'
      ? mat(new THREE.MeshBasicMaterial({ color: theme.wallColor, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }))
      : theme.wallStyle === 'ice'
        ? mat(lambert({ color: theme.wallColor, transparent: true, opacity: 0.7, side: THREE.DoubleSide }))
        : mat(lambert({ color: wallTex ? 0xffffff : theme.wallColor, map: wallTex ?? undefined, side: THREE.DoubleSide }));
  for (const side of [-1, 1] as const) {
    const has = (i: number) => (side > 0 ? track.wallR[i] : track.wallL[i]) === 1 && notGap(i);
    add(new THREE.Mesh(geo(band(track, side, () => wh, has, 0, 3)), wallMat)).name = 'wall';
  }
  // Open edges glow a little so you can see where the drop is.
  const edgeMat = mat(new THREE.MeshBasicMaterial({ color: rainbow ? 0xffffff : theme.lineColor, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  for (const side of [-1, 1] as const) {
    const open = (i: number) => (side > 0 ? track.wallR[i] : track.wallL[i]) === 0 && notGap(i);
    add(new THREE.Mesh(geo(band(track, side, () => 0.18, open, 0, 3)), edgeMat));
  }

  // --- Decks and supports for elevated roads --------------------------------
  if (!onGround) {
    const deckMat = mat(lambert({ color: theme.road === 'boards' || theme.road === 'wood' ? 0x5a3e28 : rainbow ? 0x8070ff : 0x4a4448, side: THREE.DoubleSide, transparent: rainbow, opacity: rainbow ? 0.5 : 1 }));
    const depth = rainbow ? 0.6 : 1.4;
    for (const side of [-1, 1] as const) add(new THREE.Mesh(geo(band(track, side, () => -depth, notGap, 0.01)), deckMat));
    add(new THREE.Mesh(geo(strip(track, 0, L, track.ds, (_s, i) => -track.limL[i], (_s, i) => track.limR[i], { include: notGap, yAdd: () => -depth })), deckMat));
    if (theme.ground === 'water' || theme.ground === 'lava') {
      const pillarGeo = geo(new THREE.CylinderGeometry(0.6, 0.7, 1, 6));
      const pillarMat = mat(lambert({ color: theme.ground === 'water' ? 0x6a4a30 : 0x3a3434 }));
      const spots: THREE.Matrix4[] = [];
      for (let s = 0; s < L; s += 20) {
        frameAt(track, s, loc);
        if (track.gap[loc.i]) continue;
        for (const side of [-1, 1]) {
          const d = side * (side > 0 ? track.limR[loc.i] : track.limL[loc.i]) * 0.85;
          const top = loc.cy + d * track.slope[loc.i] - depth;
          const h = top - groundY + 1;
          if (h < 0.5) continue;
          spots.push(new THREE.Matrix4().compose(new THREE.Vector3(loc.cx + loc.rx * d, groundY - 1 + h / 2, loc.cz + loc.rz * d), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)));
        }
      }
      const pillars = add(new THREE.InstancedMesh(pillarGeo, pillarMat, spots.length));
      spots.forEach((m, i) => pillars.setMatrixAt(i, m));
    }
  }

  // --- Ground -----------------------------------------------------------------
  let liquid: THREE.Texture | null = null;
  const b = track.bounds;
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  let terrainAt: ((x: number, z: number) => number) | null = null;
  if (onGround) {
    terrainAt = makeTerrainFn(track, theme, groundY);
    const size = span + 420;
    const res = Math.min(220, Math.round(size / 4.5));
    const tg = geo(new THREE.PlaneGeometry(size, size, res, res));
    tg.rotateX(-Math.PI / 2);
    const p = tg.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(p.count * 3);
    const base = new THREE.Color(theme.groundColor);
    const r = new SeededRandom(def.id + 'terrain');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + cx, z = p.getZ(i) + cz;
      const y = terrainAt(x, z);
      p.setXYZ(i, x, y, z);
      const f = 0.9 + r.next() * 0.16 + clamp((y - groundY) * 0.01, -0.1, 0.1);
      colors[i * 3] = base.r * f;
      colors[i * 3 + 1] = base.g * f;
      colors[i * 3 + 2] = base.b * f;
    }
    tg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    tg.computeVertexNormals();
    const groundTex = tex(noiseTexture(0xffffff, 5, 0.12, 128));
    groundTex.repeat.set(size / 16, size / 16);
    add(new THREE.Mesh(tg, mat(lambert({ vertexColors: true, map: groundTex })))).name = 'terrain';
    // Far skirt so the horizon never shows the edge of the terrain.
    const skirt = geo(new THREE.RingGeometry(size * 0.5, 2400, 48, 1));
    skirt.rotateX(-Math.PI / 2);
    const sk = add(new THREE.Mesh(skirt, mat(lambert({ color: base.clone().multiplyScalar(0.92) }))));
    sk.position.set(cx, groundY - 0.5, cz);
  } else if (theme.ground === 'water' || theme.ground === 'lava') {
    liquid = tex(noiseTexture(theme.groundColor, 11, theme.ground === 'lava' ? 0.35 : 0.12, 256));
    liquid.repeat.set(60, 60);
    const pg = geo(new THREE.PlaneGeometry(5000, 5000, 1, 1));
    pg.rotateX(-Math.PI / 2);
    const m =
      theme.ground === 'lava'
        ? mat(new THREE.MeshBasicMaterial({ map: liquid, color: 0xffffff }))
        : mat(lambert({ map: liquid, color: 0xffffff, transparent: true, opacity: 0.94 }));
    const water = add(new THREE.Mesh(pg, m));
    water.position.set(cx, groundY, cz);
    water.name = 'liquid';
  }

  // --- Start line and gantry ------------------------------------------------------
  const checker = tex(checkerTexture());
  const lineGeo = geo(strip(track, 0, 2.6, 0.65, (_s, i) => -track.hw[i], (_s, i) => track.hw[i], { yAdd: () => 0.03, vScale: 2.6 }));
  add(new THREE.Mesh(lineGeo, mat(new THREE.MeshLambertMaterial({ map: checker, polygonOffset: true, polygonOffsetFactor: -2 }))));
  {
    frameAt(track, 1.3, loc);
    // Posts stand outside the walls so they never sit on drivable ground.
    const postL = track.limL[loc.i] + 1.4, postR = track.limR[loc.i] + 1.4;
    const hw = (postL + postR) / 2;
    const postMat = mat(lambert({ color: 0xdddddd }));
    const postGeo = geo(new THREE.BoxGeometry(0.6, 9, 0.6));
    for (const d of [-postL, postR]) {
      const pm = add(new THREE.Mesh(postGeo, postMat));
      pm.position.set(loc.cx + loc.rx * d, loc.cy + d * track.slope[loc.i] + 3.5, loc.cz + loc.rz * d);
    }
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#1b1b2a';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#ffd23a';
    ctx.font = 'bold 44px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DORMKARTZ', 256, 34);
    const bannerTex = tex(new THREE.CanvasTexture(c));
    bannerTex.colorSpace = THREE.SRGBColorSpace;
    const banner = add(new THREE.Mesh(geo(new THREE.PlaneGeometry(hw * 2, 2.2)), mat(new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }))));
    const mid = (postR - postL) / 2;
    banner.position.set(loc.cx + loc.rx * mid, loc.cy + 7.4, loc.cz + loc.rz * mid);
    banner.rotation.y = Math.atan2(loc.tx, loc.tz) + Math.PI;
  }

  // --- Boost pads and ramps -------------------------------------------------------
  const padTexture = tex(boostPadTexture());
  const padMat = mat(new THREE.MeshBasicMaterial({ map: padTexture, polygonOffset: true, polygonOffsetFactor: -3 }));
  for (const p of track.pads) {
    const g = geo(strip(track, p.s - p.halfLen, p.s + p.halfLen, 0.5, () => p.d - p.halfW, () => p.d + p.halfW, { yAdd: () => 0.05, vScale: p.halfLen }));
    add(new THREE.Mesh(g, padMat));
  }
  const rampTex = tex(stripeTexture(0x222222, 0xffc21a, 6));
  rampTex.rotation = Math.PI / 2;
  const rampMat = mat(lambert({ map: rampTex, side: THREE.DoubleSide }));
  for (const r of track.ramps) {
    const s0 = r.sLip - r.len;
    const top = geo(strip(track, s0, r.sLip, 0.5, () => r.d - r.halfW, () => r.d + r.halfW, { yAdd: (s) => ((s - s0) / r.len) * r.height + 0.02, vScale: 2 }));
    add(new THREE.Mesh(top, rampMat));
    // Front face under the lip.
    frameAt(track, r.sLip, loc);
    const face = geo(new THREE.PlaneGeometry(r.halfW * 2, r.height));
    const fm = add(new THREE.Mesh(face, mat(lambert({ color: 0x333333, side: THREE.DoubleSide }))));
    fm.position.set(loc.cx + loc.rx * r.d, groundHeight(track, loc.s, r.d, loc.i, loc.cy) + r.height / 2, loc.cz + loc.rz * r.d);
    fm.rotation.y = Math.atan2(loc.tx, loc.tz);
  }

  // --- Quicksand / slow zones ---------------------------------------------------
  for (const z of track.slows) {
    const g = geo(strip(track, z.s0, z.s1, 1, () => z.dMin, () => z.dMax, { yAdd: () => 0.04, vScale: 6 }));
    const sandTex = tex(noiseTexture(0x8a5a2a, 21, 0.3, 64));
    add(new THREE.Mesh(g, mat(lambert({ map: sandTex, polygonOffset: true, polygonOffsetFactor: -2 })))).name = 'quicksand';
  }

  // --- Tunnels ------------------------------------------------------------------------
  if (def.tunnels?.length) {
    const roofMat = mat(lambert({ color: 0x22202e, side: THREE.DoubleSide }));
    const stripMat = mat(new THREE.MeshBasicMaterial({ color: 0x37f0ff, side: THREE.DoubleSide }));
    const H = 7.5;
    for (const t of def.tunnels) {
      const s0 = t.from * L;
      let s1 = t.to * L;
      if (s1 < s0) s1 += L;
      const outL = (_s: number, i: number) => -track.limL[i] - 0.6;
      const outR = (_s: number, i: number) => track.limR[i] + 0.6;
      add(new THREE.Mesh(geo(strip(track, s0, s1, 1, outL, outR, { yAdd: () => H })), roofMat));
      for (const side of [-1, 1]) {
        const at = side < 0 ? outL : outR;
        const pos: number[] = [], idx: number[] = [];
        let k = 0;
        for (let s = s0; s <= s1; s += 1, k++) {
          frameAt(track, s, loc);
          const d = at(s, loc.i);
          const y = loc.cy + d * track.slope[loc.i];
          const x = loc.cx + loc.rx * d, z = loc.cz + loc.rz * d;
          pos.push(x, y, z, x, y + H, z);
          if (k > 0) idx.push((k - 1) * 2, (k - 1) * 2 + 1, k * 2, (k - 1) * 2 + 1, k * 2 + 1, k * 2);
        }
        const g = geo(new THREE.BufferGeometry());
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        add(new THREE.Mesh(g, roofMat));
        const inner = (s: number, i: number) => at(s, i) - side * 0.5;
        add(new THREE.Mesh(geo(strip(track, s0, s1, 1, side < 0 ? at : inner, side < 0 ? inner : at, { yAdd: () => H - 0.15 })), stripMat));
      }
    }
  }

  // --- Item boxes ------------------------------------------------------------------------
  const boxTex = tex(itemBoxTexture());
  const boxes = add(
    new THREE.InstancedMesh(geo(new THREE.BoxGeometry(1.7, 1.7, 1.7)), mat(new THREE.MeshBasicMaterial({ map: boxTex, transparent: true, opacity: 0.88 })), Math.max(1, track.boxes.length)),
  );
  boxes.name = 'boxes';
  boxes.frustumCulled = false;

  // --- Props --------------------------------------------------------------------------------
  const snowy = theme.ground === 'snow';
  const solidMat = mat(lambert({ vertexColors: true }));
  const glowMat = mat(new THREE.MeshBasicMaterial({ vertexColors: true }));
  const windowMat = mat(new THREE.MeshBasicMaterial({ vertexColors: true, map: tex(windowTexture(7)) }));
  const islandMat = solidMat;
  const islands: THREE.Matrix4[] = [];
  const rand = new SeededRandom(def.id + 'props');
  const maxLim = (i: number) => Math.max(track.limL[i], track.limR[i]);
  const clearOfTrack = (x: number, z: number, y: number, margin: number) => {
    for (let i = 0; i < track.n; i += 2) {
      const dx = x - track.px[i], dz = z - track.pz[i];
      const r = maxLim(i) + margin;
      if (dx * dx + dz * dz < r * r && Math.abs(y - track.py[i]) < 14) return false;
    }
    return true;
  };
  for (const rule of def.decorations) {
    const parts = buildProp(rule.type as DecorationType, snowy);
    const mats: [THREE.BufferGeometry, THREE.Material][] = [];
    if (parts.solid) mats.push([geo(parts.solid), solidMat]);
    if (parts.glow) mats.push([geo(parts.glow), rule.type === 'building' ? windowMat : glowMat]);
    const matrices: THREE.Matrix4[] = [];
    const tints: (number | null)[] = [];
    const floating = rule.type === 'cloud' || rule.type === 'planet' || rule.type === 'crystal';
    let attempts = 0;
    while (matrices.length < rule.count && attempts < rule.count * 12) {
      attempts++;
      const s = rand.next() * L;
      if (rule.range && !inURange(s / L, rule.range)) continue;
      frameAt(track, s, loc);
      const i = loc.i;
      const side = rule.side === 'left' ? -1 : rule.side === 'right' ? 1 : rand.next() < 0.5 ? -1 : 1;
      const lim = side > 0 ? track.limR[i] : track.limL[i];
      const wallOff = (side > 0 ? track.wallR[i] : track.wallL[i]) ? 0.8 : 0.3;
      const off = lim + wallOff + rule.minOffset + rand.next() * (rule.maxOffset - rule.minOffset);
      const x = loc.cx + loc.rx * off * side, z = loc.cz + loc.rz * off * side;
      const scaleR = rule.scale ? rule.scale[0] + rand.next() * (rule.scale[1] - rule.scale[0]) : 0.8 + rand.next() * 0.45;
      let y: number;
      if (terrainAt) y = terrainAt(x, z) - 0.1;
      else if (theme.ground === 'water' || theme.ground === 'lava') y = rule.type === 'lamp' || rule.type === 'torch' ? loc.cy + side * off * 0 : groundY;
      else y = loc.cy - 1 + (floating ? (rand.next() - 0.3) * 40 : 0);
      if ((rule.type === 'lamp' || rule.type === 'torch' || rule.type === 'banner') && !terrainAt) {
        y = loc.cy + lim * side * track.slope[i];
      }
      if (rule.type === 'cloud' || rule.type === 'planet') y = loc.cy + (rule.type === 'planet' ? 40 : 4) + rand.next() * (rule.type === 'planet' ? 120 : 30) - (rule.type === 'cloud' ? 25 : 0);
      if (!clearOfTrack(x, z, y, rule.type === 'building' ? 7 : rule.type === 'planet' ? 60 : 1.5)) continue;
      const rot = rule.type === 'lamp' || rule.type === 'torch' || rule.type === 'neon' || rule.type === 'banner' ? Math.atan2(loc.tx, loc.tz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2) : rand.next() * Math.PI * 2;
      const sy = rule.type === 'building' ? scaleR * (0.6 + rand.next() * 0.8) : scaleR;
      const sxz = rule.type === 'building' ? 1 + rand.next() * 0.4 : scaleR;
      matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(sxz, sy, sxz)));
      tints.push(propTint(rule.type as DecorationType, rand.next()));
      if (theme.ground === 'void' && !floating) {
        islands.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(scaleR * 0.9, scaleR, scaleR * 0.9)));
      }
    }
    for (const [g, m] of mats) {
      const im = add(new THREE.InstancedMesh(g, m, Math.max(1, matrices.length)));
      im.count = matrices.length;
      matrices.forEach((mm, k) => {
        im.setMatrixAt(k, mm);
        const t = tints[k];
        if (t !== null) im.setColorAt(k, new THREE.Color(t));
        else if (tints.some((x) => x !== null)) im.setColorAt(k, new THREE.Color(0xffffff));
      });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }
  if (islands.length) {
    const ig = geo(islandGeometry());
    const im = add(new THREE.InstancedMesh(ig, islandMat, islands.length));
    islands.forEach((m, k) => im.setMatrixAt(k, m));
  }

  return {
    root,
    boxes,
    padTexture,
    liquid,
    sunLight: sun,
    hemi,
    theme,
    dispose() {
      for (const d of disposables) d.dispose();
      root.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
    },
  };
}
