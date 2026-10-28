// Draws a RaceSession. Reads simulation state, never writes it. Supports any
// number of viewports, each with its own chase camera following one kart.

import * as THREE from 'three';
import { viewportRects } from '../game/party';
import type { RaceSession } from '../game/session';
import { PREV_STRIDE } from '../game/session';
import { PHYS } from '../sim/config';
import { wrapAngle } from '../sim/math';
import { frameAt, groundHeight, newLoc, type Track } from '../sim/track/build';
import type { KartState, PlayerId, RaceEvent } from '../sim/types';
import { ChaseCamera } from './camera';
import { Entities, makePeel, makePuck } from './entities';
import { buildKart, type KartModel } from './kartModel';
import { Particles } from './particles';
import { shadowTexture } from './textures';
import { buildWorld, type World } from './world';

export interface Viewport {
  follow: PlayerId;
  chase: ChaseCamera;
  /** Normalized rect (0..1), origin top-left. */
  rect: { x: number; y: number; w: number; h: number };
}

const TIER_COLORS = [new THREE.Color(0xdddddd), new THREE.Color(0x4fb4ff), new THREE.Color(0xff9a2a), new THREE.Color(0xd060ff)];
const DUST = new THREE.Color(0x9a8a70);
const SMOKE = new THREE.Color(0x777777);
const loc = newLoc();
// Scratch math objects reused every frame.
const _t = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _f = new THREE.Vector3(), _x = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

class KartVisual {
  readonly model: KartModel;
  readonly shadow: THREE.Mesh;
  readonly trail: Record<'peel' | 'bouncePuck' | 'seekerPuck', THREE.Object3D>;
  readonly drone: THREE.Group;
  private quat = new THREE.Quaternion();
  private driftYaw = 0;
  private scale = 1;
  private wheelSpin = 0;
  private trickSpin = 0;
  droneTimer = 0;
  readonly pos = new THREE.Vector3();
  heading = 0;

  constructor(
    scene: THREE.Object3D,
    characterId: string,
    shadowMat: THREE.Material,
    shadowGeo: THREE.BufferGeometry,
    ghost: boolean,
  ) {
    this.model = buildKart(characterId, { ghost });
    scene.add(this.model.root);
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.visible = !ghost;
    scene.add(this.shadow);
    const peel = makePeel();
    const bounce = makePuck('bounce');
    const seeker = makePuck('seeker');
    for (const o of [peel, bounce, seeker]) {
      o.position.set(0, 0.35, -1.9);
      o.visible = false;
      this.model.body.add(o);
    }
    this.trail = { peel, bouncePuck: bounce, seekerPuck: seeker };
    this.drone = buildDrone();
    this.drone.visible = false;
    scene.add(this.drone);
  }

