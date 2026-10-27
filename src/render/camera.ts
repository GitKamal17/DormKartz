// Chase camera that follows one kart. Each viewport owns one.

import * as THREE from 'three';
import { wrapAngle } from '../sim/math';

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialized = false;
  private shake = 0;
  private fov = 68;
  private readonly tmp = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.3, 3200);
  }

  snap(): void {
    this.initialized = false;
  }

  addShake(amount: number): void {
    this.shake = Math.max(this.shake, amount);
  }

  /**
   * @param intro 0..1 during the pre-race flyaround (1 = start), 0 when racing.
   */
  update(x: number, y: number, z: number, heading: number, speed: number, boosting: boolean, lookBack: boolean, dt: number, intro: number): void {
    if (!this.initialized) {
      this.yaw = heading;
      this.initialized = true;
      this.pos.set(x - Math.sin(heading) * 7, y + 3.2, z - Math.cos(heading) * 7);
    }
    // Yaw lags the kart a little so drifts read as drifts.
    const dy = wrapAngle(heading - this.yaw);
    this.yaw += dy * Math.min(1, dt * 5.5);
    let yaw = this.yaw + (lookBack ? Math.PI : 0);
    let dist = 6.8 + Math.min(1.6, speed * 0.03);
    let height = 2.9;
    if (intro > 0) {
      // Swing in from the front of the kart.
      const e = intro * intro;
      yaw += e * Math.PI * 0.9;
      dist += e * 6;
      height += e * 3;
    }
    const tx = x - Math.sin(yaw) * dist, tz = z - Math.cos(yaw) * dist, ty = y + height;
    const k = intro > 0 || lookBack ? 1 : Math.min(1, dt * 9);
    this.pos.x += (tx - this.pos.x) * k;
    this.pos.z += (tz - this.pos.z) * k;
    this.pos.y += (ty - this.pos.y) * Math.min(1, dt * 6);
    this.look.set(x + Math.sin(yaw) * 4, y + 1.2, z + Math.cos(yaw) * 4);
    this.camera.position.copy(this.pos);
    if (this.shake > 0.001) {
      this.tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(this.shake);
      this.camera.position.add(this.tmp);
      this.shake *= Math.exp(-dt * 8);
    }
    this.camera.lookAt(this.look);
    const wantFov = boosting ? 80 : 68 + Math.min(6, speed * 0.12);
    this.fov += (wantFov - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  setAspect(a: number): void {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }
}
