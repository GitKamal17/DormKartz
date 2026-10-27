// Fixed-timestep game loop: the simulation ticks at exactly 60 Hz no matter the
// display refresh rate; rendering happens once per animation frame and is told
// how far between two ticks it is (alpha) so it can interpolate.

import { DT } from '../sim/config';

export class FixedLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  running = false;
  /** When false, rendering continues but the simulation does not advance. */
  ticking = true;

  constructor(
    private readonly onTick: () => void,
    private readonly onFrame: (alpha: number, frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    const frame = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.25, (now - this.last) / 1000);
      this.last = now;
      if (this.ticking) {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= DT && steps < 6) {
          this.onTick();
          this.acc -= DT;
          steps++;
        }
        if (steps === 6) this.acc = 0;
      }
      this.onFrame(this.ticking ? this.acc / DT : 1, dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
