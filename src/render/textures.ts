// Procedural canvas textures. No image files: everything is drawn at startup.

import * as THREE from 'three';
import { SeededRandom } from '../sim/rng';
import type { RoadStyle } from '../sim/track/types';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function shade(c: number, f: number): string {
  const r = Math.min(255, Math.max(0, ((c >> 16) & 255) * f));
  const g = Math.min(255, Math.max(0, ((c >> 8) & 255) * f));
  const b = Math.min(255, Math.max(0, (c & 255) * f));
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function toTexture(c: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, base: number, n: number, spread: number, seed: number): void {
  const r = new SeededRandom(seed);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = shade(base, 1 + r.range(-spread, spread));
    const s = r.range(1, 3);
    ctx.fillRect(r.range(0, w), r.range(0, h), s, s);
  }
}

/** Road surface. u runs across the road (0 = left edge), v along it. */
export function roadTexture(style: RoadStyle, color: number, line: number): THREE.CanvasTexture {
  const W = 256, H = 256;
  const [c, ctx] = canvas(W, H);
  ctx.fillStyle = hex(color);
  ctx.fillRect(0, 0, W, H);
  const r = new SeededRandom(style);
  switch (style) {
    case 'asphalt':
    case 'neon':
      speckle(ctx, W, H, color, 3000, 0.18, 1);
      ctx.fillStyle = hex(line);
      ctx.globalAlpha = style === 'neon' ? 1 : 0.9;
      ctx.fillRect(5, 0, 5, H);
      ctx.fillRect(W - 10, 0, 5, H);
      ctx.fillRect(W / 2 - 3, 0, 6, H * 0.45);
      ctx.globalAlpha = 1;
      break;
    case 'sand':
      for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = shade(color, r.range(0.85, 1.15));
        ctx.lineWidth = r.range(2, 6);
        ctx.beginPath();
        const y = r.range(0, H);
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(W / 3, y + r.range(-10, 10), (2 * W) / 3, y + r.range(-10, 10), W, y);
        ctx.stroke();
      }
      speckle(ctx, W, H, color, 1500, 0.2, 2);
      ctx.fillStyle = hex(line);
      ctx.globalAlpha = 0.5;
      ctx.fillRect(4, 0, 4, H);
      ctx.fillRect(W - 8, 0, 4, H);
      ctx.globalAlpha = 1;
      break;
    case 'wood':
    case 'boards': {
      const planks = style === 'boards' ? 8 : 10;
      for (let i = 0; i < planks; i++) {
        const y = (i * H) / planks;
        ctx.fillStyle = shade(color, r.range(0.8, 1.15));
        ctx.fillRect(0, y, W, H / planks - 2);
        ctx.fillStyle = shade(color, 0.45);
        ctx.fillRect(0, y + H / planks - 2, W, 2);
        for (let g = 0; g < 6; g++) {
          ctx.fillStyle = shade(color, r.range(0.7, 0.9));
          ctx.fillRect(r.range(0, W), y + r.range(2, H / planks - 4), r.range(20, 80), 1);
        }
        ctx.fillStyle = shade(color, 0.4);
        ctx.fillRect(r.range(10, 40), y + 4, 3, 3);
        ctx.fillRect(r.range(W - 40, W - 10), y + 4, 3, 3);
      }
      break;
    }
    case 'ice':
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${r.range(0.1, 0.4)})`;
        ctx.lineWidth = r.range(1, 3);
        ctx.beginPath();
        const x = r.range(0, W), y = r.range(0, H);
        ctx.moveTo(x, y);
        ctx.lineTo(x + r.range(-40, 40), y + r.range(10, 60));
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(4, 0, 4, H);
      ctx.fillRect(W - 8, 0, 4, H);
      break;
    case 'stone': {
      const rows = 8, cols = 6;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          ctx.fillStyle = shade(color, r.range(0.75, 1.2));
          const off = y % 2 ? W / cols / 2 : 0;
          ctx.fillRect(x * (W / cols) + off + 2, y * (H / rows) + 2, W / cols - 4, H / rows - 4);
        }
      }
      ctx.fillStyle = hex(line);
      ctx.globalAlpha = 0.6;
      ctx.fillRect(3, 0, 4, H);
      ctx.fillRect(W - 7, 0, 4, H);
      ctx.globalAlpha = 1;
      break;
    }
    case 'rainbow':
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = `rgba(255,255,255,${i % 2 ? 0.0 : 0.25})`;
        ctx.fillRect(0, (i * H) / 6, W, H / 6);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, 8, H);
      ctx.fillRect(W - 8, 0, 8, H);
      break;
  }
  return toTexture(c, false);
}

export function noiseTexture(color: number, seed: number, spread = 0.12, size = 256): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size);
  ctx.fillStyle = hex(color);
  ctx.fillRect(0, 0, size, size);
  speckle(ctx, size, size, color, size * 30, spread, seed);
  return toTexture(c);
}

export function checkerTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 32);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 4; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#fff';
      ctx.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const t = toTexture(c, false);
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function boostPadTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 128);
  ctx.fillStyle = '#ff7a00';
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = '#ffe14a';
  for (let i = 0; i < 2; i++) {
    const y = i * 64;
    ctx.beginPath();
    ctx.moveTo(8, y + 44);
    ctx.lineTo(32, y + 14);
    ctx.lineTo(56, y + 44);
    ctx.lineTo(56, y + 58);
    ctx.lineTo(32, y + 28);
    ctx.lineTo(8, y + 58);
    ctx.closePath();
    ctx.fill();
  }
  return toTexture(c);
}

export function itemBoxTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(128, 128);
  const g = ctx.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, '#ff6ad5');
  g.addColorStop(0.5, '#6ad1ff');
  g.addColorStop(1, '#ffe36a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, 120, 120);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 84px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 64, 70);
  return toTexture(c, false);
}

export function stripeTexture(a: number, b: number, stripes = 8): THREE.CanvasTexture {
  const [c, ctx] = canvas(16, 64);
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = hex(i % 2 ? a : b);
    ctx.fillRect(0, (i * 64) / stripes, 16, 64 / stripes);
  }
  return toTexture(c);
}

export function windowTexture(seed: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 128);
  ctx.fillStyle = '#1a1830';
  ctx.fillRect(0, 0, 64, 128);
  const r = new SeededRandom(seed);
  const colors = ['#ffd27a', '#7af0ff', '#ff7ad9', '#fff4c8'];
  for (let y = 4; y < 124; y += 10) {
    for (let x = 4; x < 60; x += 10) {
      if (r.next() < 0.55) {
        ctx.fillStyle = colors[r.int(0, colors.length - 1)];
        ctx.globalAlpha = r.range(0.5, 1);
        ctx.fillRect(x, y, 6, 6);
      }
    }
  }
  ctx.globalAlpha = 1;
  return toTexture(c);
}

export function softDotTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, false);
}

export function shadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, false);
}
