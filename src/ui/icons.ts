// Original item icons as inline SVG.
import type { ItemType } from '../sim/types';

const wrap = (body: string) => `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const chevron = (y: number, c: string) => `<path d="M14 ${y + 18} L32 ${y} L50 ${y + 18} L50 ${y + 28} L32 ${y + 10} L14 ${y + 28} Z" fill="${c}" stroke="#7a3a00" stroke-width="2"/>`;

export const ITEM_ICONS: Record<ItemType, string> = {
  zoom: wrap(`<circle cx="32" cy="32" r="28" fill="#2a8cff"/>${chevron(14, '#ffd23a')}`),
  tripleZoom: wrap(`<circle cx="32" cy="32" r="28" fill="#2a8cff"/>${chevron(6, '#ffd23a')}${chevron(20, '#ffb02a')}${chevron(34, '#ff8a2a')}`),
  peel: wrap(`<path d="M14 40 Q32 6 50 22 Q40 22 34 34 Q28 48 14 40 Z" fill="#ffd93a" stroke="#8a6a00" stroke-width="3"/><circle cx="48" cy="21" r="3" fill="#5a3a00"/>`),
  bouncePuck: wrap(`<ellipse cx="32" cy="38" rx="24" ry="12" fill="#1f9a34"/><ellipse cx="32" cy="32" rx="24" ry="12" fill="#35d04a" stroke="#fff" stroke-width="4"/>`),
  seekerPuck: wrap(`<ellipse cx="32" cy="38" rx="24" ry="12" fill="#a01f1c"/><ellipse cx="32" cy="32" rx="24" ry="12" fill="#e8332e" stroke="#fff" stroke-width="4"/><circle cx="32" cy="30" r="6" fill="#ffee55"/>`),
  crownComet: wrap(`<path d="M6 54 L18 50 L10 44 Z" fill="#ffb02a"/><path d="M14 46 L14 26 L24 36 L32 18 L40 36 L50 26 L50 46 Z" fill="#ffcf3a" stroke="#8a5a00" stroke-width="3"/><circle cx="32" cy="40" r="4" fill="#55d6ff"/>`),
  supernova: wrap(`<path d="M32 4 L39 24 L60 24 L43 37 L49 58 L32 45 L15 58 L21 37 L4 24 L25 24 Z" fill="#ffe14a" stroke="#ff8a00" stroke-width="3"/><circle cx="26" cy="30" r="3" fill="#333"/><circle cx="38" cy="30" r="3" fill="#333"/>`),
  shrinkRay: wrap(`<rect x="8" y="26" width="32" height="14" rx="5" fill="#8a4fd0" stroke="#3a1a60" stroke-width="3"/><rect x="14" y="38" width="8" height="14" rx="2" fill="#5a2a90"/><path d="M40 33 L58 22 M40 33 L60 33 M40 33 L58 44" stroke="#7af0ff" stroke-width="4" stroke-linecap="round"/>`),
};

export const ORDINAL = (n: number): string => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return n + (s || 'th');
};

export function ordinalSuffix(n: number): string {
  return ORDINAL(n).slice(String(n).length);
}

export function formatTime(ticks: number): string {
  const ms = Math.max(0, Math.round((ticks * 1000) / 60));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}
