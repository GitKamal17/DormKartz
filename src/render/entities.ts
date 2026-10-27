// Visuals for everything that moves but is not a kart: projectiles, peels,
// item boxes and track hazards. Meshes are pooled and reused.

import * as THREE from 'three';
import { crusherPose, newPose, rollerPose, trafficPose } from '../sim/hazards';
import type { Track } from '../sim/track/build';
import type { ProjectileKind, RaceState } from '../sim/types';
import type { Particles } from './particles';

const pose = newPose();

class Pool {
  private items: THREE.Object3D[] = [];
  private used = 0;
  constructor(
    private readonly parent: THREE.Object3D,
    private readonly make: () => THREE.Object3D,
  ) {}
  begin(): void {
    this.used = 0;
  }
  get(): THREE.Object3D {
    if (this.used >= this.items.length) {
      const o = this.make();
      this.parent.add(o);
      this.items.push(o);
    }
    const o = this.items[this.used++];
    o.visible = true;
    return o;
  }
  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  }
}

export function makePuck(kind: 'bounce' | 'seeker'): THREE.Group {
  const g = new THREE.Group();
  const color = kind === 'bounce' ? 0x35d04a : 0xe8332e;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.7, 0.42, 16), new THREE.MeshLambertMaterial({ color }));
  g.add(body);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.1, 6, 16), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  if (kind === 'seeker') {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffee55 }));
    eye.position.y = 0.3;
    g.add(eye);
  }
  return g;
}

export function makePeel(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshLambertMaterial({ color: 0xffd93a });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.2, 8, 14, Math.PI * 1.2), m);
  arc.rotation.set(Math.PI / 2, 0, 0.3);
  arc.position.y = 0.2;
  g.add(arc);
  for (let i = 0; i < 3; i++) {
    const flap = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 5), m);
    flap.position.set(Math.cos(i * 2.1) * 0.3, 0.12, Math.sin(i * 2.1) * 0.3);
    flap.rotation.set(Math.PI / 2, 0, i * 2.1);
    g.add(flap);
  }
  return g;
}

function makeComet(): THREE.Group {
  const g = new THREE.Group();
  const gold = new THREE.MeshBasicMaterial({ color: 0xffcf3a });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.5, 12, 1, true), gold);
  g.add(base);
  for (let i = 0; i < 5; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 5), gold);
    const a = (i / 5) * Math.PI * 2;
    spike.position.set(Math.cos(a) * 0.7, 0.5, Math.sin(a) * 0.7);
    g.add(spike);
  }
  const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshBasicMaterial({ color: 0x55d6ff }));
  jewel.position.y = 0.2;
  g.add(jewel);
  g.scale.setScalar(1.4);
  return g;
}

function makeRoller(style: string, radius: number): THREE.Group {
  const g = new THREE.Group();
  if (style === 'tumbleweed') {
    const m = new THREE.MeshLambertMaterial({ color: 0xa47a42, wireframe: true });
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), m));
    const inner = new THREE.Mesh(new THREE.IcosahedronGeometry(radius * 0.7, 1), m);
    inner.rotation.set(0.5, 0.3, 0.2);
    g.add(inner);
  } else if (style === 'snowball') {
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 2), new THREE.MeshLambertMaterial({ color: 0xffffff })));
  } else {
    const ghost = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({ color: 0xe8e0ff, transparent: true, opacity: 0.65 }));
    ghost.scale.set(1, 1.2, 1);
    g.add(ghost);
    for (const x of [-0.4, 0.4]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0x220033 }));
      eye.position.set(x * radius, radius * 0.25, radius * 0.85);
      g.add(eye);
    }
  }
  return g;
}

function makeCar(seed: number): THREE.Group {
  const g = new THREE.Group();
  const colors = [0xf5c518, 0xe84a3c, 0x3a8dde, 0xeeeeee, 0x8a4fd0];
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 4.4), new THREE.MeshLambertMaterial({ color: colors[seed % colors.length] }));
  body.position.y = 0.8;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 2.2), new THREE.MeshLambertMaterial({ color: 0x223344 }));
  cabin.position.set(0, 1.6, -0.2);
  g.add(cabin);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff4c0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0xff2030 });
  for (const x of [-0.7, 0.7]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.1), lightMat);
    hl.position.set(x, 0.9, 2.21);
    g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.1), tailMat);
    tl.position.set(x, 0.9, -2.21);
    g.add(tl);
  }
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  for (const [x, z] of [[1, 1.4], [-1, 1.4], [1, -1.4], [-1, -1.4]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.3, 10), wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x * 1.05, 0.4, z);
    g.add(w);
  }
  return g;
}

function makeCrusher(width: number): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0x6f6872 });
  const block = new THREE.Mesh(new THREE.BoxGeometry(width, 3.2, 4.6), stone);
  block.position.y = 1.6;
  g.add(block);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3010 });
  for (const x of [-0.25, 0.25]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(width * 0.14, 0.4, 0.1), eyeMat);
    eye.position.set(x * width, 2.2, 2.31);
    eye.rotation.z = x > 0 ? 0.3 : -0.3;
    g.add(eye);
  }
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 30, 6), new THREE.MeshLambertMaterial({ color: 0x333333 }));
  chain.position.y = 18;
  g.add(chain);
  return g;
}

