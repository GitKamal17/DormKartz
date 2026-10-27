import { load, save } from './storage';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  showFps: boolean;
}

const DEFAULTS: Settings = { master: 0.8, music: 0.55, sfx: 0.8, showFps: false };

export function loadSettings(): Settings {
  return { ...DEFAULTS, ...load<Partial<Settings>>('settings', {}) };
}

export function saveSettings(s: Settings): void {
  save('settings', s);
}