  update(k: KartState, track: Track, px: number, py: number, pz: number, ph: number, alpha: number, dt: number, time: number, particles: Particles): void {
    const m = this.model;
    const x = px + (k.x - px) * alpha;
    const y = py + (k.y - py) * alpha;
    const z = pz + (k.z - pz) * alpha;
    const h = ph + wrapAngle(k.heading - ph) * alpha;
    this.pos.set(x, y, z);
    this.heading = h;
    m.root.position.set(x, y, z);

    // Align to the road surface when grounded; level out in the air.
    frameAt(track, k.s, loc);
    const slope = track.slope[loc.i];
    const N = _n;
    if (k.grounded || k.airTicks < 4) {
      _t.set(loc.tx, loc.ty, loc.tz);
      _r.set(loc.rx, slope, loc.rz);
      N.crossVectors(_r, _t).normalize();
      if (N.y < 0) N.negate();
    } else N.set(0, 1, 0);
    const f = _f.set(Math.sin(h), 0, Math.cos(h));
    f.addScaledVector(N, -f.dot(N)).normalize();
    _x.crossVectors(N, f);
    _q.setFromRotationMatrix(_m.makeBasis(_x, N, f));
    this.quat.slerp(_q, Math.min(1, dt * 12));
    m.root.quaternion.copy(this.quat);

    // Body animation: drift angle, hits, tricks.
    const wantDrift = k.drift * -0.38;
    this.driftYaw += (wantDrift - this.driftYaw) * Math.min(1, dt * 8);
    m.body.rotation.set(0, this.driftYaw, 0);
    m.body.scale.set(1, 1, 1);
    if (k.hit === 'spin') {
      const p = 1 - k.hitTicks / (PHYS.spinTime * 60);
      m.body.rotation.y += p * Math.PI * 4;
    } else if (k.hit === 'tumble') {
      const p = 1 - k.hitTicks / (PHYS.tumbleTime * 60);
      m.body.rotation.x = p * Math.PI * 2;
      m.body.rotation.y += p * Math.PI;
    } else if (k.hit === 'squash') {
      m.body.scale.set(1.25, 0.3, 1.25);
    }
    if (k.trick || (this.trickSpin > 0 && this.trickSpin < Math.PI * 2)) {
      this.trickSpin = Math.min(Math.PI * 2, this.trickSpin + dt * 14);
      m.body.rotation.z = this.trickSpin;
    } else if (k.grounded) this.trickSpin = 0;

    const wantScale = k.shrinkTicks > 0 ? 0.55 : 1;
    this.scale += (wantScale - this.scale) * Math.min(1, dt * 6);
    m.root.scale.setScalar(this.scale);

    // Wheels.
    const speed = k.vx * Math.sin(k.heading) + k.vz * Math.cos(k.heading);
    this.wheelSpin += (speed * dt) / 0.38;
    for (const w of m.wheels) w.rotation.x = this.wheelSpin;
    for (const w of m.frontWheels) w.rotation.y = -k.steer * 0.45;
    for (let i = 0; i < m.wings.length; i++) m.wings[i].rotation.z = Math.sin(time * 40) * 0.6 * (i ? 1 : -1);

    // Boost flames.
    const boosting = k.boostTicks > 0;
    for (const fl of m.flames) {
      fl.visible = boosting;
      if (boosting) {
        fl.scale.set(1, 0.8 + Math.random() * 0.6 + (k.boostKind === 2 ? 0.4 : 0), 1);
        (fl.material as THREE.MeshBasicMaterial).color.setHex(k.boostKind === 3 ? 0xffd23a : k.boostKind === 2 ? 0xff7a2a : 0x6ad8ff);
      }
    }

    // Invincibility shimmer, invulnerability blink.
    for (const mm of m.glowMats) {
      if (k.starTicks > 0) mm.emissive.setHSL((time * 2) % 1, 1, 0.45);
      else mm.emissive.setHex(0x000000);
    }
    m.root.visible = !(k.invulnTicks > 0 && k.hit === null && Math.floor(time * 20) % 2 === 0) && k.fallTicks < 70;

    for (const key of ['peel', 'bouncePuck', 'seekerPuck'] as const) this.trail[key].visible = k.trailing === key;

    // Sparks, smoke and dust from the rear wheels.
    const s = Math.sin(h), c = Math.cos(h);
    const rearX = x - s * 1.1, rearZ = z - c * 1.1;
    if (k.drift !== 0 && k.grounded) {
      const col = TIER_COLORS[k.driftTier];
      const n = k.driftTier > 0 ? 3 : 1;
      for (let i = 0; i < n; i++) {
        for (const side of [-1, 1]) {
          particles.emit(rearX + c * 0.85 * side, y + 0.2, rearZ - s * 0.85 * side, (Math.random() - 0.5) * 4 - s * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 4 - c * 3, k.driftTier > 0 ? col : SMOKE, k.driftTier > 0 ? 0.5 : 0.9, 0.3, 12);
        }
      }
    }
    if (k.offroad && Math.abs(speed) > 6 && Math.random() < 0.6) {
      particles.emit(rearX, y + 0.3, rearZ, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, DUST, 1.4, 0.6, 2);
    }
    if (boosting && Math.random() < 0.7) {
      particles.emit(rearX, y + 0.55, rearZ, -s * 6 + (Math.random() - 0.5), Math.random(), -c * 6 + (Math.random() - 0.5), TIER_COLORS[Math.min(3, k.boostKind + 1)], 0.8, 0.25);
    }

    // Blob shadow on the ground below.
    const gy = groundHeight(track, loc.s, k.d, loc.i, loc.cy);
    const hasGround = track.gap[loc.i] === 0 && Math.abs(k.d) < Math.max(track.limL[loc.i], track.limR[loc.i]) + 0.5;
    this.shadow.visible = hasGround && y - gy < 12 && k.fallTicks === 0 && this.model.root.visible;
    this.shadow.position.set(x, gy + 0.06, z);
    const sh = Math.max(0.3, 1 - (y - gy) / 12) * this.scale;
    this.shadow.scale.setScalar(sh);

    // Respawn drone.
    this.droneTimer = Math.max(0, this.droneTimer - dt);
    this.drone.visible = this.droneTimer > 0;
    if (this.drone.visible) {
      this.drone.position.set(x, y + 2.6 + this.droneTimer * 3, z);
      for (const ch of this.drone.children) if (ch.name === 'prop') ch.rotation.y = time * 40;
    }
  }