export class Entities {
  readonly root = new THREE.Group();
  private readonly pucks: Record<'bounce' | 'seeker', Pool>;
  private readonly comets: Pool;
  private readonly peels: Pool;
  private readonly hazards: { obj: THREE.Object3D; index: number; car?: number }[] = [];
  private readonly boxDummy = new THREE.Object3D();
  private readonly gold = new THREE.Color(0xffd040);
  private readonly sparkle = new THREE.Color(0xfff2a0);

  constructor(
    private readonly track: Track,
    private readonly boxes: THREE.InstancedMesh,
  ) {
    this.pucks = { bounce: new Pool(this.root, () => makePuck('bounce')), seeker: new Pool(this.root, () => makePuck('seeker')) };
    this.comets = new Pool(this.root, makeComet);
    this.peels = new Pool(this.root, makePeel);
    track.hazards.forEach((h, index) => {
      if (h.kind === 'roller') this.hazards.push({ obj: this.root.add(makeRoller(h.style, h.radius)).children.at(-1)!, index });
      else if (h.kind === 'traffic') {
        for (let c = 0; c < h.count; c++) this.hazards.push({ obj: this.root.add(makeCar(c)).children.at(-1)!, index, car: c });
      } else if (h.kind === 'crusher') this.hazards.push({ obj: this.root.add(makeCrusher(h.dMax - h.dMin)).children.at(-1)!, index });
      else {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(h.radius * 1.6, h.radius * 1.6, h.radius * 1.6), new THREE.MeshLambertMaterial({ color: 0xa8743c }));
        crate.position.set(h.x, h.y + h.radius * 0.8, h.z);
        crate.rotation.y = h.s;
        this.root.add(crate);
      }
    });
  }

  /** `t` is the interpolated tick (tick + alpha) for smooth hazard motion. */
  update(state: RaceState, t: number, alpha: number, time: number, particles: Particles): void {
    const DT = 1 / 60;
    this.pucks.bounce.begin();
    this.pucks.seeker.begin();
    this.comets.begin();
    for (const p of state.projectiles) {
      const back = (1 - alpha) * DT;
      if (p.kind === 'comet') {
        const o = this.comets.get();
        o.position.set(p.x - p.vx * back, p.y, p.z - p.vz * back);
        o.rotation.y = time * 6;
        particles.emit(o.position.x, o.position.y, o.position.z, (Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2, Math.random() < 0.5 ? this.gold : this.sparkle, 1.4, 0.6);
      } else {
        const o = this.pucks[p.kind as Exclude<ProjectileKind, 'comet'>].get();
        o.position.set(p.x - p.vx * back, p.y - 0.3, p.z - p.vz * back);
        o.rotation.y = time * 10;
      }
    }
    this.pucks.bounce.end();
    this.pucks.seeker.end();
    this.comets.end();

    this.peels.begin();
    for (const pl of state.peels) {
      const o = this.peels.get();
      o.position.set(pl.x, pl.y + 0.05, pl.z);
      o.rotation.y = pl.id;
    }
    this.peels.end();

    // Item boxes spin and pop back in when they respawn.
    const tb = this.track.boxes;
    for (let i = 0; i < tb.length; i++) {
      const respawn = state.boxes.length ? state.boxes[i] : 1;
      const hidden = state.boxes.length === 0;
      const scale = hidden ? 0 : respawn > 0 ? Math.max(0, 1 - respawn / 20) * (respawn < 20 ? 1 : 0) : 1;
      this.boxDummy.position.set(tb[i].x, tb[i].y + Math.sin(time * 2 + i) * 0.2, tb[i].z);
      this.boxDummy.rotation.set(time * 0.7 + i, time * 1.1 + i, 0);
      this.boxDummy.scale.setScalar(scale);
      this.boxDummy.updateMatrix();
      this.boxes.setMatrixAt(i, this.boxDummy.matrix);
    }
    this.boxes.instanceMatrix.needsUpdate = true;

    for (const hz of this.hazards) {
      const h = this.track.hazards[hz.index];
      if (h.kind === 'roller') {
        rollerPose(this.track, h, t, pose);
        hz.obj.position.set(pose.x, pose.y, pose.z);
        if (h.style === 'ghost') {
          hz.obj.position.y += Math.sin(time * 3 + hz.index) * 0.4;
          hz.obj.rotation.y = pose.heading + Math.PI / 2 * Math.sign(Math.cos((Math.PI * 2 * t) / h.periodTicks + h.phase));
        } else {
          hz.obj.rotation.set(t * 0.08, pose.heading, 0);
        }
      } else if (h.kind === 'traffic') {
        trafficPose(this.track, h, hz.car!, t, pose);
        hz.obj.position.set(pose.x, pose.y, pose.z);
        hz.obj.rotation.y = pose.heading;
      } else if (h.kind === 'crusher') {
        crusherPose(this.track, h, t, pose);
        hz.obj.position.set(pose.x, pose.y + pose.height, pose.z);
        hz.obj.rotation.y = pose.heading;
      }
    }
  }

  dispose(): void {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
