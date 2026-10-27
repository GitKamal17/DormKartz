// All sound is synthesized with the Web Audio API: no audio files.

import { SeededRandom } from '../sim/rng';
import type { MusicDef } from '../sim/track/types';
import type { KartState, PlayerId, RaceEvent } from '../sim/types';

const SCALES: Record<MusicDef['scale'], number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
};

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

class EngineVoice {
  private readonly osc1: OscillatorNode;
  private readonly osc2: OscillatorNode;
  private readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
  private readonly squeal: AudioBufferSourceNode;
  private readonly squealGain: GainNode;

  constructor(ctx: AudioContext, out: AudioNode, noise: AudioBuffer) {
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 600;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    const mix2 = ctx.createGain();
    mix2.gain.value = 0.35;
    this.osc1.connect(this.filter);
    this.osc2.connect(mix2).connect(this.filter);
    this.filter.connect(this.gain).connect(out);
    this.osc1.start();
    this.osc2.start();
    this.squeal = ctx.createBufferSource();
    this.squeal.buffer = noise;
    this.squeal.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 6;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squeal.connect(bp).connect(this.squealGain).connect(out);
    this.squeal.start();
  }

  /** Scales the voice down when several local players' engines play at once. */
  mix = 1;

  update(ctx: AudioContext, k: KartState, throttle: number, active: boolean): void {
    const t = ctx.currentTime;
    const speed = Math.hypot(k.vx, k.vz);
    const boost = k.boostTicks > 0 ? 40 : 0;
    const f = 48 + speed * 4.2 + boost + (k.grounded ? 0 : 25);
    this.osc1.frequency.setTargetAtTime(f, t, 0.05);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.filter.frequency.setTargetAtTime(400 + speed * 40 + throttle * 600, t, 0.08);
    const vol = active && k.fallTicks === 0 ? 0.05 + throttle * 0.07 + Math.min(0.06, speed * 0.002) : 0;
    this.gain.gain.setTargetAtTime(vol * this.mix, t, 0.08);
    const sq = active && k.drift !== 0 && k.grounded ? 0.05 + k.driftTier * 0.02 : 0;
    this.squealGain.gain.setTargetAtTime(sq * this.mix, t, 0.04);
  }

  stop(): void {
    try {
      this.osc1.stop();
      this.osc2.stop();
      this.squeal.stop();
    } catch {
      /* already stopped */
    }
    this.gain.disconnect();
    this.squealGain.disconnect();
  }
}

