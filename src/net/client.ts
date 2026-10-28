// Browser side of the online connection: one WebSocket to the game server,
// reconnecting on its own (phones drop sockets when the screen locks) and
// rejoining the room with the seat token the server handed out.

import type { PlayerId } from '../sim/types';
import { encode, PROTOCOL_VERSION, type ClientMessage, type RoomInfo, type ServerMessage } from './protocol';

const SEAT_KEY = 'dormkartz.seat';

/**
 * Dev flag: `?lag=200` adds 200 ms of round trip (and `&jitter=40` up to 40 ms
 * extra each way) to see how online play feels on a bad connection.
 */
class FakeLag {
  private readonly half: number;
  private readonly jitter: number;
  private lastOut = 0;
  private lastIn = 0;

  constructor(params: URLSearchParams) {
    this.half = Math.max(0, Number(params.get('lag')) || 0) / 2;
    this.jitter = Math.max(0, Number(params.get('jitter')) || 0);
  }

  get on(): boolean {
    return this.half > 0 || this.jitter > 0;
  }

  /** Delays `fn`, never reordering messages going the same way (like TCP). */
  delay(dir: 'out' | 'in', fn: () => void): void {
    const now = performance.now();
    const at = Math.max(dir === 'out' ? this.lastOut : this.lastIn, now + this.half + Math.random() * this.jitter);
    if (dir === 'out') this.lastOut = at;
    else this.lastIn = at;
    setTimeout(fn, at - now);
  }
}

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
  /** This device's players in the room, P1 first (two for split screen). */
  mine: PlayerId[] = [];
  room: RoomInfo | null = null;
  private ws: WebSocket | null = null;
  private token = '';
  private retries = 0;
  private retryTimer = 0;
  private readonly lag = new FakeLag(new URLSearchParams(location.search));
  /** Round trip to the server in ms, measured every couple of seconds (-1 until known). */
  ping = -1;
  private pingTimer = 0;

  constructor(
    private readonly onMessage: (m: ServerMessage) => void,
    private readonly onStatus: (s: NetStatus) => void,
  ) {}

  get inRoom(): boolean {
    return !!this.room && this.mine.length > 0;
  }

  get isHost(): boolean {
    return this.inRoom && this.mine.includes(this.room!.hostId);
  }

  create(name: string): void {
    this.open({ type: 'create', v: PROTOCOL_VERSION, name });
  }

  join(code: string, name: string): void {
    this.open({ type: 'join', v: PROTOCOL_VERSION, code, name });
  }

  /**
   * After a page reload (or Android discarding the tab), takes our seat back.
   * With `only`, resumes only if the saved seat is in that room (an invite link to another room wins).
   */
  resume(only?: string): boolean {
    let seat: { code: string; token: string } | null = null;
    try {
      seat = JSON.parse(sessionStorage.getItem(SEAT_KEY) ?? 'null');
    } catch {
      // No storage: nothing to resume.
    }
    if (!seat?.code || !seat.token || (only && seat.code !== only)) return false;
    this.setStatus('reconnecting');
    this.open({ type: 'rejoin', v: PROTOCOL_VERSION, code: seat.code, token: seat.token });
    return true;
  }

  /** Seats a second player on this device (split screen). */
  addLocal(name: string): void {
    this.send({ type: 'add', name });
  }

  dropLocal(id: PlayerId): void {
    this.send({ type: 'drop', id });
  }

  send(m: ClientMessage): void {
    const ws = this.ws;
    if (ws?.readyState !== WebSocket.OPEN) return;
    const data = encode(m);
    if (this.lag.on) this.lag.delay('out', () => ws.readyState === WebSocket.OPEN && ws.send(data));
    else ws.send(data);
  }

  leave(): void {
    this.send({ type: 'leave' });
    this.reset();
  }

  private reset(): void {
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.pingTimer = 0;
    this.ping = -1;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = null;
      ws.close();
    }
    this.room = null;
    this.mine = [];
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
      ws.send(encode(first));
    };
    ws.onmessage = (e) => {
      if (this.lag.on) this.lag.delay('in', () => this.ws === ws && this.receive(String(e.data), first));
      else this.receive(String(e.data), first);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.token && this.room) this.retry();
      else this.fail();
    };
  }

  private receive(data: string, first: ClientMessage): void {
    let m: ServerMessage;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m.type === 'joined') {
      this.mine = m.you;
      this.token = m.token;
      this.room = m.room;
      this.setStatus('open');
      this.startPings();
      try {
        sessionStorage.setItem(SEAT_KEY, JSON.stringify({ code: m.room.code, token: m.token }));
      } catch {
        // Ignored: reloading the page will just need the code again.
      }
    } else if (m.type === 'room') this.room = m.room;
    else if (m.type === 'pong') this.ping = Math.round(performance.now() - m.t);
    else if (m.type === 'error' && first.type === 'rejoin' && !this.inRoomConfirmed()) {
      // The room is gone; stop trying.
      this.reset();
    }
    this.onMessage(m);
  }

  /** Measures the round trip every 2 s and tells the server, so the room can show everyone's ping. */
  private startPings(): void {
    if (this.pingTimer) return;
    const ping = () => this.send({ type: 'ping', t: performance.now(), ...(this.ping >= 0 ? { ms: this.ping } : {}) });
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
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
