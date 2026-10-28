// On-screen controls for phones and tablets. The left side of the screen is a
// steering pad (drag left/right from wherever your thumb lands); the right side
// has Drift, Item, Brake and Look-back buttons. Gas is automatic once the race
// is on, so one thumb steers and the other drifts.

import { clamp } from '../sim/math';
import type { FrameInput } from '../sim/types';
import { LocalInput } from './local';
import { blankInput, type InputSource, type RaceView } from './types';

type Button = 'drift' | 'item' | 'brake' | 'lookBack';

/** Keeps a finger's events on the control it started on, even if it slides off. */
function capture(el: HTMLElement, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // Synthetic or already-ended pointers can't be captured; the control still works.
  }
}

/** True on phones/tablets, or as soon as anyone touches the screen. */
export function touchDevice(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly pad: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private steerPointer = -1;
  private steerOrigin = 0;
  steer = 0;
  readonly held: Record<Button, boolean> = { drift: false, item: false, brake: false, lookBack: false };
  /** Touch controls were used this session, so their state should drive the kart. */
  active = false;

  constructor(parent: HTMLElement, onPause: () => void) {
    const root = (this.root = document.createElement('div'));
    root.className = 'touch-ui';
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    this.pad = document.createElement('div');
    this.pad.className = 'tc-steer';
    this.base = document.createElement('div');
    this.base.className = 'tc-base';
    this.knob = document.createElement('div');
    this.knob.className = 'tc-knob';
    this.base.appendChild(this.knob);
    this.pad.appendChild(this.base);
    root.appendChild(this.pad);
    this.pad.addEventListener('pointerdown', (e) => {
      if (this.steerPointer >= 0) return;
      this.active = true;
      this.steerPointer = e.pointerId;
      capture(this.pad, e.pointerId);
      this.steerOrigin = e.clientX;
      const r = this.pad.getBoundingClientRect();
      this.base.style.left = `${e.clientX - r.left}px`;
      this.base.style.top = `${e.clientY - r.top}px`;
      this.base.classList.add('on');
      this.moveSteer(e.clientX);
    });
    this.pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.steerPointer) this.moveSteer(e.clientX);
    });
    const endSteer = (e: PointerEvent) => {
      if (e.pointerId !== this.steerPointer) return;
      this.steerPointer = -1;
      this.steer = 0;
      this.knob.style.transform = '';
      this.base.classList.remove('on');
    };
    this.pad.addEventListener('pointerup', endSteer);
    this.pad.addEventListener('pointercancel', endSteer);

    const button = (b: Button, cls: string, label: string) => {
      const el = document.createElement('div');
      el.className = `tc-btn ${cls}`;
      el.textContent = label;
      root.appendChild(el);
      el.addEventListener('pointerdown', (e) => {
        this.active = true;
        capture(el, e.pointerId);
        this.held[b] = true;
        el.classList.add('down');
      });
      const up = () => {
        this.held[b] = false;
        el.classList.remove('down');
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    button('drift', 'tc-drift', 'DRIFT');
    button('item', 'tc-item', 'ITEM');
    button('brake', 'tc-brake', 'BRAKE');
    button('lookBack', 'tc-look', '◀▶');

    const pause = document.createElement('div');
    pause.className = 'tc-pause';
    pause.textContent = 'II';
    pause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      onPause();
    });
    root.appendChild(pause);
    parent.appendChild(root);
  }

  private moveSteer(x: number): void {
    // Full lock at about a thumb's width of travel.
    const range = Math.max(48, Math.min(90, window.innerWidth * 0.08));
    const dx = clamp((x - this.steerOrigin) / range, -1, 1);
    this.steer = Math.abs(dx) < 0.08 ? 0 : dx;
    this.knob.style.transform = `translateX(${dx * 40}px)`;
  }

  show(on: boolean): void {
    this.root.classList.toggle('show', on);
    if (!on) this.release();
  }

  /** Lets go of everything (screens changing under a held finger). */
  release(): void {
    this.steerPointer = -1;
    this.steer = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('on');
    for (const b of Object.keys(this.held) as Button[]) this.held[b] = false;
    for (const el of this.root.querySelectorAll('.down')) el.classList.remove('down');
  }
}

/** Keyboard/gamepad plus the on-screen controls, whichever is being used. */
export class TouchInput implements InputSource {
  readonly kind = 'local' as const;
  private readonly local = new LocalInput();
  private readonly out = blankInput();

  constructor(private readonly touch: TouchControls) {}

  poll(view: RaceView): FrameInput {
    const o = this.out, l = this.local.poll(), t = this.touch;
    Object.assign(o, l);
    if (!t.active) return o;
    if (Math.abs(t.steer) > Math.abs(o.steer)) o.steer = t.steer;
    // Gas is automatic after the start (no burnout from holding it early).
    const gas = view.state.phase === 'racing' && !t.held.brake ? 1 : 0;
    o.throttle = Math.max(o.throttle, gas);
    o.brake = Math.max(o.brake, t.held.brake ? 1 : 0);
    o.drift ||= t.held.drift;
    o.useItem ||= t.held.item;
    o.lookBack ||= t.held.lookBack;
    return o;
  }
}
