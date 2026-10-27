// Kart + driver models built from primitives, one look per character.
// Models face +z; local +x is the kart's left.

import * as THREE from 'three';
import { getCharacter } from '../sim/characters';

export interface KartModel {
  root: THREE.Group;
  /** Rotated for drift angle, spins, tumbles and tricks. */
  body: THREE.Group;
  wheels: THREE.Object3D[];
  frontWheels: THREE.Object3D[];
  flames: THREE.Mesh[];
  wings: THREE.Object3D[];
  /** Materials whose emissive is driven for invincibility / damage flashes. */
  glowMats: THREE.MeshLambertMaterial[];
  dispose(): void;
}

const SKIN = 0xf2c9a0;

export function buildKart(characterId: string, opts: { ghost?: boolean } = {}): KartModel {
  const ch = getCharacter(characterId);
  const disposables: { dispose(): void }[] = [];
  const m = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => {
    const mm = new THREE.MeshLambertMaterial({ color, ...extra });
    if (opts.ghost) {
      mm.transparent = true;
      mm.opacity = 0.42;
      mm.depthWrite = false;
    }
    disposables.push(mm);
    return mm;
  };
  const g = <T extends THREE.BufferGeometry>(x: T) => {
    disposables.push(x);
    return x;
  };
  const primary = m(ch.color);
  const accent = m(ch.accent);
  const dark = m(0x23232b);
  const metal = m(0xb8bcc8);
  const skin = m(SKIN);
  const glowMats = [primary, accent];

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = body) => {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };

  // Chassis.
  mesh(g(new THREE.BoxGeometry(1.5, 0.32, 2.3)), primary, 0, 0.42, 0);
  mesh(g(new THREE.BoxGeometry(1.2, 0.28, 0.9)), primary, 0, 0.62, 0.75).rotation.x = -0.18;
  mesh(g(new THREE.BoxGeometry(1.7, 0.12, 0.5)), accent, 0, 0.42, 1.25);
  mesh(g(new THREE.BoxGeometry(1.6, 0.1, 0.35)), dark, 0, 1.0, -1.2);
  mesh(g(new THREE.BoxGeometry(0.12, 0.45, 0.12)), dark, 0.55, 0.8, -1.15);
  mesh(g(new THREE.BoxGeometry(0.12, 0.45, 0.12)), dark, -0.55, 0.8, -1.15);
  mesh(g(new THREE.BoxGeometry(0.9, 0.5, 0.25)), dark, 0, 0.8, -0.55); // seat back
  const wheelSteer = mesh(g(new THREE.TorusGeometry(0.22, 0.05, 6, 12)), dark, 0, 1.0, 0.45);
  wheelSteer.rotation.x = -0.9;

  // Exhausts and their boost flames.
  const flames: THREE.Mesh[] = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x6ad8ff, transparent: true, opacity: 0.9 });
  disposables.push(flameMat);
  for (const x of [-0.4, 0.4]) {
    const pipe = mesh(g(new THREE.CylinderGeometry(0.1, 0.12, 0.4, 8)), metal, x, 0.55, -1.3);
    pipe.rotation.x = Math.PI / 2;
    const f = mesh(g(new THREE.ConeGeometry(0.16, 0.9, 8)), flameMat, x, 0.55, -1.85);
    f.rotation.x = -Math.PI / 2;
    f.visible = false;
    flames.push(f);
  }

  // Wheels.
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const tire = g(new THREE.CylinderGeometry(0.38, 0.38, 0.34, 12));
  tire.rotateZ(Math.PI / 2);
  const hub = g(new THREE.CylinderGeometry(0.18, 0.18, 0.36, 8));
  hub.rotateZ(Math.PI / 2);
  for (const [x, z, front] of [
    [0.85, 0.8, true],
    [-0.85, 0.8, true],
    [0.88, -0.8, false],
    [-0.88, -0.8, false],
  ] as const) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.38, z);
    body.add(pivot);
    const spin = new THREE.Group();
    pivot.add(spin);
    spin.add(new THREE.Mesh(tire, dark));
    spin.add(new THREE.Mesh(hub, accent));
    wheels.push(spin);
    if (front) frontWheels.push(pivot);
  }

  // Driver.
  const driver = new THREE.Group();
  driver.position.set(0, 0.7, -0.2);
  body.add(driver);
  const torso = mesh(g(new THREE.CapsuleGeometry(0.34, 0.35, 4, 8)), primary, 0, 0.45, 0, driver);
  torso.scale.set(1, 1, 0.85);
  for (const x of [-0.38, 0.38]) {
    const arm = mesh(g(new THREE.CapsuleGeometry(0.1, 0.45, 3, 6)), primary, x * 0.9, 0.45, 0.35, driver);
    arm.rotation.x = 1.1;
  }
  const wings: THREE.Object3D[] = [];
  const headY = 1.25;
  switch (ch.id) {
    case 'bolt': {
      mesh(g(new THREE.BoxGeometry(0.72, 0.6, 0.62)), metal, 0, headY, 0, driver);
      mesh(g(new THREE.BoxGeometry(0.6, 0.14, 0.05)), new THREE.MeshBasicMaterial({ color: 0x6ff7ff }), 0, headY + 0.05, 0.32, driver);
      mesh(g(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 5)), dark, 0, headY + 0.5, 0, driver);
      mesh(g(new THREE.SphereGeometry(0.09, 8, 6)), new THREE.MeshBasicMaterial({ color: 0xff4040 }), 0, headY + 0.75, 0, driver);
      break;
    }
    case 'pip': {
      const head = mesh(g(new THREE.SphereGeometry(0.42, 14, 10)), primary, 0, headY - 0.05, 0, driver);
      head.scale.set(1, 1.05, 1);
      mesh(g(new THREE.SphereGeometry(0.3, 12, 8)), accent, 0, headY - 0.1, 0.2, driver).scale.set(1, 1.1, 0.6);
      const beak = mesh(g(new THREE.ConeGeometry(0.1, 0.32, 6)), m(0xff9a2a), 0, headY - 0.02, 0.48, driver);
      beak.rotation.x = Math.PI / 2;
      break;
    }
    case 'rosa': {
      mesh(g(new THREE.SphereGeometry(0.42, 14, 10)), primary, 0, headY, 0, driver);
      const snout = mesh(g(new THREE.ConeGeometry(0.2, 0.4, 8)), accent, 0, headY - 0.08, 0.45, driver);
      snout.rotation.x = Math.PI / 2;
      for (const x of [-0.24, 0.24]) mesh(g(new THREE.ConeGeometry(0.14, 0.42, 4)), primary, x, headY + 0.45, -0.02, driver);
      break;
    }
    case 'grit': {
      mesh(g(new THREE.BoxGeometry(0.62, 0.42, 0.6)), primary, 0, headY - 0.05, 0, driver);
      mesh(g(new THREE.BoxGeometry(0.5, 0.26, 0.6)), primary, 0, headY - 0.13, 0.5, driver);
      mesh(g(new THREE.BoxGeometry(0.46, 0.06, 0.55)), accent, 0, headY - 0.27, 0.52, driver);
      for (const x of [-0.18, 0.18]) mesh(g(new THREE.SphereGeometry(0.11, 8, 6)), m(0xffffff), x, headY + 0.2, 0.18, driver);
      break;
    }
    case 'mabel': {
      mesh(g(new THREE.SphereGeometry(0.38, 14, 10)), skin, 0, headY - 0.05, 0, driver);
      mesh(g(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 16)), accent, 0, headY + 0.22, 0, driver);
      const hat = mesh(g(new THREE.ConeGeometry(0.36, 0.9, 12)), accent, 0, headY + 0.68, -0.05, driver);
      hat.rotation.x = -0.2;
      mesh(g(new THREE.SphereGeometry(0.4, 10, 8)), m(0x9a6ad0), 0, headY - 0.05, -0.15, driver).scale.set(1.05, 1.1, 0.9);
      break;
    }
    case 'tank': {
      mesh(g(new THREE.SphereGeometry(0.46, 14, 10)), primary, 0, headY, 0, driver);
      mesh(g(new THREE.SphereGeometry(0.2, 10, 8)), accent, 0, headY - 0.1, 0.4, driver).scale.set(1.2, 0.9, 0.8);
      for (const x of [-0.32, 0.32]) mesh(g(new THREE.SphereGeometry(0.16, 10, 8)), primary, x, headY + 0.38, 0, driver);
      torso.scale.set(1.25, 1.05, 1.0);
      break;
    }
    case 'zip': {
      mesh(g(new THREE.SphereGeometry(0.4, 14, 10)), primary, 0, headY, 0, driver);
      mesh(g(new THREE.TorusGeometry(0.4, 0.06, 6, 16)), accent, 0, headY - 0.05, 0, driver).rotation.x = Math.PI / 2;
      for (const x of [-0.14, 0.14]) {
        const ant = mesh(g(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 4)), accent, x, headY + 0.5, 0.05, driver);
        ant.rotation.z = x * 2;
      }
      const wingMat = new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
      disposables.push(wingMat);
      for (const x of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(x * 0.25, 0.75, -0.25);
        driver.add(pivot);
        const w = new THREE.Mesh(g(new THREE.PlaneGeometry(0.7, 0.35)), wingMat);
        w.position.x = x * 0.35;
        pivot.add(w);
        wings.push(pivot);
      }
      break;
    }
    case 'nova': {
      mesh(g(new THREE.SphereGeometry(0.46, 16, 12)), primary, 0, headY, 0, driver);
      const visor = mesh(g(new THREE.SphereGeometry(0.34, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2)), new THREE.MeshLambertMaterial({ color: accent.color, emissive: 0x401030 }), 0, headY, 0.18, driver);
      visor.rotation.x = Math.PI / 2;
      mesh(g(new THREE.BoxGeometry(0.4, 0.4, 0.25)), metal, 0, 0.5, -0.38, driver);
      break;
    }
  }
  // Eyes for the animal characters.
  if (['rosa', 'tank', 'pip', 'zip'].includes(ch.id)) {
    for (const x of [-0.14, 0.14]) mesh(g(new THREE.SphereGeometry(0.06, 6, 5)), dark, x, headY + 0.08, 0.38, driver);
  }

  // Ghosts render translucent: patch every material in the tree.
  if (opts.ghost) {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const mm = o.material as THREE.Material;
        mm.transparent = true;
        mm.opacity = Math.min(mm.opacity, 0.42);
        mm.depthWrite = false;
      }
    });
  }

  return {
    root,
    body,
    wheels,
    frontWheels,
    flames,
    wings,
    glowMats,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
