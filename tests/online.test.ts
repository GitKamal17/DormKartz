import { describe, expect, it } from 'vitest';
import { RoomServer } from '../server/rooms';
import { packInput } from '../src/game/ghost';
import { applySnapshot, PROTOCOL_VERSION, type ServerMessage } from '../src/net/protocol';
import { createRace } from '../src/sim/race';
import { TICK_RATE } from '../src/sim/config';

function client(server: RoomServer) {
  const inbox: ServerMessage[] = [];
  let open = true;
  const c = server.connect({ send: (d) => inbox.push(JSON.parse(d)), close: () => (open = false) });
  return {
    inbox,
    get open() {
      return open;
    },
    send: (m: object) => c.message(JSON.stringify(m)),
    close: () => c.close(),
    last: <T extends ServerMessage['type']>(type: T) => [...inbox].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined,
  };
}

describe('online rooms', () => {
  it('creates, joins by code, races and returns to the lobby', () => {
    const server = new RoomServer();
    const host = client(server);
    host.send({ type: 'create', v: PROTOCOL_VERSION, name: 'Kamal' });
    const joined = host.last('joined')!;
    expect(joined.room.code).toMatch(/^[A-Z2-9]{4}$/);

    const friend = client(server);
    friend.send({ type: 'join', v: PROTOCOL_VERSION, code: joined.room.code.toLowerCase(), name: 'Friend' });
    const fj = friend.last('joined')!;
    expect(fj.you).not.toBe(joined.you);
    expect(host.last('room')!.room.players.map((p) => p.name)).toEqual(['Kamal', 'Friend']);

    // Characters are unique per room; only the host controls the race.
    friend.send({ type: 'pick', characterId: joined.room.players[0].characterId });
    expect(friend.last('error')!.message).toMatch(/already/);
    friend.send({ type: 'start' });
    expect(friend.last('error')!.message).toMatch(/host/);

    host.send({ type: 'settings', settings: { trackId: 'meadow-loop', cc: 150, cpus: false } });
    host.send({ type: 'start' });
    const start = friend.last('start')!;
    expect(start.race.config.karts.length).toBe(2);
    expect(start.race.config.speedClass).toBe(150);

    // The client rebuilds the same race and applies snapshots on top of it.
    const local = createRace(start.race.config, start.race.seed);
    for (let i = 0; i < 5 * TICK_RATE; i++) {
      friend.send({ type: 'input', i: packInput({ steer: 0, throttle: 1, brake: 0, drift: false, useItem: false, lookBack: false }) });
      server.advance();
    }
    const snap = friend.last('snap')!;
    applySnapshot(local, snap.s);
    const me = local.karts.find((k) => k.id === fj.you)!;
    const idle = local.karts.find((k) => k.id === joined.you)!;
    expect(local.phase).toBe('racing');
    expect(Math.hypot(me.vx, me.vz)).toBeGreaterThan(5);
    expect(Math.hypot(idle.vx, idle.vz)).toBeLessThan(1);
    expect(friend.inbox.some((m) => m.type === 'snap' && m.s.events.some((e) => e.type === 'countdown'))).toBe(true);

    // A dropped player keeps their seat and can rejoin with their token.
    friend.close();
    expect(host.last('room')!.room.players.find((p) => p.id === fj.you)!.connected).toBe(false);
    const again = client(server);
    again.send({ type: 'rejoin', v: PROTOCOL_VERSION, code: joined.room.code, token: fj.token });
    expect(again.last('joined')!.you).toBe(fj.you);
    expect(again.last('start')!.race.id).toBe(start.race.id);

    // Let CPUs (who take over finished humans) drive both karts home.
    const s = server.rooms.get(joined.room.code)!;
    for (const slot of s.race!.session.slots) slot.input = new (class {
      readonly kind = 'ai' as const;
      poll = () => ({ steer: 0, throttle: 0, brake: 0, drift: false, useItem: false, lookBack: false });
    })();
    for (const k of s.race!.session.state.karts) {
      k.finished = true;
      s.race!.session.state.finishOrder.push(k.id);
    }
    for (let i = 0; i < 5 * TICK_RATE && !host.last('end'); i++) server.advance();
    expect(host.last('end')!.order.length).toBe(2);
    expect(host.last('room')!.room.racing).toBe(false);
  });

  it('rejects unknown codes and old clients, and frees empty rooms', () => {
    const server = new RoomServer();
    const a = client(server);
    a.send({ type: 'join', v: PROTOCOL_VERSION, code: 'ZZZZ', name: 'x' });
    expect(a.last('error')!.message).toMatch(/No room/);
    a.send({ type: 'create', v: PROTOCOL_VERSION - 1, name: 'x' });
    expect(a.last('error')!.message).toMatch(/out of date/);
    a.send({ type: 'create', v: PROTOCOL_VERSION, name: 'x' });
    expect(server.rooms.size).toBe(1);
    a.send({ type: 'leave' });
    expect(server.rooms.size).toBe(0);
  });
});
