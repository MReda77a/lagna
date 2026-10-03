/* ==========================================================
   Lagna — one room on the server.
   Used by BOTH servers: server/index.js (Node) and cloudflare/worker.js (Cloudflare).
   A "conn" is anything with send(obj) and close(), plus a pid field we set.

   Messages from a player:
     {t:'create', pid, name, g, set:{name,pub,teams,count,packs}}
     {t:'join', pid, name, g}
     {t:'input', d:{k:'ans'|'peek'|'adopt'|'turn'|'back'|'mark'|'out', ...}}
     {t:'cmd', c:'start'|'addbot'|'rmbot'|'teams'|'pub'|'count'|'packs'|'cfg'|'next'|'end'|'newgame', v, k}
     {t:'leave'}
   Messages to a player:
     {t:'ok', code}  {t:'err', e}  {t:'state', V}  {t:'kicked'}
   ========================================================== */
(function(){
  const cleanName = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || '؟';
  const cleanRoom = n => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 18);
  const cleanPid = p => (typeof p === 'string' && /^[a-z0-9]{4,16}$/.test(p)) ? p : null;

  class RoomCore {
    constructor(code, E, hooks){
      this.code = code; this.E = E; this.hooks = hooks || {};
      this.host = null;
      this.conns = new Map();   // pid -> conn
      this.sent = new Map();    // pid -> last state sent, so we only send what changed
      this.emptySince = null; this.lastSummary = '';
    }
    /** What the "open rooms" list shows. */
    summary(){
      const h = this.host; if(!h) return { c:this.code, open:false };
      const o = h.p(h.me);
      return { c:this.code, name:h.set.name, h:o ? o.name : '؟', hg:o ? o.g : 'm', n:h.P.length, m:this.E.MAXP, teams:h.set.teams ? 1 : 0,
               open: !!(h.set.pub && h.ph === 'lobby' && h.P.length < this.E.MAXP && this.conns.size > 0) };
    }
    changed(){
      const s = JSON.stringify(this.summary());
      if(s === this.lastSummary) return;
      this.lastSummary = s;
      this.hooks.changed && this.hooks.changed();
    }

    handle(conn, msg){
      if(!msg || typeof msg !== 'object') return;
      switch(msg.t){
        case 'create': return this.create(conn, msg);
        case 'join':   return this.join(conn, msg);
        case 'input':  return this.input(conn, msg.d);
        case 'cmd':    return this.cmd(conn, msg);
        case 'leave':  return this.close(conn, true);
      }
    }
    create(conn, msg){
      const pid = cleanPid(msg.pid);
      if(!pid) return conn.send({t:'err', e:'bad'});
      if(this.host && this.conns.size > 0) return conn.send({t:'err', e:'exists'});
      const h = new this.E.Host(this.code, pid);
      const s = msg.set || {};
      h.set.name = cleanRoom(s.name) || ('لجنة ' + cleanName(msg.name));
      h.set.pub = s.pub !== false;
      h.add(pid, cleanName(msg.name), msg.g, false);
      this.host = h; this.sent.clear();
      h.cmd(pid, {c:'teams', v:!!s.teams});
      h.cmd(pid, {c:'count', v:+s.count});
      h.cmd(pid, {c:'packs', v:s.packs});
      conn.send({t:'ok', code:this.code});
      this.attach(conn, pid);
    }
    join(conn, msg){
      const pid = cleanPid(msg.pid), h = this.host;
      if(!pid || !h) return conn.send({t:'err', e:'notfound'});
      if(!h.p(pid)){
        if(h.P.length >= this.E.MAXP) return conn.send({t:'err', e:'full'});
        h.add(pid, cleanName(msg.name), msg.g, false);   // in the middle of a game they sit down at the next question
      }
      if(!this.conns.size && !this.conns.has(h.me)) h.me = pid;   // the owner left an empty room: whoever walks in first owns it
      conn.send({t:'ok', code:this.code});
      this.attach(conn, pid);
    }
    attach(conn, pid){
      const old = this.conns.get(pid);
      if(old && old !== conn){ old.pid = null; old.send({t:'kicked'}); try{ old.close(); }catch(e){} }
      this.conns.set(pid, conn); conn.pid = pid;
      this.host.setConn(pid, true);
      this.emptySince = null;
      this.sendState(); this.changed();
    }
    close(conn, explicit){
      const pid = conn.pid; if(!pid) return;
      conn.pid = null;
      if(this.conns.get(pid) !== conn) return;
      this.conns.delete(pid); this.sent.delete(pid);
      const h = this.host; if(!h) return;
      // In the lobby a player who leaves is removed; during a game they keep their seat and can reconnect.
      if(h.ph === 'lobby' || (explicit && h.ph === 'over')) h.remove(pid);
      else h.setConn(pid, false);
      if(h.me === pid){ const next = [...this.conns.keys()][0]; if(next) h.me = next; }
      if(this.conns.size === 0) this.emptySince = Date.now();
      this.sendState(); this.changed();
    }
    input(conn, d){
      const pid = conn.pid, h = this.host;
      if(!pid || !h || !d || typeof d !== 'object') return;
      let size = 0; try{ size = JSON.stringify(d).length; }catch(e){ return; }
      if(size > 400) return;
      h.act(pid, d);
      this.sendState();
    }
    cmd(conn, d){
      const h = this.host;
      if(!h || !conn.pid) return;
      h.tick(Date.now());
      h.cmd(conn.pid, d);
      this.sendState(); this.changed();
    }
    /** Called ten times a second while someone is connected. */
    tick(){
      const h = this.host; if(!h) return;
      h.tick(Date.now()); this.sendState();
    }
    sendState(){
      const h = this.host; if(!h) return;
      for(const [pid, conn] of this.conns){
        const body = JSON.stringify(h.view(pid));   // only what THIS player may see
        if(this.sent.get(pid) === body) continue;
        this.sent.set(pid, body);
        conn.sendRaw ? conn.sendRaw('{"t":"state","V":' + body + '}') : conn.send({t:'state', V:JSON.parse(body)});
      }
    }
  }

  const LagnaRoom = { RoomCore };
  if(typeof globalThis !== 'undefined') globalThis.LagnaRoom = LagnaRoom;
  if(typeof module !== 'undefined' && module.exports) module.exports = LagnaRoom;
})();
