// Low-poly props built from primitives. Each prop is merged into one geometry
// with vertex colors so a whole forest is a single instanced draw call.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DecorationType } from '../sim/track/types';

export interface PropParts {
  /** Lit by the scene lights. */
  solid: THREE.BufferGeometry | null;
  /** Self-lit (windows, flames, neon). */
  glow: THREE.BufferGeometry | null;
}

type Part = [THREE.BufferGeometry, number];

function paint(g: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}

function at(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(...s),
  );
  g.applyMatrix4(m);
  return g;
}

function merge(parts: Part[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  const geos = parts.map(([g, c]) => paint(g, c));
  const out = mergeGeometries(geos, false);
  out.computeVertexNormals();
  return out;
}

const cyl = (rt: number, rb: number, h: number, seg = 7) => new THREE.CylinderGeometry(rt, rb, h, seg);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const ball = (r: number, d = 1) => new THREE.IcosahedronGeometry(r, d);
const cone = (r: number, h: number, seg = 7) => new THREE.ConeGeometry(r, h, seg);

export function buildProp(type: DecorationType, snowy: boolean): PropParts {
  const solid: Part[] = [];
  const glow: Part[] = [];
  switch (type) {
    case 'tree':
      solid.push([at(cyl(0.35, 0.5, 3), 0, 1.5, 0), 0x7a5230]);
      solid.push([at(ball(2.4, 1), 0, 4.4, 0, 0, 0, 0, [1, 0.9, 1]), 0x3f9a3a]);
      solid.push([at(ball(1.6, 1), 1.1, 5.4, 0.4), 0x4fb045]);
      break;
    case 'pine':
      solid.push([at(cyl(0.3, 0.4, 2), 0, 1, 0), 0x6a4528]);
      solid.push([at(cone(2.4, 4.2), 0, 3.6, 0), 0x2f6f3a]);
      solid.push([at(cone(1.8, 3.4), 0, 5.4, 0), 0x357a40]);
      if (snowy) solid.push([at(cone(1.0, 1.6), 0, 6.8, 0), 0xffffff]);
      break;
    case 'bush':
      solid.push([at(ball(1.2, 1), 0, 0.8, 0, 0, 0, 0, [1.3, 0.8, 1]), 0x3d8c35]);
      break;
    case 'flower':
      solid.push([at(cyl(0.05, 0.05, 0.6, 4), 0, 0.3, 0), 0x3a8a30]);
      solid.push([at(ball(0.28, 0), 0, 0.7, 0), 0xffffff]);
      break;
    case 'cactus':
      solid.push([at(cyl(0.55, 0.6, 4.5), 0, 2.25, 0), 0x3f8f4a]);
      solid.push([at(cyl(0.3, 0.3, 1.6), 0.9, 2.4, 0, 0, 0, Math.PI / 2), 0x3f8f4a]);
      solid.push([at(cyl(0.3, 0.3, 1.5), 1.55, 3.0, 0), 0x3f8f4a]);
      solid.push([at(cyl(0.28, 0.28, 1.2), -0.8, 3.0, 0, 0, 0, Math.PI / 2), 0x3f8f4a]);
      solid.push([at(cyl(0.28, 0.28, 1.2), -1.35, 3.5, 0), 0x3f8f4a]);
      break;
    case 'rock':
      solid.push([at(new THREE.DodecahedronGeometry(1.2, 0), 0, 0.5, 0, 0.3, 0.5, 0, [1.3, 0.8, 1]), snowy ? 0xb8c0cc : 0x8a8580]);
      break;
    case 'palm':
      for (let i = 0; i < 5; i++) solid.push([at(cyl(0.28, 0.34, 1.6), i * 0.18, 0.8 + i * 1.5, 0, 0, 0, -0.12), 0x9a7448]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        solid.push([at(box(3.4, 0.08, 0.9), Math.cos(a) * 1.6 + 0.9, 8.1, Math.sin(a) * 1.6, 0, -a, -0.35), 0x3c9a3a]);
      }
      break;
    case 'lamp':
      solid.push([at(cyl(0.12, 0.15, 6), 0, 3, 0), 0x555a66]);
      solid.push([at(box(1.6, 0.15, 0.3), -0.7, 6, 0), 0x555a66]);
      glow.push([at(box(0.7, 0.25, 0.5), -1.3, 5.85, 0), 0xfff2b0]);
      break;
    case 'building':
      solid.push([at(box(8, 1, 8), 0, 0.5, 0), 0x2a2838]);
      glow.push([at(box(7.6, 20, 7.6), 0, 10.5, 0), 0xffffff]);
      solid.push([at(box(8.2, 0.6, 8.2), 0, 20.8, 0), 0x2a2838]);
      break;
    case 'torch':
      solid.push([at(cyl(0.12, 0.16, 2.6), 0, 1.3, 0), 0x4a3a2a]);
      solid.push([at(cyl(0.35, 0.2, 0.4), 0, 2.7, 0), 0x3a3a3a]);
      glow.push([at(cone(0.3, 0.9, 5), 0, 3.3, 0), 0xffa030]);
      break;
    case 'crystal':
      glow.push([at(new THREE.OctahedronGeometry(1.2, 0), 0, 1.8, 0, 0, 0, 0, [0.7, 1.8, 0.7]), 0x9ad8ff]);
      glow.push([at(new THREE.OctahedronGeometry(0.7, 0), 0.9, 1.0, 0.3, 0.3, 0, 0.4, [0.7, 1.6, 0.7]), 0xd59aff]);
      break;
    case 'cloud':
      glow.push([at(ball(2.2, 1), 0, 0, 0), 0xffffff]);
      glow.push([at(ball(1.7, 1), 2.2, -0.3, 0.4), 0xffffff]);
      glow.push([at(ball(1.6, 1), -2.0, -0.4, -0.3), 0xffffff]);
      break;
    case 'snowman':
      solid.push([at(ball(1.1, 1), 0, 1.0, 0), 0xffffff]);
      solid.push([at(ball(0.8, 1), 0, 2.6, 0), 0xffffff]);
      solid.push([at(ball(0.55, 1), 0, 3.7, 0), 0xffffff]);
      solid.push([at(cone(0.12, 0.6, 5), 0, 3.7, 0.65, Math.PI / 2), 0xff8a20]);
      solid.push([at(cyl(0.45, 0.45, 0.5), 0, 4.3, 0), 0x222222]);
      break;
    case 'house':
      solid.push([at(box(5, 3.5, 5), 0, 1.75, 0), 0xf2e6d0]);
      solid.push([at(cone(4.2, 2.6, 4), 0, 4.8, 0, 0, Math.PI / 4), 0xc0503a]);
      glow.push([at(box(1, 1, 0.1), 1.2, 2, 2.52), 0xffe8a0]);
      break;
    case 'pillar':
      solid.push([at(cyl(0.9, 1.0, 7, 8), 0, 3.5, 0), 0x9a928a]);
      solid.push([at(box(2.4, 0.6, 2.4), 0, 7.2, 0), 0x8a827a]);
      solid.push([at(box(2.4, 0.6, 2.4), 0, 0.3, 0), 0x8a827a]);
      break;
    case 'tombstone':
      solid.push([at(box(1.2, 1.6, 0.35), 0, 0.8, 0, 0, 0, 0.08), 0x77758a]);
      solid.push([at(cyl(0.6, 0.6, 0.35, 10), 0, 1.6, 0, Math.PI / 2), 0x77758a]);
      break;
    case 'deadtree':
      solid.push([at(cyl(0.25, 0.45, 5), 0, 2.5, 0, 0, 0, 0.1), 0x3a2e2a]);
      solid.push([at(cyl(0.12, 0.2, 2.6), 0.9, 4.2, 0, 0, 0, -0.8), 0x3a2e2a]);
      solid.push([at(cyl(0.1, 0.18, 2.2), -0.8, 3.6, 0.2, 0.2, 0, 0.9), 0x3a2e2a]);
      break;
    case 'buoy':
      solid.push([at(cyl(0.5, 0.7, 1.4, 8), 0, 0.4, 0), 0xe23a2a]);
      solid.push([at(cyl(0.52, 0.52, 0.3, 8), 0, 0.9, 0), 0xffffff]);
      glow.push([at(ball(0.2, 0), 0, 1.4, 0), 0xffe060]);
      break;
    case 'neon':
      solid.push([at(cyl(0.12, 0.12, 6), 0, 3, 0), 0x333344]);
      glow.push([at(box(3, 1.4, 0.2), 0, 6.2, 0), 0xff4fd8]);
      glow.push([at(box(2.4, 0.3, 0.25), 0, 6.2, 0), 0x4ff0ff]);
      break;
    case 'banner':
      solid.push([at(cyl(0.1, 0.1, 5), 0, 2.5, 0), 0xdddddd]);
      solid.push([at(box(0.08, 2.2, 1.6), 0, 3.6, 0.85), 0xffffff]);
      break;
    case 'planet':
      glow.push([at(ball(1, 2), 0, 0, 0), 0xffffff]);
      glow.push([at(new THREE.TorusGeometry(1.7, 0.08, 4, 32), 0, 0, 0, 1.2, 0, 0.3), 0xffffff]);
      break;
  }
  return { solid: merge(solid), glow: merge(glow) };
}

/** A floating rock under props on tracks with no ground. */
export function islandGeometry(): THREE.BufferGeometry {
  return merge([
    [at(cone(2.6, 4, 6), 0, -2.1, 0, Math.PI, 0, 0), 0x4a4052],
    [at(cyl(2.6, 2.6, 0.4, 6), 0, -0.15, 0), 0x3a5a3a],
  ])!;
}

/** Per-instance tint for props that come in many colors. */
export function propTint(type: DecorationType, r: number): number | null {
  if (type === 'flower') return [0xff5a7a, 0xffd23a, 0xa070ff, 0xffffff, 0xff8a3a][Math.floor(r * 5)];
  if (type === 'banner') return [0xe84a3c, 0x3a8dde, 0xf5c518, 0x4fb045][Math.floor(r * 4)];
  if (type === 'building') return [0xffd27a, 0x7af0ff, 0xff7ad9, 0xfff4c8][Math.floor(r * 4)];
  if (type === 'planet') return [0xff9a5a, 0x7ac8ff, 0xd09aff, 0x9affc8][Math.floor(r * 4)];
  if (type === 'crystal') return [0x9ad8ff, 0xd59aff, 0x9affd5][Math.floor(r * 3)];
  if (type === 'tree') return [0xffffff, 0xd8f0c0, 0xc8e8a0][Math.floor(r * 3)];
  return null;
}
