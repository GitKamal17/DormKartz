// Browser side of the online connection: one WebSocket to the game server,
// reconnecting on its own (phones drop sockets when the screen locks) and
// rejoining the room with the seat token the server handed out.

import type { PlayerId } from '../sim/types';
import { encode, PROTOCOL_VERSION, type ClientMessage, type RoomInfo, type ServerMessage } from './protocol';

const SEAT_KEY = 'dormkartz.seat';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting';

/** `?server=wss://host` or VITE_SERVER_URL point at a separate server; by default it's the page's own host. */
export function serverUrl(): string {
  const override = new URLSearchParams(location.search).get('server') ?? import.meta.env.VITE_SERVER_URL;
  if (override) {
    const u = override.replace(/^http/, 'ws');
    return u.endsWith('/ws') ? u : u.replace(/\/$/, '') + '/ws';
  }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

export class NetClient {
  status: NetStatus = 'idle';
  you: PlayerId = -1;
  room: RoomInfo | null = null;
  private ws: WebSocket | null = null;
  private token = '';
  private retries = 0;
  private retryTimer = 0;
  private lastInput = -1;
  private lastInputAt = 0;

  constructor(
    private readonly onMessage: (m: ServerMessage) => void,
    private readonly onStatus: (s: NetStatus) => void,
  ) {}

  get inRoom(): boolean {
    return !!this.room && this.you >= 0;
  }

  get isHost(): boolean {
    return this.inRoom && this.room!.hostId === this.you;
  }

  create(name: string): void {
    this.open({ type: 'create', v: PROTOCOL_VERSION, name });
  }

  join(code: string, name: string): void {
    this.open({ type: 'join', v: PROTOCOL_VERSION, code, name });
  }

  /** After a page reload (or Android discarding the tab), takes our seat back. */
  resume(): boolean {
    let seat: { code: string; token: string } | null = null;
    try {
      seat = JSON.parse(sessionStorage.getItem(SEAT_KEY) ?? 'null');
    } catch {
      // No storage: nothing to resume.
    }
    if (!seat?.code || !seat.token) return false;
    this.setStatus('reconnecting');
    this.open({ type: 'rejoin', v: PROTOCOL_VERSION, code: seat.code, token: seat.token });
    return true;
  }

  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(m));
  }

  /** Sends the packed input when it changes, and a few times a second regardless. */
  sendInput(packed: number, now: number): void {
    if (packed === this.lastInput && now - this.lastInputAt < 200) return;
    this.lastInput = packed;
    this.lastInputAt = now;
    this.send({ type: 'input', i: packed });
  }

  leave(): void {
    this.send({ type: 'leave' });
    this.reset();
  }

  private reset(): void {
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = null;
      ws.close();
    }
    this.room = null;
    this.you = -1;
    this.token = '';
    this.retries = 0;
    try {
      sessionStorage.removeItem(SEAT_KEY);
    } catch {
      // Ignored.
    }
    this.setStatus('idle');
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.onStatus(s);
  }

  private open(first: ClientMessage): void {
    clearTimeout(this.retryTimer);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send(first);
      return;
    }
    if (this.ws) {
      this.ws.onclose = this.ws.onmessage = this.ws.onerror = null;
      this.ws.close();
    }
    if (first.type !== 'rejoin') this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(serverUrl());
    } catch {
      this.fail();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.lastInput = -1;
      ws.send(encode(first));
    };
    ws.onmessage = (e) => {
      let m: ServerMessage;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.type === 'joined') {
        this.you = m.you;
        this.token = m.token;
        this.room = m.room;
        this.setStatus('open');
        try {
          sessionStorage.setItem(SEAT_KEY, JSON.stringify({ code: m.room.code, token: m.token }));
        } catch {
          // Ignored: reloading the page will just need the code again.
        }
      } else if (m.type === 'room') this.room = m.room;
      else if (m.type === 'error' && first.type === 'rejoin' && !this.inRoomConfirmed()) {
        // The room is gone; stop trying.
        this.reset();
      }
      this.onMessage(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.token && this.room) this.retry();
      else this.fail();
    };
  }

  private inRoomConfirmed(): boolean {
    return this.status === 'open';
  }

  private fail(): void {
    this.reset();
    this.onMessage({ type: 'error', message: "Couldn't reach the game server. Check your connection and try again." });
  }

  /** Reconnects with backoff and asks for our old seat back. */
  private retry(): void {
    this.setStatus('reconnecting');
    if (this.retries >= 12) {
      this.fail();
      return;
    }
    const delay = Math.min(4000, 300 * 2 ** this.retries++);
    this.retryTimer = window.setTimeout(() => {
      if (!this.room) return;
      this.open({ type: 'rejoin', v: PROTOCOL_VERSION, code: this.room.code, token: this.token });
    }, delay);
  }
}
