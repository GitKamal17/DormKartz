// Small 3D turntable used on the character select and podium screens.

import * as THREE from 'three';
import { buildKart, type KartModel } from '../render/kartModel';

export class Preview {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private models: KartModel[] = [];
  private raf = 0;
  private angle = 0;
  private podium: THREE.Group | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'preview-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(3, 5, 4);
    this.scene.add(sun);
  }

  show(ids: string[], mode: 'single' | 'podium' = 'single'): void {
    for (const m of this.models) {
      m.root.removeFromParent();
      m.dispose();
    }
    this.models = [];
    this.podium?.removeFromParent();
    this.podium = null;
    if (mode === 'single') {
      const m = buildKart(ids[0]);
      this.scene.add(m.root);
      this.models.push(m);
      this.camera.position.set(0, 2.6, 6.2);
      this.camera.lookAt(0, 0.9, 0);
    } else {
      this.podium = new THREE.Group();
      const heights = [1.6, 1.1, 0.7];
      const xs = [0, -3.2, 3.2];
      const colors = [0xffd23a, 0xc8d0dc, 0xd08a4a];
      ids.slice(0, 3).forEach((id, i) => {
        const block = new THREE.Mesh(new THREE.BoxGeometry(2.8, heights[i], 2.6), new THREE.MeshLambertMaterial({ color: colors[i] }));
        block.position.set(xs[i], heights[i] / 2, 0);
        this.podium!.add(block);
        const m = buildKart(id);
        m.root.position.set(xs[i], heights[i], 0);
        m.root.scale.setScalar(0.9);
        this.scene.add(m.root);
        this.models.push(m);
      });
      this.scene.add(this.podium);
      this.camera.position.set(0, 4.5, 11);
      this.camera.lookAt(0, 1.4, 0);
    }
  }

  start(): void {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
      if (w && h && (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.round(h * this.renderer.getPixelRatio()))) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      this.angle += 0.012;
      this.models.forEach((m, i) => {
        m.root.rotation.y = this.models.length > 1 ? Math.sin(this.angle * 2 + i) * 0.5 : this.angle;
        for (const w of m.wheels) w.rotation.x += 0.05;
        for (const wg of m.wings) wg.rotation.z = Math.sin(this.angle * 60) * 0.6;
      });
      this.renderer.render(this.scene, this.camera);
    };
    cancelAnimationFrame(this.raf);
    loop();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}
