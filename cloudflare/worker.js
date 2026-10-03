/* ==========================================================
   Lagna — Cloudflare Worker (free plan).
   - Static files (public/) are served by Cloudflare.
   - /ws?code=1234  → the room's Durable Object (runs that room's game).
   - /api/rooms     → the list of open public rooms.
   ========================================================== */
import { DurableObject } from 'cloudflare:workers';
import '../public/questions.js';   // defines globalThis.LagnaQuestions
import '../public/engine.js';      // defines globalThis.LagnaEngine
import '../shared/room.js';        // defines globalThis.LagnaRoom

const E = globalThis.LagnaEngine;
const { RoomCore } = globalThis.LagnaRoom;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      const code = String(url.searchParams.get('code') || '');
      if (!/^\d{4}$/.test(code)) return new Response('bad code', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
    }
    if (url.pathname === '/api/rooms') {
      return env.LOBBY.get(env.LOBBY.idFromName('main')).fetch('https://lobby/list');
    }
    if (url.pathname === '/health') return Response.json({ ok: true });
    return env.ASSETS.fetch(request);
  },
};

/** One Durable Object per room code. It keeps the game in memory while people are connected. */
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = null; this.timer = null; this.lastBeat = 0;
  }
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const code = String(new URL(request.url).searchParams.get('code') || '');
    if (!this.core) this.core = new RoomCore(code, E, { changed: () => this.report() });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const conn = {
      pid: null,
      send: obj => { try { server.send(JSON.stringify(obj)); } catch (e) {} },
      sendRaw: str => { try { server.send(str); } catch (e) {} },
      close: () => { try { server.close(1000, 'replaced'); } catch (e) {} },
    };
    server.addEventListener('message', ev => {
      if (typeof ev.data !== 'string' || ev.data.length > 16000) return;
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!this.core.host && msg.t !== 'create') return conn.send({ t: 'err', e: 'notfound' });
      try { this.core.handle(conn, msg); } catch (e) { console.error(e); }
      this.ensureTick();
    });
    const onClose = () => { try { this.core.close(conn, false); } catch (e) { console.error(e); } this.ensureTick(); };
    server.addEventListener('close', onClose);
    server.addEventListener('error', onClose);
    return new Response(null, { status: 101, webSocket: client });
  }
  /** Run the game loop only while someone is connected, so the free plan lasts. */
  ensureTick() {
    const need = this.core && this.core.conns.size > 0;
    if (need && !this.timer) {
      this.timer = setInterval(() => {
        try { this.core.tick(); } catch (e) { console.error(e); }
        if (Date.now() - this.lastBeat > 30000) this.report();
      }, 100);
    } else if (!need && this.timer) {
      clearInterval(this.timer); this.timer = null;
      this.report();
    }
  }
  /** Tell the lobby whether this room is open (so it shows in "open rooms"). */
  report() {
    if (!this.core) return;
    this.lastBeat = Date.now();
    const lobby = this.env.LOBBY.get(this.env.LOBBY.idFromName('main'));
    this.ctx.waitUntil(lobby.fetch('https://lobby/update', { method: 'POST', body: JSON.stringify(this.core.summary()) }).catch(() => {}));
  }
}

/** A single Durable Object that remembers which rooms are open. */
export class Lobby extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.rooms = new Map(); }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/update' && request.method === 'POST') {
      let s; try { s = await request.json(); } catch (e) { return new Response('bad', { status: 400 }); }
      if (s && /^\d{4}$/.test(s.c || '')) {
        if (s.open) this.rooms.set(s.c, { c: s.c, name: String(s.name || '').slice(0, 18), h: String(s.h || '؟').slice(0, 14), hg: s.hg === 'f' ? 'f' : 'm', n: +s.n || 0, m: +s.m || 10, teams: s.teams ? 1 : 0, open: true, at: Date.now() });
        else this.rooms.delete(s.c);
      }
      return new Response('ok');
    }
    const now = Date.now();
    for (const [c, r] of this.rooms) if (now - r.at > 75000) this.rooms.delete(c);
    const list = [...this.rooms.values()].slice(0, 30).map(({ at, ...r }) => r);
    return Response.json(list, { headers: { 'Cache-Control': 'no-store' } });
  }
}
