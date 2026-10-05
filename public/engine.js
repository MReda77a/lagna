/* ==========================================================
   Lagna — game engine (shared by the server and the browser).
   The server runs one Host per room. Each player only ever receives
   their own view(), so nobody can read a paper they are not looking at.
   In the browser the same Host runs the offline game against the computer.
   ========================================================== */
(function(){
'use strict';
const Q = (typeof globalThis !== 'undefined' && globalThis.LagnaQuestions) || (typeof require !== 'undefined' ? require('./questions.js') : null);

const MAXP = 10;
const MIN_STUDENTS = 2, MIN_STUDENTS_TEAMS = 4;   // a human proctor is one more on top of these
const ROW_MIN = 2, ROW_MAX = 6;                   // how many can sit in one row in a team game
/* the wager: 1 = normal, 2 = double, 3 = triple. A lost wager costs LOSE points; triples are limited per game. */
const LOSE = { 1:0, 2:10, 3:30 };
const TRIPLES = { 10:2, 20:3, 30:4 };
const COUNTS = [10, 20, 30];
const REVEAL = 9;            // seconds the results of a question stay up
/* the numbers a room's owner can tune from the lobby */
const CFG = { qTime:15, peekTime:1.6, turnTime:0.5, budget:6, writeRate:0.5, catchPts:10, markPts:5 };
const CFG_RANGE = { qTime:[8,25], peekTime:[0.5,3], turnTime:[0.3,1], budget:[2,12], writeRate:[0.25,1.5], catchPts:[5,20], markPts:[0,10] };
/* how long each kind of question gets, relative to qTime */
const QMULT = { mc:1, tf:0.8, ord:1.4, num:1.2, vote:1 };
const TEACHER = 'الأستاذ';   // the computer proctor, when nobody takes the chair
const BOTS = [
  {name:'منى',g:'f',skill:0.8},{name:'كريم',g:'m',skill:0.5},{name:'حمادة',g:'m',skill:0.3},
  {name:'سارة',g:'f',skill:0.55},{name:'عمر',g:'m',skill:0.65},{name:'نور',g:'f',skill:0.4},
  {name:'ياسين',g:'m',skill:0.25},{name:'هبة',g:'f',skill:0.7},{name:'طارق',g:'m',skill:0.45}
];

/* ============ helpers ============ */
const rand = (a,b) => a + Math.random()*(b-a);
const pick = a => a[Math.floor(Math.random()*a.length)];
const shuffle = a => { a = a.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const clone = a => Array.isArray(a) ? a.slice() : a;
const rid = (n=6) => Array.from({length:n}, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random()*31)]).join('');

/* ============ answers ============
   mc / tf / vote: an option index.   ord: item ids in the order tapped (right order is 0,1,2,3).
   num: a number.  In a vote there is no right answer: the most-picked name wins. */
const isPick = q => q.t==='mc' || q.t==='tf' || q.t==='vote';
function keyOf(q, a){
  if(a===null || a===undefined) return null;
  if(q.t==='ord') return a.length===4 ? a.join('') : null;
  return ''+a;
}
const correctAns = q => q.t==='ord' ? [0,1,2,3] : q.a;
function posRight(a){ let k=0; for(let i=0;i<a.length;i++) if(a[i]===i) k++; return k; }
function wrongOrd(){
  let a=[0,1,2,3]; const i=Math.floor(Math.random()*3); [a[i],a[i+1]]=[a[i+1],a[i]];
  if(Math.random()<0.4) a=shuffle(a);
  return a.join('')==='0123' ? [1,0,2,3] : a;
}
function wrongNum(q){
  const a=q.a, sign=Math.random()<0.5?-1:1; let v;
  if(q.y) v=a+sign*Math.ceil(rand(2,45));
  else{ v=Math.round(a*(1+sign*rand(0.1,0.55))); if(v===a) v=a+sign*Math.max(1,Math.round(a*0.2)); }
  return Math.max(0,v);
}
/** What a player who does not know puts down. */
function guessAns(q){
  if(q.t==='ord') return wrongOrd();
  if(q.t==='num') return wrongNum(q);
  return Math.floor(Math.random()*q.o.length);
}
/** A deliberately wrong answer, shown to someone who is looking. */
function decoyAns(q, belief){
  if(isPick(q)) return pick(q.o.map((_,i)=>i).filter(i=>i!==belief));
  return guessAns(q);
}
/** Clean up an answer that came from a player; null if it makes no sense. */
function cleanAns(q, v){
  if(v===null || v===undefined) return null;
  if(isPick(q)) return (Number.isInteger(v) && v>=0 && v<q.o.length) ? v : null;
  if(q.t==='num') return (Number.isInteger(v) && v>=0 && v<=999999) ? v : null;
  if(q.t==='ord'){
    if(!Array.isArray(v) || v.length>4 || new Set(v).size!==v.length) return null;
    if(!v.every(x => Number.isInteger(x) && x>=0 && x<4)) return null;
    return v.length ? v.slice() : null;
  }
  return null;
}
function basePts(q, a){
  if(a===null || a===undefined) return 0;
  if(q.t==='ord'){ const k=posRight(a); return a.length===4 && k===4 ? 10 : 2*k; }
  return a===q.a ? 10 : 0;
}
/** Closest number wins 10, an exact hit wins 15. */
function scoreNums(q, list){
  let best=Infinity;
  list.forEach(e => { if(e.ans!==null) best=Math.min(best, Math.abs(e.ans-q.a)); });
  list.forEach(e => {
    const d = e.ans===null ? Infinity : Math.abs(e.ans-q.a);
    e.near = d===best && d!==Infinity; e.exact = d===0; e.base = e.near ? (e.exact?15:10) : 0;
  });
}
/** Whoever is with the most-picked name wins, if at least two people agree. */
function scoreVotes(q, list, voters){
  const c=q.o.map(()=>0);
  voters.forEach(s => { if(s.ans!==null) c[s.ans]++; });
  const top=Math.max(0, ...c);
  q.win = top>=2 ? c.map((n,i)=>n===top?i:-1).filter(i=>i>=0) : [];
  list.forEach(e => { e.base = (e.ans!==null && q.win.includes(e.ans)) ? 10 : 0; });
}
/** What an answer is worth once the wager on it is counted. */
function stakePts(base, bet){ return bet>1 ? (base>=10 ? base*bet : -LOSE[bet]) : base; }
const members = (g,t) => g.students.filter(s => s.team===t);
/** A team's wager is the lowest one among the members who answered: everyone has to raise for it to count. */
function teamBet(g, t){
  const m=members(g,t).filter(s => !s.away && keyOf(g.q,s.ans)!==null);
  return m.length ? Math.min.apply(null, m.map(s => s.bet||1)) : 1;
}
const cheaterOf = (g,t) => g.students.find(s => s.team===t && s.cheater) || null;
/** A team's sheet: how many members are on each answer, and which answer is ahead (none on a tie). */
function tally(g, t){
  const m=members(g,t).filter(s=>!s.away), c={}, sample={};
  let n=0, max=0, lead=null, tie=false;
  m.forEach(s => { const k=keyOf(g.q,s.ans); if(k!==null){ c[k]=(c[k]||0)+1; sample[k]=s.ans; n++; } });
  Object.keys(c).forEach(k => { if(c[k]>max){ max=c[k]; lead=k; tie=false; } else if(c[k]===max) tie=true; });
  if(tie) lead=null;
  return { c, n, size:m.length, max, lead, leadAns: lead===null?null:sample[lead], all: max>0 && max===m.length };
}

/* ============ one room's game ============ */
class Host {
  constructor(code, owner){
    this.code = code; this.me = owner;
    this.P = [];                 // everyone in the room, in the order they came in
    this.ph = 'lobby';           // lobby | play | over
    this.set = { name:'', pub:true, teams:false, count:20, packs:Q.PACKS.map(p=>p.id) };
    this.cfg = Object.assign({}, CFG);
    this.prPid = null;           // who chose to be the proctor; nobody = the computer proctors
    this.ch = [null,null];       // each row's chosen cheater in a team game; nobody = it goes round
    this.g = null; this.T = [0,0]; this.TA = [0,0];
    this.ev = []; this.evSeq = 0;
    this.last = Date.now();
  }
  p(pid){ return this.P.find(p => p.id===pid) || null; }
  proctor(){ return this.prPid ? this.p(this.prPid) : null; }
  minPlayers(){ return (this.set.teams ? MIN_STUDENTS_TEAMS : MIN_STUDENTS) + (this.proctor() ? 1 : 0); }
  /** How many students sit in each row (the proctor is not in a row). */
  rows(){ return [0,1].map(r => this.P.filter(p => p.row===r && p.id!==this.prPid).length); }
  canStart(){
    if(this.P.length<this.minPlayers()) return false;
    return !this.set.teams || Math.min.apply(null, this.rows())>=ROW_MIN;
  }
  /** Forget a chosen cheater who left, changed rows or took the proctor's chair. */
  fixCheaters(){
    [0,1].forEach(r => { const p=this.ch[r] && this.p(this.ch[r]); if(!p || p.row!==r || p.id===this.prPid) this.ch[r]=null; });
  }
  pool(){ const l=Q.QUESTIONS.filter(q => this.set.packs.includes(q.p)); return l.length>=4 ? l : Q.QUESTIONS; }

  add(pid, name, g, bot, skill){
    if(this.p(pid) || this.P.length>=MAXP) return null;
    const n=this.rows(), row = n[0]<=n[1] ? 0 : 1;   // new people go to the shorter row; they can move in the lobby
    const p = { id:pid, name, g: g==='f'?'f':'m', bot:!!bot, skill:skill||0, conn:true, out:false, pts:0, row, team:row, triples:0 };
    this.P.push(p);
    return p;
  }
  addBot(){
    const used=this.P.map(p=>p.name), b=BOTS.find(x=>!used.includes(x.name));
    return b ? this.add('bot'+rid(5), b.name, b.g, true, b.skill) : null;
  }
  removeBot(){
    for(let i=this.P.length-1;i>=0;i--) if(this.P[i].bot){ this.P.splice(i,1); this.fixCheaters(); return true; }
    return false;
  }
  remove(pid){ this.P = this.P.filter(p => p.id!==pid); if(this.prPid===pid) this.prPid=null; this.fixCheaters(); }
  /** Move a player to a row, if there is room in it. */
  seat(p, row){
    if(!p || (row!==0 && row!==1) || p.row===row) return;
    if(p.id!==this.prPid && this.rows()[row]>=ROW_MAX) return;
    p.row=row; this.fixCheaters();
  }
  /** A player's phone connected or dropped. In a game they keep their seat and can come back. */
  setConn(pid, on){
    const p=this.p(pid); if(!p || p.bot || p.conn===on) return;
    p.conn=on; if(on) p.out=false;
    if(this.ph==='play') this.event(on?'back':'left', p);
  }
  event(k, p){ this.ev.push({ i:++this.evSeq, k, n:p.name, g:p.g, id:p.id }); if(this.ev.length>8) this.ev.shift(); }

  /* ---------- the owner's buttons ---------- */
  cmd(pid, d){
    if(pid!==this.me || !d) return;
    const lobby = this.ph==='lobby', s=this.set;
    switch(d.c){
      case 'start': this.start(); break;
      case 'addbot': if(lobby) this.addBot(); break;
      case 'rmbot': if(lobby) this.removeBot(); break;
      case 'teams': if(lobby) s.teams=!!d.v; break;
      case 'move': if(lobby){ const t=this.p(d.id); if(t) this.seat(t, 1-t.row); } break;
      case 'pub': s.pub=!!d.v; break;
      case 'count': if(lobby && COUNTS.includes(d.v)) s.count=d.v; break;
      case 'packs': if(lobby && Array.isArray(d.v)){ const ok=Q.PACKS.map(p=>p.id).filter(id=>d.v.includes(id)); if(ok.length) s.packs=ok; } break;
      case 'cfg': if(lobby && CFG_RANGE[d.k] && typeof d.v==='number' && isFinite(d.v)){ const r=CFG_RANGE[d.k]; this.cfg[d.k]=Math.min(r[1],Math.max(r[0],d.v)); } break;
      case 'next': if(this.ph==='play' && this.g.phase==='reveal') this.nextQuestion(); break;
      case 'end': if(this.ph==='play'){ this.ph='lobby'; this.g=null; this.P.forEach(p=>{p.out=false;}); } break;
      case 'newgame': if(this.ph==='over'){ this.ph='lobby'; this.g=null; this.P=this.P.filter(p=>p.bot||p.conn); this.P.forEach(p=>{p.out=false;}); } break;
    }
  }
  start(){
    if(this.ph!=='lobby' || !this.canStart()) return false;
    /* the proctor is whoever chose the chair in the lobby, for the whole game; everyone else is a student.
       In a team game the rows are the ones people chose in the lobby. */
    const pr=this.proctor(), teams=!!this.set.teams, n3=TRIPLES[this.set.count]||3; let k=0;
    this.fixCheaters();
    this.P.forEach(p => { p.pts=0; p.out=false; p.triples=n3; p.team = p===pr ? -1 : (teams ? p.row : (k++)%2); });
    this.T=[0,0]; this.TA=[n3,n3];
    this.g = { teams:!!this.set.teams, qs:shuffle(this.pool()).slice(0,this.set.count), qi:0, prId: pr ? pr.id : null };
    this.ph='play'; this.last=Date.now();
    this.startQuestion();
    return true;
  }
  isAway(pl){ return !pl.bot && (!pl.conn || pl.out); }

  startQuestion(){
    const g=this.g, c=this.cfg;
    let q=g.qs[g.qi];
    if(q.t==='vote') q={ p:q.p, t:'vote', q:q.q, o:shuffle(this.P.map(p=>p.name)).slice(0,4), a:null, win:[] };
    /* the four choices come up in a new order every time, unless they are numbers or the question pins them */
    else if(q.t==='mc' && !q.fix && !q.o.every(x => /^[\d٠-٩\s\-–]+$/.test(x))){
      const perm=shuffle(q.o.map((_,i)=>i));
      q=Object.assign({}, q, { o:perm.map(i=>q.o[i]), a:perm.indexOf(q.a) });
    }
    g.q=q;
    /* a long question gets a few more seconds to be read */
    g.qT=Math.round(c.qTime*QMULT[q.t]) + (q.q.length>70 ? 5 : q.q.length>45 ? 3 : 0);
    const k=g.qT/15;
    g.phase='play'; g.elapsed=0; g.left=g.qT; g.hamR=0; g.hamL=0; g.fake=null; g.void=[false,false]; g.tres=null; g.tans=null;
    g.disp = q.t==='ord' ? shuffle([0,1,2,3]) : [0,1,2,3];
    if(q.t==='ord' && g.disp.join('')==='0123') g.disp=[2,0,3,1];

    /* who sits where: the proctor's chair is taken by a player, or by the computer */
    const prPl = g.prId ? this.p(g.prId) : null;
    const seated = this.P.filter(p => p!==prPl);
    if(g.teams) seated.sort((a,b) => a.team-b.team);
    g.rc = g.teams ? seated.filter(p=>p.team===0).length : Math.ceil(seated.length/2);
    g.students = seated.map((pl,i) => ({ idx:i, pl, name:pl.name, g:pl.g, human:!pl.bot, skill:pl.skill, team: g.teams ? pl.team : (i<g.rc?0:1), cheater:false, in:{peek:0} }));
    g.students.forEach(s => { s.away=this.isAway(s.pl); });

    const p = g.pr = { pl:prPl, name: prPl?prPl.name:TEACHER, g: prPl?prPl.g:'m', human: !!(prPl && !prPl.bot), away:false,
      st:'writing', stT:0, budget:c.budget, writePts:0, catches:[], lookCatches:[], lookAt:{}, fx:0, sinceBack:0, lookDur:0, wantBack:false,
      events:[], markAt:g.qT*rand(0.5,0.85), marked:false, markPts:0, delta:0, in:{turn:false,back:false} };
    if(!p.human){
      const n=2+Math.floor(Math.random()*3);
      for(let i=0;i<n;i++) p.events.push({ t:rand(1.8,g.qT-0.8), type:'look', dur:rand(0.6,1.1) });
      if(Math.random()<0.65) p.events.push({ t:g.qT-rand(1.0,2.6), type:'look', dur:rand(0.6,1.0) });
      const f=Math.floor(Math.random()*3);
      for(let i=0;i<f;i++) p.events.push({ t:rand(2,g.qT-1), type:'feint' });
      p.events.sort((a,b)=>a.t-b.t);
    }
    /* each team's cheater is the one the row chose in the lobby. If nobody was chosen (or he is away), it goes round. */
    if(g.teams) [0,1].forEach(t => {
      const m=members(g,t), here=m.filter(s=>!s.away), l=here.length?here:m;
      const chosen=l.find(s => s.pl.id===this.ch[t]);
      if(chosen) chosen.cheater=true; else if(l.length) l[g.qi % l.length].cheater=true;
    });
    g.students.forEach(s => {
      s.ans=null; s.base=0; s.near=false; s.exact=false; s.didCopy=false;
      s.caught=false; s.copiedFrom=null; s.copiedKey=null; s.peek=null; s.delta=0; s.bonus=0;
      s.mark=0; s.markRes=null; s.peeked=false; s.markDelta=0; s.seen={}; s.info=null;
      s.bet=1; s.won=false;
      if(!s.human){
        s.conf = q.t==='vote' ? Math.random()<0.5 : Math.random()<s.skill;
        s.belief = (s.conf && q.t!=='vote') ? correctAns(q) : guessAns(q);
        s.answerAt = rand(1.5,6)*k;
        s.verify = s.conf && Math.random()<0.3;
        s.nextPeekAt = s.conf ? (s.verify ? rand(3,11)*k : Infinity) : rand(1.2,8)*k;
        s.caution = rand(0.4,1.4);
        /* a computer player raises the wager when it thinks it knows */
        const r=Math.random();
        s.ownBet = (q.t==='vote' || !s.conf) ? 1 : (r<0.1 ? 3 : (r<0.5 ? 2 : 1));
        s.decoyer = !g.teams && s.conf && Math.random()<0.4; s.decoying=false; s.decoyUsed=false;
        s.releaseAt=null; s.done=false;
        s.recheck = !s.conf && Math.random()<0.5; s.rechecked=false;
        if(g.teams){ s.nextFollow=s.answerAt+rand(0.8,2); s.yieldLate=Math.random()<0.6; if(s.cheater) s.nextPeekAt=rand(1.5,7)*k; }
      }
    });
  }

  /* ---------- what players do ---------- */
  act(pid, d){
    if(!d || typeof d!=='object') return;
    const pl=this.p(pid); if(!pl) return;
    this.tick(Date.now());
    if(d.k==='role'){
      /* in the lobby anyone can take the proctor's chair if it is free, or give it back */
      if(this.ph!=='lobby') return;
      if(d.v==='pr'){ if(!this.proctor()) this.prPid=pid; }
      else if(this.prPid===pid) this.prPid=null;
      this.fixCheaters();
      return;
    }
    if(d.k==='row'){
      /* in the lobby everyone picks the row they sit in */
      if(this.ph==='lobby') this.seat(pl, d.v);
      return;
    }
    if(d.k==='cheat'){
      /* a row picks its cheater: any member can name one of the row (the owner can do it for any row). Naming him again takes it back. */
      if(this.ph!=='lobby') return;
      const t=this.p(d.id);
      if(!t || t.id===this.prPid) return;
      if(pid!==this.me && (pl.row!==t.row || pid===this.prPid)) return;
      this.ch[t.row] = this.ch[t.row]===t.id ? null : t.id;
      return;
    }
    if(d.k==='out'){
      if(this.ph==='play' && pl.out!==!!d.v){ pl.out=!!d.v; this.event(pl.out?'left':'back', pl); }
      return;
    }
    if(this.ph!=='play' || !this.g || this.g.phase!=='play') return;
    const g=this.g, pr=g.pr;
    if(pr.pl===pl){
      if(d.k==='turn') pr.in.turn=true;
      else if(d.k==='back') pr.in.back=true;
      else if(d.k==='mark'){
        const s=g.students[d.i];
        if(s && !s.caught && !s.away) s.mark = s.mark===0 ? -1 : (s.mark===-1 ? 1 : 0);
      }
      return;
    }
    const s=g.students.find(x => x.pl===pl);
    if(!s || s.away) return;
    const dead = g.teams ? g.void[s.team] : s.caught;
    if(d.k==='peek'){ s.in.peek = (d.v===1||d.v===-1) ? d.v : 0; return; }
    if(dead) return;
    if(d.k==='bet'){
      const v=d.v;
      if(v!==1 && v!==2 && v!==3) return;
      if(v===3 && (g.teams ? this.TA[s.team] : pl.triples)<=0) return;
      s.bet=v; return;
    }
    if(d.k==='ans') s.ans=cleanAns(g.q, d.v);
    else if(d.k==='adopt' && g.teams){ const ty=tally(g,s.team); if(ty.lead!==null) s.ans=clone(ty.leadAns); }
  }

  /* ---------- time ---------- */
  tick(now){
    now = now || Date.now();
    let dt = Math.min(1, Math.max(0, (now-this.last)/1000)); this.last=now;
    if(this.ph!=='play' || !this.g) return;
    while(dt>1e-6 && this.ph==='play'){
      const d=Math.min(0.05,dt); dt-=d;
      if(this.g.phase==='play') this.step(d);
      else { this.g.revealLeft-=d; if(this.g.revealLeft<=0) this.nextQuestion(); }
    }
  }
  nextQuestion(){
    const g=this.g; g.qi++;
    if(g.qi<g.qs.length) this.startQuestion();
    else this.ph='over';
  }
  step(dt){
    const g=this.g;
    g.elapsed+=dt; g.left=Math.max(0, g.qT-g.elapsed);
    g.students.forEach(s => { const a=this.isAway(s.pl); if(a && !s.away) s.peek=null; s.away=a; });
    g.pr.away = !!(g.pr.pl && this.isAway(g.pr.pl));
    this.stepProctor(dt);
    if(g.teams) this.stepTeams(dt); else this.stepSolo(dt);
    /* what the proctor hears, per side: real peeking, plus an occasional false murmur */
    const writing = g.pr.st==='writing';
    if(g.fake){ g.fake.t-=dt; if(g.fake.t<=0) g.fake=null; }
    else if(writing && Math.random()<0.07*dt) g.fake={ t:rand(0.5,0.9), right:Math.random()<0.5 };
    [true,false].forEach(right => {
      const n=this.sidePeekers(right); let lvl = n===0 ? 0 : (n===1 ? 0.5 : (n===2 ? 0.75 : 1));
      if(g.fake && writing && g.fake.right===right) lvl=Math.max(lvl,0.5);
      const key=right?'hamR':'hamL';
      g[key] += (lvl-g[key])*Math.min(1, dt*3.5);
    });
    if(g.left<=0) this.endQuestion();
  }
  sidePeekers(right){ const g=this.g; return g.students.filter(s => s.peek && !s.caught && ((s.idx<g.rc)===right)).length; }
  /** The proctor starts to turn: computer players notice and pull their heads back, some too late. */
  cue(){
    const g=this.g;
    g.students.forEach(s => { if(!s.human && s.peek && s.releaseAt==null) s.releaseAt=g.elapsed+this.cfg.turnTime*(0.35+Math.random()*0.88); });
  }
  startTurn(){ const p=this.g.pr; p.st='turning'; p.stT=0; p.lookCatches=[]; p.lookAt={}; p.wantBack=false; this.cue(); }
  startFeint(){ const p=this.g.pr; p.st='feint'; p.stT=0; this.cue(); }
  backToBoard(){ const p=this.g.pr; p.st='writing'; p.stT=0; p.sinceBack=0; }
  catchPeekers(){
    const g=this.g, p=g.pr, before=p.lookCatches.length;
    g.students.forEach(s => {
      if(!s.caught && s.peek){
        p.lookAt[s.idx]=s.peek.target; s.caught=true; s.ans=null; s.peek=null; s.releaseAt=null; s.mark=0;
        p.catches.push(s.idx); p.lookCatches.push(s.idx);
        if(g.teams) g.void[s.team]=true;
      }
    });
    if(p.lookCatches.length>before) p.fx=1.5;
  }
  /** The computer proctor writes at most one name in each column, guessing from what it "heard". */
  botMarks(){
    const live=this.g.students.filter(s => !s.caught && !s.away);
    const guilty=live.filter(s=>s.peeked), clean=live.filter(s=>!s.peeked);
    let bad=null;
    if(guilty.length && Math.random()<0.45) bad=pick(guilty);
    else if(clean.length && Math.random()<0.12) bad=pick(clean);
    if(bad) bad.mark=-1;
    const pool=clean.filter(s=>s!==bad);
    if(pool.length && Math.random()<0.35) pick(pool).mark=1;
  }
  stepProctor(dt){
    const g=this.g, p=g.pr, c=this.cfg;
    p.stT+=dt; if(p.fx>0) p.fx-=dt;
    if(!p.human && !p.marked && g.elapsed>=p.markAt){ p.marked=true; this.botMarks(); }
    if(p.st==='writing'){
      p.sinceBack+=dt;
      if(!p.away) p.writePts+=dt*c.writeRate;
      if(p.human){
        if(p.in.turn && p.budget>0.05 && !p.away) this.startTurn();
      } else if(p.events.length && g.elapsed>=p.events[0].t && p.sinceBack>0.6){
        const e=p.events.shift();
        if(e.type==='look'){ if(p.budget>0.3){ p.lookDur=e.dur; this.startTurn(); } }
        else this.startFeint();
      } else {
        const n=this.sidePeekers(true)+this.sidePeekers(false);
        if(n>0 && p.budget>0.5 && p.sinceBack>1 && Math.random()<0.18*n*dt){ p.lookDur=rand(0.6,1.0); this.startTurn(); }
      }
    } else if(p.st==='turning'){
      if(p.stT>=c.turnTime){ p.st='watching'; p.stT=0; this.catchPeekers(); }
    } else if(p.st==='feint'){
      if(p.stT>=Math.min(0.28, c.turnTime*0.55)) this.backToBoard();
    } else if(p.st==='watching'){
      p.budget=Math.max(0, p.budget-dt);
      this.catchPeekers();
      if(p.in.back || p.away) p.wantBack=true;
      const done = p.human ? (p.wantBack && p.stT>=0.25) : (p.stT>=p.lookDur);
      if(p.budget<=0 || done) this.backToBoard();
    }
    p.in.turn=false; p.in.back=false;
  }

  /** The wager a computer player puts on its own answer. */
  botBet(s){
    const left = this.g.teams ? this.TA[s.team] : s.pl.triples;
    return (s.ownBet===3 && left<=0) ? 2 : s.ownBet;
  }
  /** Individual play: everyone has a paper and can look at the neighbour on each side. */
  stepSolo(dt){
    const g=this.g, p=g.pr, c=this.cfg, N=g.students.length, q=g.q;
    g.students.forEach(s => {
      if(s.caught || s.away){ s.peek=null; return; }
      if(s.peek && s.peek.prog>=0.3*c.peekTime) s.peeked=true;
      if(s.human){
        const d=s.in.peek, t=s.idx+d;
        if(d!==0 && t>=0 && t<N && !g.students[t].away){
          /* clarity already earned on this neighbour's paper is kept: a second look carries on from it */
          if(!s.peek || s.peek.target!==t) s.peek={ target:t, prog:Math.min(c.peekTime, s.seen[t]||0) };
          s.peek.prog=Math.min(c.peekTime, s.peek.prog+dt);
          s.seen[t]=s.peek.prog;
          const seen=g.students[t], sk=seen.caught ? null : keyOf(q,seen.ans);
          /* past the halfway point the answer is readable enough to count as having seen it */
          if(s.peek.prog>=0.6*c.peekTime && sk!==null){ s.copiedFrom=t; s.copiedKey=sk; }
        } else s.peek=null;
        return;
      }
      const watched=g.students.some(o => o!==s && o.peek && o.peek.target===s.idx && o.peek.prog>0.3*c.peekTime);
      /* a decoy comes with a raised wager, to look sure of it; the real one goes back at the last second */
      if(watched && s.decoyer && !s.decoyUsed && g.left>2.5){ s.decoyUsed=true; s.decoying=true; s.ans=decoyAns(q,s.belief); s.bet=2; }
      if(s.decoying && g.left<=1.2){ s.decoying=false; s.ans=clone(s.belief); s.bet=this.botBet(s); }
      if(s.ans===null && g.elapsed>=s.answerAt){ s.ans=clone(s.belief); s.bet=this.botBet(s); }
      if(s.peek){
        if(s.releaseAt!=null && g.elapsed>=s.releaseAt){
          s.peek=null; s.releaseAt=null; s.nextPeekAt=g.elapsed+rand(0.3,1.2); s.caution=rand(0.4,1.4); return;
        }
        s.peek.prog+=dt;
        s.seen[s.peek.target]=Math.min(c.peekTime, s.peek.prog);
        if(s.peek.prog>=c.peekTime){
          const tg=g.students[s.peek.target], tk=(tg.caught||tg.away) ? null : keyOf(q,tg.ans);
          if(!s.peek.seen && tk!==null){
            /* the paper is readable: copy, then linger a moment like a person reading it */
            s.peek.seen=true; s.peek.until=s.peek.prog+rand(0.2,0.6);
            if(!s.conf || (tk!==keyOf(q,s.belief) && Math.random()<0.4)){
              s.ans=clone(tg.ans); s.copiedFrom=tg.idx; s.copiedKey=tk;
              /* copying from someone who looks sure is worth a double, sometimes */
              s.bet = (q.t!=='vote' && tg.bet>1 && Math.random()<0.45) ? 2 : 1;
            }
          }
          if(s.peek.seen){
            if(s.peek.prog>=s.peek.until){
              s.peek=null; s.releaseAt=null; s.done=true;
              if(s.recheck && !s.rechecked){ s.rechecked=true; s.done=false; s.nextPeekAt=Math.max(g.elapsed+1.5, g.qT-rand(1.8,4.5)); }
            }
          } else if(s.peek.prog>=c.peekTime+1.2){
            s.peek=null; s.releaseAt=null; s.nextPeekAt=g.elapsed+rand(1,2.5);
          }
        }
      } else if((!s.conf || s.verify) && !s.done && g.elapsed>=s.nextPeekAt && g.left>0.4){
        const safe = p.st==='writing' && (p.budget<=0.05 || p.sinceBack>=s.caution);
        if(safe){
          const nb=[s.idx-1,s.idx+1].filter(i => i>=0 && i<N && !g.students[i].caught && !g.students[i].away);
          if(nb.length){
            const pref=nb.filter(i => keyOf(q,g.students[i].ans)!==null), to=pick(pref.length?pref:nb);
            s.peek={ target:to, prog:s.seen[to]||0 }; s.releaseAt=null;
          } else s.nextPeekAt=Infinity;
        }
      }
    });
  }

  /** Team play: everyone puts an answer on the team's sheet; only the team's cheater looks at the other team's sheet. */
  stepTeams(dt){
    const g=this.g, p=g.pr, c=this.cfg, k=g.qT/15, q=g.q;
    g.students.forEach(s => {
      if(g.void[s.team] || s.away){ s.peek=null; return; }
      if(s.peek && s.peek.prog>=0.3*c.peekTime) s.peeked=true;
      const other=1-s.team;
      if(s.human){
        if(s.cheater && s.in.peek!==0){
          if(!s.peek) s.peek={ target:'T', prog:Math.min(c.peekTime, s.seen.T||0) };
          s.peek.prog=Math.min(c.peekTime, s.peek.prog+dt);
          s.seen.T=s.peek.prog;
          if(s.peek.prog>=0.6*c.peekTime && !g.void[other]){ const l=tally(g,other).lead; if(l!==null){ s.copiedKey=l; s.info=l; } }
        } else s.peek=null;
        return;
      }
      if(s.ans===null && g.elapsed>=s.answerAt) s.ans=clone(s.belief);
      /* the wager: computer players go with the people in their row; a row with no people follows its first member */
      const folk=members(g,s.team).filter(x => x.human && !x.away), first=members(g,s.team).find(x => !x.human);
      s.bet = folk.length ? Math.max.apply(null, folk.map(x => x.bet)) : (first===s ? this.botBet(s) : first.bet);
      /* every second or two, look at the team's sheet and maybe move to what the others wrote */
      if(s.ans!==null && !s.peek && s.info===null && g.elapsed>=s.nextFollow){
        s.nextFollow=g.elapsed+rand(0.8,1.8);
        const ch=cheaterOf(g,s.team), ty=tally(g,s.team); let to=null;
        if(!s.conf){
          if(ch && ch!==s && ch.info!==null && keyOf(q,ch.ans)!==null) to=ch.ans;
          else if(ty.lead!==null && (ty.max>=2 || ty.size<=2)) to=ty.leadAns;
          else if(ty.lead===null && ty.n>=2 && Math.random()<0.5){
            /* nobody agrees yet: an unsure player takes a team-mate's word for it */
            const mates=members(g,s.team).filter(x => x!==s && !x.away && keyOf(q,x.ans)!==null);
            if(mates.length) to=pick(mates).ans;
          }
        } else if(s.yieldLate && g.left<3.5 && ty.size>2 && ty.lead!==null && ty.max>=ty.size-1) to=ty.leadAns;
        if(to!==null) s.ans=clone(to);
      }
      if(!s.cheater) return;
      if(s.peek){
        if(s.releaseAt!=null && g.elapsed>=s.releaseAt){
          s.peek=null; s.releaseAt=null; s.nextPeekAt=g.elapsed+rand(0.3,1.2); s.caution=rand(0.4,1.4); return;
        }
        s.peek.prog+=dt;
        s.seen.T=Math.min(c.peekTime, s.peek.prog);
        if(s.peek.prog>=c.peekTime){
          const oty=g.void[other] ? null : tally(g,other);
          if(!s.peek.seen && oty && oty.lead!==null){
            s.peek.seen=true; s.peek.until=s.peek.prog+rand(0.2,0.6);
            if(!s.conf || (oty.lead!==keyOf(q,s.belief) && Math.random()<0.4)){ s.ans=clone(oty.leadAns); s.info=oty.lead; s.copiedKey=oty.lead; }
          }
          if(s.peek.seen){
            if(s.peek.prog>=s.peek.until){
              s.peek=null; s.releaseAt=null; s.done=true;
              if(s.recheck && !s.rechecked){ s.rechecked=true; s.done=false; s.nextPeekAt=Math.max(g.elapsed+1.5, g.qT-rand(1.8,4.5)); }
            }
          } else if(s.peek.prog>=c.peekTime+1.2){
            s.peek=null; s.releaseAt=null; s.nextPeekAt=g.elapsed+rand(1,2.5);
          }
        }
      } else if(!s.done && g.elapsed>=s.nextPeekAt && g.left>0.4){
        const wants = !s.conf || s.verify || (g.elapsed>4*k && !tally(g,s.team).all);
        const safe = p.st==='writing' && (p.budget<=0.05 || p.sinceBack>=s.caution);
        if(wants && safe){ s.peek={ target:'T', prog:s.seen.T||0 }; s.releaseAt=null; }
      }
    });
  }

  /* ---------- the end of a question ---------- */
  endQuestion(){
    const g=this.g, q=g.q, p=g.pr, M=this.cfg.markPts;
    g.students.forEach(s => { s.peek=null; s.in.peek=0; });
    /* the board: a right call pays the proctor, a wrong one costs him */
    const judge = s => {
      if(s.caught || !s.mark) return 0;
      if(s.mark===-1){ s.markRes = s.peeked ? 'bad' : 'wronged'; p.markPts += s.peeked ? M : -M; return s.peeked ? -M : 0; }
      s.markRes = s.peeked ? 'fooled' : 'good'; p.markPts += s.peeked ? -M : M; return M;
    };
    if(g.teams){
      g.tans=[0,1].map(t => g.void[t] ? null : tally(g,t).leadAns);
      const T=g.tres=[0,1].map(t => {
        const ty=tally(g,t);
        return { ans:g.tans[t], all:!g.void[t]&&ty.all, dead:g.void[t], voted:ty.n, bonus:0, mark:0, copied:false, peeked:false, delta:0, base:0, near:false, exact:false,
                 bet: (g.void[t] || g.tans[t]===null) ? 1 : teamBet(g,t), won:false };
      });
      const live=T.filter(r=>!r.dead);
      if(q.t==='num') scoreNums(q, live);
      else if(q.t==='vote') scoreVotes(q, live, g.students.filter(s=>!g.void[s.team]));
      else T.forEach(r => { r.base = r.dead ? 0 : basePts(q,r.ans); });
      [0,1].forEach(t => {
        const ch=cheaterOf(g,t), o=1-t;
        if(ch && ch.peeked) T[t].peeked=true;
        if(ch && !T[t].dead && ch.copiedKey!==null && keyOf(q,T[t].ans)===ch.copiedKey){
          T[t].copied=true;
          if(T[t].base<10 && !T[o].dead && T[o].base>=10) T[o].bonus+=5;
        }
      });
      g.students.forEach(s => { T[s.team].mark += judge(s); });
      [0,1].forEach(t => {
        const r=T[t];
        if(r.bet===3 && this.TA[t]<=0) r.bet=2;
        r.won = !r.dead && r.base>=10;
        if(!r.dead && r.bet===3) this.TA[t]--;
        r.delta = r.dead ? -5 : (stakePts(r.base,r.bet)+r.bonus+r.mark); this.T[t]+=r.delta;
      });
    } else {
      const live=g.students.filter(s=>!s.caught);
      if(q.t==='num') scoreNums(q, live);
      else if(q.t==='vote') scoreVotes(q, live, live);
      else g.students.forEach(s => { s.base = s.caught ? 0 : basePts(q,s.ans); });
      g.students.forEach(c => {
        c.didCopy = !c.caught && c.copiedFrom!=null && keyOf(q,c.ans)===c.copiedKey;
        if(c.didCopy && c.base<10){ const v=g.students[c.copiedFrom]; if(!v.caught && v.base>=10) v.bonus+=5; }
      });
      g.students.forEach(s => { s.markDelta=judge(s); });
      g.students.forEach(s => {
        if(s.caught || s.ans===null) s.bet=1;
        if(s.bet===3 && s.pl.triples<=0) s.bet=2;
        s.won = !s.caught && s.base>=10;
        if(s.bet===3) s.pl.triples--;
        s.delta = s.caught ? -5 : (stakePts(s.base,s.bet)+s.bonus+s.markDelta); s.pl.pts+=s.delta;
      });
    }
    p.delta = Math.floor(p.writePts) + this.cfg.catchPts*p.catches.length + p.markPts;
    if(p.pl) p.pl.pts+=p.delta;
    g.phase='reveal';
    g.revealLeft = REVEAL + (g.students.length>5 ? 3 : 0);
  }

  /* ---------- what one player is allowed to see ---------- */
  view(pid){
    const V = { code:this.code, ph:this.ph, owner:this.me, me:pid, set:this.set, cfg:this.cfg, pr:this.proctor() ? this.prPid : null,
      min:this.minPlayers(), max:MAXP, qn:Math.min(this.set.count, this.pool().length),
      ok:this.canStart()?1:0, rows:this.rows(), rowMin:ROW_MIN, rowMax:ROW_MAX, ch:this.ch, triples:TRIPLES[this.set.count]||3,
      P:this.P.map(p => ({ id:p.id, n:p.name, g:p.g, bot:p.bot?1:0, on:p.conn?1:0, out:p.out?1:0, pts:p.pts, team:p.team, row:p.row, triples:p.triples })),
      T:this.T, TA:this.TA, ev:this.ev };
    if(this.g && this.ph!=='lobby') V.g=this.gview(pid);
    return V;
  }
  gview(pid){
    const g=this.g, q=g.q, pr=g.pr, reveal = g.phase==='reveal' || this.ph==='over';
    const mi=g.students.findIndex(s => s.pl.id===pid), me = mi>=0 ? g.students[mi] : null;
    const isPr = !!(pr.pl && pr.pl.id===pid);
    const o = { teams:g.teams?1:0, phase:g.phase, qi:g.qi, qn:g.qs.length, qT:g.qT, left:+g.left.toFixed(2), rc:g.rc, mi,
      role: isPr ? 'proctor' : (me ? 'student' : 'wait'),
      q:{ p:q.p, t:q.t, q:q.q, o:q.o||null, u:q.u||'', y:q.y?1:0 }, disp:g.disp, void:g.void,
      /* a feint looks exactly like a real turn from the desks */
      pr:{ n:pr.name, g:pr.g, id:pr.pl?pr.pl.id:null, bot:pr.human?0:1, away:pr.away?1:0, st:pr.st==='feint'?'turning':pr.st,
           noBud:pr.budget<=0.05?1:0, catches:pr.catches, lookCatches:pr.lookCatches } };
    if(isPr || reveal){
      Object.assign(o.pr, { budget:+pr.budget.toFixed(2), writePts:Math.floor(pr.writePts), fx:pr.fx>0?1:0, lookAt:pr.lookAt });
      o.hamR=+g.hamR.toFixed(2); o.hamL=+g.hamL.toFixed(2);
    }
    if(me && !reveal){
      const oc = g.teams ? cheaterOf(g,1-me.team) : null;
      o.watched = (g.teams ? !!(oc && oc.peek) : g.students.some(x => x!==me && x.peek && x.peek.target===mi)) ? 1 : 0;
    }
    o.S = g.students.map((s,i) => {
      const x = { n:s.name, g:s.g, id:s.pl.id, team:s.team, caught:s.caught?1:0, away:s.away?1:0 };
      if(reveal){
        Object.assign(x, { ans:s.ans, bet:s.bet, won:s.won?1:0, base:s.base, near:s.near?1:0, exact:s.exact?1:0, bonus:s.bonus, delta:s.delta, didCopy:s.didCopy?1:0,
          copiedFrom:s.copiedFrom, peeked:s.peeked?1:0, mark:s.mark, markRes:s.markRes, cheater:s.cheater?1:0 });
        return x;
      }
      if(isPr){ x.mark=s.mark; return x; }
      if(!me) return x;
      const mine = i===mi, mate = !!g.teams && s.team===me.team;
      let show = mine || mate;
      if(!show && me.peek) show = g.teams ? (s.team!==me.team && !g.void[s.team]) : me.peek.target===i;
      if(show){ x.ans=s.ans; x.bet=s.bet; }
      if(mine){ x.mark=s.mark; x.peek = s.peek ? { target:s.peek.target, prog:+s.peek.prog.toFixed(2) } : null; x.seen=s.seen; }
      if(mate){ x.cheater=s.cheater?1:0; if(s.cheater){ x.peeking=s.peek?1:0; x.saw=s.info!==null?1:0; } }
      return x;
    });
    if(reveal){
      o.q.a=q.a; o.q.why=q.why||''; o.q.win=q.win||[];
      o.tres=g.tres; o.pr.delta=pr.delta;
      o.revealLeft=Math.max(0, Math.ceil(g.revealLeft||0));
      o.last = g.qi+1>=g.qs.length ? 1 : 0;
    }
    return o;
  }
}

const LagnaEngine = { Host, MAXP, COUNTS, CFG, CFG_RANGE, TEACHER, LOSE, TRIPLES, rid, isPick, keyOf, correctAns, posRight, tally, members, cheaterOf, teamBet, stakePts };
if(typeof globalThis !== 'undefined') globalThis.LagnaEngine = LagnaEngine;
if(typeof module !== 'undefined' && module.exports) module.exports = LagnaEngine;
})();