  dispose(): void {
    this.model.dispose();
    this.model.root.removeFromParent();
    this.shadow.removeFromParent();
    this.drone.removeFromParent();
  }
}

function buildDrone(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 1.2), new THREE.MeshLambertMaterial({ color: 0x3a3a48 }));
  g.add(body);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0x40ff80 }));
  light.position.y = 0.25;
  g.add(light);
  for (const [x, z] of [[0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 1.3), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    arm.position.set(x / 2, 0, z / 2);
    arm.lookAt(x, 0, z);
    g.add(arm);
    const prop = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.12), new THREE.MeshBasicMaterial({ color: 0xcccccc }));
    prop.position.set(x, 0.15, z);
    prop.name = 'prop';
    g.add(prop);
  }
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2, 4), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  rope.position.y = -1.1;
  g.add(rope);
  return g;
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly particles = new Particles(3000);
  viewports: Viewport[] = [];
  private world: World | null = null;
  private entities: Entities | null = null;
  private karts = new Map<PlayerId, KartVisual>();
  private ghost: KartVisual | null = null;
  private time = 0;
  private readonly shadowMat: THREE.MeshBasicMaterial;
  private readonly shadowGeo = new THREE.PlaneGeometry(2.6, 3.0);
  private session: RaceSession | null = null;
  private flickerT = 0;
  /** Highest pixel ratio we render at; the actual one drops when frames run slow (phones). */
  private readonly maxRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  private ratio = this.maxRatio;
  private slowTime = 0;
  private slowFrames = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false });
    this.scene.add(this.particles.points);
    this.resize();
  }

  get info(): THREE.WebGLInfo {
    return this.renderer.info;
  }

  /** Builds the world for a race. `follow` lists the kart each viewport tracks. */
  load(session: RaceSession, follow: PlayerId[], sideBySide = false): void {
    this.unload();
    this.session = session;
    const track = session.track;
    this.world = buildWorld(track);
    this.scene.add(this.world.root);
    const theme = track.def.theme;
    this.scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
    this.scene.background = new THREE.Color(theme.skyHorizon);
    this.entities = new Entities(track, this.world.boxes);
    this.scene.add(this.entities.root);
    for (const k of session.state.karts) this.karts.set(k.id, new KartVisual(this.scene, k.characterId, this.shadowMat, this.shadowGeo, false));
    if (session.ghost) this.ghost = new KartVisual(this.scene, session.ghost.data.characterId, this.shadowMat, this.shadowGeo, true);
    this.particles.clear();
    this.setViewports(follow, sideBySide);
    this.slowTime = this.slowFrames = 0;
  }

  /**
   * Lowers the resolution a step whenever a second of racing averages under
   * 50 fps, down to 60% of normal. It doesn't climb back mid-race (that just
   * oscillates); each race starts from the last good setting.
   */
  private adaptResolution(dt: number): void {
    if (dt > 0.25) return; // tab was in the background
    this.slowTime += dt;
    this.slowFrames++;
    if (this.slowTime < 1) return;
    const fps = this.slowFrames / this.slowTime;
    this.slowTime = this.slowFrames = 0;
    const floor = this.maxRatio * 0.6;
    if (fps >= 50 || this.ratio <= floor) return;
    this.ratio = Math.max(floor, this.ratio * 0.85);
    this.renderer.setPixelRatio(this.ratio);
    this.resize();
  }

  setViewports(follow: PlayerId[], sideBySide = false): void {
    const rects = viewportRects(follow.length, sideBySide);
    this.viewports = follow.map((id, i) => ({ follow: id, chase: new ChaseCamera(), rect: rects[i] }));
    this.resize();
  }

  unload(): void {
    for (const v of this.karts.values()) v.dispose();
    this.karts.clear();
    this.ghost?.dispose();
    this.ghost = null;
    if (this.world) {
      this.scene.remove(this.world.root);
      this.world.dispose();
      this.world = null;
    }
    if (this.entities) {
      this.scene.remove(this.entities.root);
      this.entities.dispose();
      this.entities = null;
    }
    this.session = null;
    this.particles.clear();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    for (const v of this.viewports) v.chase.setAspect((v.rect.w * w) / (v.rect.h * h));
  }

  /** React to simulation events with visual effects. */
  onEvents(events: RaceEvent[]): void {
    const s = this.session;
    if (!s) return;
    for (const e of events) {
      if (e.type === 'respawn' || e.type === 'fall') {
        const v = this.karts.get(e.kart);
        if (v) v.droneTimer = e.type === 'respawn' ? 1.0 : 0;
        if (e.type === 'respawn') for (const vp of this.viewports) if (vp.follow === e.kart) vp.chase.snap();
      }
      if (e.type === 'explode') {
        const c1 = new THREE.Color(0xffc040), c2 = new THREE.Color(0xff5020);
        for (let i = 0; i < 120; i++) {
          const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, sp = 6 + Math.random() * 14;
          const r = Math.sqrt(1 - u * u);
          this.particles.emit(e.x, e.y + 1, e.z, Math.cos(a) * r * sp, Math.abs(u) * sp, Math.sin(a) * r * sp, i % 2 ? c1 : c2, 3, 0.9, 6);
        }
        for (const vp of this.viewports) vp.chase.addShake(0.8);
      }
      if (e.type === 'hit') {
        const k = s.kart(e.kart);
        const star = new THREE.Color(0xffff80);
        for (let i = 0; i < 20; i++) this.particles.emit(k.x, k.y + 1.2, k.z, (Math.random() - 0.5) * 8, Math.random() * 6, (Math.random() - 0.5) * 8, star, 0.8, 0.5, 10);
        for (const vp of this.viewports) if (vp.follow === e.kart) vp.chase.addShake(0.35);
      }
      if (e.type === 'wall' && e.strength > 10) for (const vp of this.viewports) if (vp.follow === e.kart) vp.chase.addShake(0.2);
      if (e.type === 'driftTier' || (e.type === 'boost' && e.kind === 'turbo')) {
        const k = s.kart(e.kart);
        const col = TIER_COLORS[e.type === 'driftTier' ? e.tier : 2];
        for (let i = 0; i < 12; i++) this.particles.emit(k.x, k.y + 0.4, k.z, (Math.random() - 0.5) * 10, Math.random() * 5, (Math.random() - 0.5) * 10, col, 0.7, 0.35, 10);
      }
    }
  }

  render(alpha: number, dt: number): void {
    const s = this.session;
    if (!s || !this.world || !this.entities) return;
    this.time += dt;
    this.adaptResolution(dt);
    const st = s.state;
    const track = s.track;
    for (let i = 0; i < st.karts.length; i++) {
      const k = st.karts[i];
      const o = i * PREV_STRIDE;
      this.karts.get(k.id)!.update(k, track, s.prev[o], s.prev[o + 1], s.prev[o + 2], s.prev[o + 3], alpha, dt, this.time, this.particles);
    }
    if (this.ghost) {
      const gk = s.ghost?.state?.karts[0];
      this.ghost.model.root.visible = !!gk && !!s.ghost?.active;
      if (gk && s.ghost?.active) this.ghost.update(gk, track, s.ghostPrev[0], s.ghostPrev[1], s.ghostPrev[2], s.ghostPrev[3], alpha, dt, this.time, this.particles);
      this.ghost.shadow.visible = false;
    }
    this.entities.update(st, st.tick + alpha, alpha, this.time, this.particles);
    this.particles.update(dt);
    this.world.padTexture.offset.y -= dt * 2.5;
    if (this.world.liquid) {
      this.world.liquid.offset.x += dt * 0.01;
      this.world.liquid.offset.y += dt * 0.006;
    }
    if (this.world.theme.flicker) {
      this.flickerT -= dt;
      if (this.flickerT <= 0) {
        this.world.sunLight.intensity = this.world.theme.sunIntensity * (Math.random() < 0.15 ? 0.25 : 1);
        this.flickerT = 0.05 + Math.random() * 0.3;
      }
    }

    const W = window.innerWidth, H = window.innerHeight;
    this.renderer.setScissorTest(true);
    this.renderer.clear();
    const countdown = st.phase === 'countdown' ? st.countdown : 0;
    const intro = countdown > 180 ? (countdown - 180) / 40 : 0;
    for (const vp of this.viewports) {
      const kv = this.karts.get(vp.follow);
      const k = s.kart(vp.follow);
      if (!kv) continue;
      const speed = Math.hypot(k.vx, k.vz);
      const lookBack = s.lastInput.get(vp.follow)?.lookBack ?? false;
      vp.chase.update(kv.pos.x, kv.pos.y, kv.pos.z, kv.heading, speed, k.boostTicks > 0, lookBack, dt, intro);
      const x = vp.rect.x * W, y = (1 - vp.rect.y - vp.rect.h) * H, w = vp.rect.w * W, h = vp.rect.h * H;
      this.renderer.setViewport(x, y, w, h);
      this.renderer.setScissor(x, y, w, h);
      this.particles.setScale(h * this.renderer.getPixelRatio());
      this.renderer.render(this.scene, vp.chase.camera);
    }
    this.renderer.setScissorTest(false);
  }
}