class Music {
  private timer = 0;
  private nextTime = 0;
  private step = 0;
  private readonly bars: number[][];
  private readonly melody: (number | null)[];
  private readonly spb: number;
  stopped = false;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly noise: AudioBuffer,
    private readonly def: MusicDef,
  ) {
    const r = new SeededRandom(def.seed);
    const scale = SCALES[def.scale];
    const progressions = [
      [0, 4, 5, 3],
      [0, 5, 3, 4],
      [0, 3, 4, 4],
      [5, 3, 0, 4],
      [0, 6, 5, 4],
    ];
    const prog = progressions[r.int(0, progressions.length - 1)];
    this.bars = prog.map((deg) => [0, 2, 4].map((o) => {
      const idx = deg + o;
      return def.root + scale[idx % 7] + 12 * Math.floor(idx / 7);
    }));
    // A 32-step (two-bar) melody built from the scale, reused with variation.
    this.melody = [];
    let deg = r.int(0, 6);
    for (let i = 0; i < 64; i++) {
      if (r.next() < (def.style === 'chill' ? 0.45 : 0.6)) {
        deg = Math.max(0, Math.min(13, deg + r.int(-2, 2)));
        this.melody.push(def.root + 12 + scale[deg % 7] + 12 * Math.floor(deg / 7));
      } else this.melody.push(null);
    }
    this.spb = 60 / def.tempo / 4; // seconds per 16th
  }

  start(): void {
    this.nextTime = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    this.stopped = true;
    window.clearInterval(this.timer);
  }

  private schedule(): void {
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += this.spb * (this.def.style === 'bouncy' && this.step % 2 === 0 ? 1.12 : this.def.style === 'bouncy' ? 0.88 : 1);
      this.step++;
    }
  }

  private tone(freq: number, t: number, dur: number, type: OscillatorType, vol: number, attack = 0.005): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private drum(t: number, kind: 'kick' | 'snare' | 'hat', vol: number): void {
    if (kind === 'kick') {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g).connect(this.out);
      o.start(t);
      o.stop(t + 0.22);
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1800;
    const g = this.ctx.createGain();
    const dur = kind === 'hat' ? 0.04 : 0.14;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private playStep(step: number, t: number): void {
    const s16 = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const chord = this.bars[bar];
    const style = this.def.style;
    const lead: OscillatorType = style === 'synth' ? 'sawtooth' : style === 'spooky' ? 'sine' : style === 'chill' ? 'triangle' : 'square';
    // Bass.
    const bassPattern = style === 'driving' || style === 'epic' || style === 'synth' ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 6, 8, 14];
    if (bassPattern.includes(s16)) this.tone(midi(chord[0] - 24), t, this.spb * 1.8, style === 'spooky' ? 'sine' : 'triangle', 0.22);
    // Chord stabs / arpeggio.
    if (style === 'chill' || style === 'spooky') {
      if (s16 % 2 === 0) this.tone(midi(chord[(s16 / 2) % 3] + 12), t, this.spb * 3, 'triangle', 0.05);
    } else if (s16 === 4 || s16 === 12 || (style === 'bouncy' && s16 % 4 === 2)) {
      for (const n of chord) this.tone(midi(n), t, this.spb * 1.5, 'square', 0.025);
    }
    // Melody (skips every other bar pair for breathing room).
    const m = this.melody[(step % 64)];
    if (m !== null && Math.floor(step / 64) % 2 === 0) this.tone(midi(m), t, this.spb * 1.6, lead, style === 'synth' ? 0.035 : 0.045);
    else if (m !== null && s16 % 4 === 0) this.tone(midi(m - 12), t, this.spb * 2, 'triangle', 0.03);
    // Drums.
    const kick = style === 'chill' ? [0, 10] : style === 'spooky' ? [0, 8] : [0, 4, 8, 12];
    if (kick.includes(s16)) this.drum(t, 'kick', 0.5);
    if (style !== 'spooky' && (s16 === 4 || s16 === 12)) this.drum(t, 'snare', 0.25);
    if (style !== 'spooky' && s16 % 2 === 0) this.drum(t, 'hat', 0.08);
  }
}

