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
  /** Ticks per real second, relative to 60 (online play nudges this to stay in step with the server). */
  rate = 1;
  /**
   * Most ticks run in one frame before the loop gives up catching up. Online
   * play raises it: the server expects 60 inputs a second even from a device
   * that can only draw 10 frames.
   */
  maxSteps = 6;

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
        this.acc += dt * this.rate;
        let steps = 0;
        while (this.acc >= DT && steps < this.maxSteps) {
          this.onTick();
          this.acc -= DT;
          steps++;
        }
        if (steps === this.maxSteps) this.acc = 0;
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