export const MENU_MUSIC: MusicDef = { tempo: 118, root: 62, scale: 'mixolydian', style: 'bouncy', seed: 5 };

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private engines = new Map<PlayerId, EngineVoice>();
  private song: Music | null = null;
  private vol = { master: 0.8, music: 0.55, sfx: 0.8 };
  private rouletteNext = 0;

  /** Must be called from a user gesture before any sound plays. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
    this.music = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.setVolumes(this.vol.master, this.vol.music, this.vol.sfx);
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.vol = { master, music, sfx };
    if (!this.ctx) return;
    this.master.gain.value = master;
    this.music.gain.value = music * 0.6;
    this.sfx.gain.value = sfx;
  }

  suspend(paused: boolean): void {
    if (!this.ctx) return;
    if (paused) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private songDef: MusicDef | null = null;

  startMusic(def: MusicDef): void {
    if (this.song && this.songDef === def) return;
    this.stopMusic();
    if (!this.ctx) return;
    this.songDef = def;
    this.song = new Music(this.ctx, this.music, this.noise, def);
    this.song.start();
  }

  stopMusic(): void {
    this.song?.stop();
    this.song = null;
    this.songDef = null;
  }

  startEngines(ids: PlayerId[]): void {
    this.stopEngines();
    if (!this.ctx) return;
    for (const id of ids) {
      const v = new EngineVoice(this.ctx, this.sfx, this.noise);
      v.mix = 1 / Math.sqrt(ids.length);
      this.engines.set(id, v);
    }
  }

  stopEngines(): void {
    for (const e of this.engines.values()) e.stop();
    this.engines.clear();
  }

  updateEngine(id: PlayerId, k: KartState, throttle: number, active: boolean): void {
    if (!this.ctx) return;
    this.engines.get(id)?.update(this.ctx, k, throttle, active);
    if (k.rouletteTicks > 0 && this.ctx.currentTime > this.rouletteNext) {
      this.blip(1200 + Math.random() * 600, 0.03, 'square', 0.05);
      this.rouletteNext = this.ctx.currentTime + 0.07;
    }
  }

  // --- One-shot sounds ------------------------------------------------------

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(dur: number, vol: number, from: number, to: number, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  menuMove(): void {
    this.blip(660, 0.05, 'square', 0.04);
  }

  menuConfirm(): void {
    this.blip(880, 0.08, 'square', 0.05);
    this.blip(1320, 0.1, 'square', 0.04, undefined, 0.06);
  }

  menuBack(): void {
    this.blip(440, 0.08, 'square', 0.04, 300);
  }

  menuDeny(): void {
    this.blip(160, 0.14, 'square', 0.05, 120);
  }

  /** Plays sounds for events that matter to the listening players. */
  onEvents(events: RaceEvent[], listeners: Set<PlayerId>, near: (id: PlayerId) => number): void {
    if (!this.ctx) return;
    for (const e of events) {
      const mine = 'kart' in e && listeners.has(e.kart);
      const vol = 'kart' in e ? (mine ? 1 : near(e.kart)) : 1;
      if (vol < 0.05) continue;
      switch (e.type) {
        case 'countdown':
          if (e.n > 0) this.blip(440, 0.25, 'square', 0.12);
          else this.blip(880, 0.6, 'square', 0.14);
          break;
        case 'boost':
          if (!mine) break;
          this.hiss(0.6, 0.35, 400, 3000);
          this.blip(180, 0.4, 'sawtooth', 0.08, 420);
          break;
        case 'driftTier':
          if (mine) this.blip([0, 880, 1175, 1568][e.tier], 0.12, 'triangle', 0.12);
          break;
        case 'hit':
          this.hiss(0.4, 0.4 * vol, 1500, 200, 'lowpass');
          this.blip(400, 0.4, 'square', 0.1 * vol, 80);
          break;
        case 'wall':
          if (mine && e.strength > 4) this.blip(90, 0.15, 'sine', Math.min(0.3, e.strength * 0.015));
          break;
        case 'bump':
          if (mine) this.blip(120, 0.1, 'square', 0.08);
          break;
        case 'itemGet':
          if (mine) this.blip(1400, 0.08, 'square', 0.05);
          break;
        case 'itemReady':
          if (mine) {
            this.blip(1046, 0.1, 'triangle', 0.1);
            this.blip(1568, 0.15, 'triangle', 0.1, undefined, 0.08);
          }
          break;
        case 'itemUse':
          if (e.item === 'zoom' || e.item === 'tripleZoom') break;
          this.blip(900, 0.2, 'square', 0.08 * vol, 300);
          break;
        case 'lap':
          if (mine) [784, 988, 1175].forEach((f, i) => this.blip(f, 0.15, 'square', 0.08, undefined, i * 0.1));
          break;
        case 'finish':
          if (mine) [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.blip(f, 0.22, 'square', 0.09, undefined, i * 0.13));
          break;
        case 'fall':
          if (mine) this.blip(700, 0.9, 'sine', 0.12, 120);
          break;
        case 'respawn':
          if (mine) this.blip(300, 0.4, 'triangle', 0.08, 900);
          break;
        case 'jump':
          if (mine) this.blip(300, 0.2, 'triangle', 0.06, 600);
          break;
        case 'trick':
          if (mine) this.blip(1200, 0.15, 'square', 0.06, 1800);
          break;
        case 'land':
          if (mine) this.blip(100, 0.12, 'sine', 0.12);
          break;
        case 'explode':
          this.hiss(1.2, 0.6, 2000, 60, 'lowpass');
          this.blip(70, 0.8, 'sine', 0.3, 30);
          break;
        case 'shrink':
          this.blip(1800, 0.7, 'sawtooth', 0.07, 150);
          break;
        case 'star':
          if (mine) [1046, 1318, 1568, 2093].forEach((f, i) => this.blip(f, 0.12, 'triangle', 0.08, undefined, i * 0.06));
          break;
        case 'blocked':
          this.blip(600, 0.1, 'square', 0.08 * vol, 900);
          break;
      }
    }
  }
}
