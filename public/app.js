/* ==========================================================
   Lagna — what runs on the phone.
   The server runs the game. We send what the player does over a WebSocket
   and draw the view it sends back (only OUR private information is in it).
   With no server (opened as a file) the same engine runs here against the computer.
   ========================================================== */
(function(){
'use strict';
/* The page and this file must come from the same build. If the browser kept an old copy of one of them,
   or only some of the files were uploaded, say so instead of failing silently. */
const BUILD = '6';
(function(){
  const app=document.getElementById('app');
  if(app && app.getAttribute('data-build')===BUILD) return;
  const box=document.createElement('div');
  box.setAttribute('dir','rtl');
  box.style.cssText='position:fixed;inset:0;z-index:99;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:28px;background:#0F4636;color:#FFFDF5;font-family:Tahoma,Arial,sans-serif;font-size:17px;line-height:1.7;text-align:center';
  box.innerHTML='<b style="font-size:24px">في تحديث جديد للعبة</b><span>الصفحة اللي عندك من نسخة قديمة. حدّث الصفحة عشان تكمّل.</span><button type="button" style="min-height:52px;padding:0 28px;border:0;border-radius:999px;background:#FFC93C;color:#0B2E24;font:inherit;font-weight:700">حدّث الصفحة</button><small style="opacity:.75">لو الرسالة فضلت تطلع: ملفات index.html و app.js على السيرفر مش من نفس النسخة.</small>';
  box.querySelector('button').addEventListener('click', () => location.reload());
  document.body.appendChild(box);
  throw new Error('Lagna: index.html and app.js are from different builds');
})();
const E = globalThis.LagnaEngine, QB = globalThis.LagnaQuestions;
const PACKS = QB.PACKS, ALL_PACKS = PACKS.map(p => p.id), PACK_NAME = {};
PACKS.forEach(p => { PACK_NAME[p.id] = p.name; });

const AR = '٠١٢٣٤٥٦٧٨٩';
const LETTERS = ['أ','ب','ج','د'];
const TEAM = ['صف اليمين','صف الشمال'];
const KIND = { mc:'اختار إجابة', tf:'الجملة دي صح ولا غلط؟', ord:'دوس عليهم بالترتيب', num:'اكتب رقم، والأقرب يكسب', vote:'مفيش إجابة صح. اللي يختار مع الأغلبية يكسب' };
const KIND_PACK = { trap:'ركّز، السؤال فيه فخ', fzr:'فزورة: إيه هو؟' };
const BET = ['','عادي','دوبل','تربل'];
const ar = v => String(v).replace(/\d/g, d => AR[+d]).replace('.', '٫');
const latin = t => String(t).replace(/[٠-٩]/g, d => AR.indexOf(d));
const num = n => (n<0?'−':'') + ar(Math.abs(n));
const signed = n => (n>0?'+':n<0?'−':'') + ar(Math.abs(n));
const $ = id => document.getElementById(id);
function setText(el, v){ if(el.textContent!==v) el.textContent=v; }
function setW(el, frac){ const w=(Math.max(0,Math.min(1,frac))*100).toFixed(1)+'%'; if(el.style.width!==w) el.style.width=w; }
function setHidden(el, h){ if(el.hidden!==h) el.hidden=h; }
const clone = a => Array.isArray(a) ? a.slice() : a;
const store = { get(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }, set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} } };

/* phrases that change with who they describe: him, her, or you */
const SAY = {
  caught:{m:'اتمسك وهو بيبص',f:'اتمسكت وهي بتبص',u:'اتمسكت وإنت بتبص'},
  noans:{m:'ما جاوبش',f:'ما جاوبتش',u:'ما جاوبتش'},
  wrote:{m:'كتب ',f:'كتبت ',u:'كتبت '},
  picked:{m:'اختار ',f:'اختارت ',u:'اخترت '},
  copied:{m:'نقل من ',f:'نقلت من ',u:'نقلت من '},
  peeked:{m:'بص وما نقلش',f:'بصت وما نقلتش',u:'بصيت وما نقلتش'},
  fooled:{m:'ضحك على اللي نقل منه',f:'ضحكت على اللي نقل منها',u:'ضحكت على اللي نقل منك'},
  bad:{m:'اتكتب في المشاغبين',f:'اتكتبت في المشاغبين',u:'اتكتبت في المشاغبين'},
  wronged:{m:'اتكتب في المشاغبين ظلم',f:'اتكتبت في المشاغبين ظلم',u:'اتكتبت في المشاغبين ظلم'},
  good:{m:'اتكتب في الممتازين',f:'اتكتبت في الممتازين',u:'اتكتبت في الممتازين'},
  tagCaught:{m:'اتمسك',f:'اتمسكت',u:'اتمسكت'},
  tagBad:{m:'مشاغب',f:'مشاغبة',u:'مشاغب'},
  tagGood:{m:'ممتاز',f:'ممتازة',u:'ممتاز'},
  maybe:{m:'ممكن هو',f:'ممكن هي',u:''},
  atPaper:{m:'في ورقته',f:'في ورقتها',u:''},
  paperGone:{m:'اتمسك وورقته اتسحبت',f:'اتمسكت وورقتها اتسحبت',u:''},
  notYet:{m:'لسه ما جاوبش',f:'لسه ما جاوبتش',u:''},
  chose:{m:' مختار ',f:' مختارة ',u:''},
  looking:{m:'بيبص دلوقتي',f:'بتبص دلوقتي',u:''},
  saw:{m:'شاف ورقتهم وكتب زيهم',f:'شافت ورقتهم وكتبت زيهم',u:''},
  wasAt:{m:'كان باصص على ورقة ',f:'كانت باصة على ورقة ',u:''},
  left:{m:'خرج من اللعبة',f:'خرجت من اللعبة',u:''},
  back:{m:'رجع اللعبة',f:'رجعت اللعبة',u:''},
  out:{m:'كان برّه اللعبة',f:'كانت برّه اللعبة',u:'كنت برّه اللعبة'},
  tagOut:{m:'خرج',f:'خرجت',u:''},
  opened:{m:'فتحها ',f:'فتحتها ',u:''},
  starts:{m:' يبدأ اللعبة',f:' تبدأ اللعبة',u:''},
  prCaught:{m:'مسك ',f:'مسكت ',u:'مسكت '},
  prNone:{m:'ما مسكش حد',f:'ما مسكتش حد',u:'ما مسكتش حد'},
  prRight:{m:'شك صح في ',f:'شكّت صح في ',u:'شكيت صح في '},
  prWrong:{m:'ظلم ',f:'ظلمت ',u:'ظلمت '},
  prGood:{m:'زوّد ',f:'زوّدت ',u:'زوّدت '},
  prFooled:{m:'اتخدع في ',f:'اتخدعت في ',u:'اتخدعت في '},
  /* the same four, said to the player they are about */
  betting:{m:' ومراهن ',f:' ومراهنة ',u:''},
  betWon:{m:'راهن %s وكسب',f:'راهنت %s وكسبت',u:'راهنت %s وكسبت'},
  betLost:{m:'راهن %s وخسر',f:'راهنت %s وخسرت',u:'راهنت %s وخسرت'},
  prRightU:{m:'شك صح فيك',f:'شكّت صح فيك'}, prWrongU:{m:'ظلمك',f:'ظلمتك'}, prGoodU:{m:'زوّدك',f:'زوّدتك'}, prFooledU:{m:'اتخدع فيك',f:'اتخدعت فيك'}
};
const HOW = {
  solo:[
    'كل واحد من موبايله. قبل ما تبدأوا، اللي عايز يبقى المراقب يختار "مراقب" والباقي طلبة. لو محدش اختار، الكمبيوتر هو المراقب.',
    'الطالب يجاوب في ورقته قبل ما الوقت يخلص. كل سؤال ليه طريقة: اختيار، صح ولا غلط، ترتيب، أو رقم.',
    'واثق من إجابتك؟ راهن عليها. "دوبل": صح تاخد ٢٠، غلط تخسر ١٠. "تربل": صح تاخد ٣٠، غلط تخسر ٣٠، وليك منها عدد محدود في اللعبة.',
    'مش عارف؟ دوس على "بص" وافضل دايس. ورقة جارك بتبدأ مش واضحة وبتوضح وإنت دايس، ولو سبت ورجعت بتكمّل من مكان ما وقفت.',
    'السبورة اللي فوق خضرا يعني أمان. لو احمرّت سيب الزرار فوراً. لو المراقب لفّ وإنت دايس، سؤالك يتلغى وتنقص ٥.',
    'المراقب ضهره للجنة، وبيسمع الهمهمة جاية من يمينه ولا شماله. يدوس "لفّ" واللي بيبص ساعتها يتمسك. رصيد البص محدود.',
    'المراقب يقدر يكتب أسامي على السبورة: في المشاغبين لو شاكك، وفي الممتازين لو متأكد. حكمه صح يكسب، غلط يخسر.'
  ],
  teams:[
    'اللجنة صفّين: صف اليمين وصف الشمال. قبل ما تبدأوا كل واحد يختار صفّه، وكل صف يختار الغشاش بتاعه.',
    'المراقب واحد منكم لو اختار "مراقب"، وإلا يبقى الكمبيوتر.',
    'كل صف ليه إجابة واحدة. كل واحد يحط الإجابة اللي شاكك فيها، وبتشوفوا الصف رايح على إيه.',
    'لو الصف كله على نفس الإجابة تبقى إجابتكم. لو ما اتفقتوش، الأغلبية آخر الوقت هي اللي تتحسب.',
    'الغشاش بس هو اللي يقدر يبص: يدوس ويفضل دايس عشان يشوف الصف التاني كاتبين إيه. لو ما اخترتوش غشاش، الدور بيلفّ عليكم كل سؤال.',
    'الرهان (دوبل أو تربل) بيتحسب لو كل اللي جاوبوا في الصف رفعوه. واحد بس سابه "عادي" يبقى عادي.',
    'لو المراقب لفّ والغشاش دايس، سؤال الصف كله يتلغى وتنقصوا ٥.'
  ]
};
const ICON = {
  paper:'<svg width="42" height="42" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="5" width="26" height="34" rx="4"></rect><path d="M15 15 h14"></path><path d="M15 22 h14"></path><path d="M15 29 h8"></path></svg>',
  eyeS:'<svg width="22" height="16" viewBox="0 0 64 44" fill="none" aria-hidden="true"><path d="M3 22 Q32 -6 61 22 Q32 50 3 22 Z" fill="#FFFFFF" stroke="currentColor" stroke-width="5"></path><circle cx="32" cy="22" r="10" fill="currentColor"></circle></svg>',
  eye:'<svg width="50" height="42" viewBox="0 0 64 44" fill="none" aria-hidden="true"><path d="M3 22 Q32 -6 61 22 Q32 50 3 22 Z" fill="#FFFFFF" stroke="currentColor" stroke-width="4"></path><circle cx="22" cy="22" r="10" fill="currentColor"></circle></svg>'
};

/* ============ who I am ============ */
let pid = store.get('lagna_pid');
if(!pid || !/^[a-z0-9]{4,16}$/.test(pid)){ pid = E.rid(8); store.set('lagna_pid', pid); }
const ME = { name: store.get('lagna_name') || '', g: store.get('lagna_g')==='f' ? 'f' : 'm' };

/* ============ state ============ */
let V = null;            // the last view the server sent
let G = null;            // the current game, shaped for drawing
let LOCAL = null;        // the offline room, when there is no server
const U = { screen:'s-home', how:false, lastEv:0, paintKey:'', revealKey:'', roomKey:'', pend:null, rooms:[], roomsTimer:null, seatKey:'' };
const input = { peekDir:0 };
const holds = [];
const canNet = typeof WebSocket!=='undefined' && /^https?:$/.test(location.protocol) && (function(){ try{ return window.top===window.self; }catch(e){ return false; } })();

/* ============ screens ============ */
const SCREENS = ['s-home','s-rooms','s-create','s-room','s-how','s-student','s-proctor','s-reveal','s-end'];
function show(id){
  if(U.screen===id && !$(id).hidden) return;
  U.screen=id;
  SCREENS.forEach(s => { $(s).hidden = (s!==id); });
  holds.forEach(h => h.reset());
  if(input.peekDir!==0){ input.peekDir=0; act({k:'peek', v:0}); }
}
function syncRadios(root){ Array.prototype.forEach.call(root.querySelectorAll('input[type=radio]'), r => r.parentNode.classList.toggle('on', r.checked)); }
let toastTimer = null;
function toast(t, sticky){
  const el=$('toast'); el.textContent=t; el.hidden=false;
  clearTimeout(toastTimer);
  if(!sticky) toastTimer=setTimeout(() => { el.hidden=true; }, 2600);
}
function flash(btn, txt){
  const old=btn.getAttribute('data-l') || btn.textContent; btn.setAttribute('data-l', old); btn.textContent=txt;
  clearTimeout(btn._t); btn._t=setTimeout(() => { btn.textContent=old; }, 2200);
}
function copyText(t, done){
  function fallback(){
    try{
      const ta=document.createElement('textarea'); ta.value=t; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.opacity='0';
      document.body.appendChild(ta); ta.select(); const ok=document.execCommand('copy'); document.body.removeChild(ta); done(!!ok);
    }catch(e){ done(false); }
  }
  try{ if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(t).then(() => done(true), fallback); return; } }catch(e){}
  fallback();
}
function buzz(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }

/* ============ talking to the server ============ */
const NET = { ws:null, code:null, want:false, joined:false, retry:0, timer:null };
function wsURL(code){ return (location.protocol==='https:'?'wss://':'ws://') + location.host + '/ws?code=' + code; }
function netOpen(code, hello, onReply){
  netClose();
  NET.code=code; NET.want=true; NET.joined=false;
  let ws; try{ ws=new WebSocket(wsURL(code)); }catch(e){ NET.want=false; onReply && onReply({t:'err', e:'net'}); return; }
  NET.ws=ws;
  let replied=false;
  const reply = m => { if(!replied){ replied=true; onReply && onReply(m); } };
  ws.onopen = () => { try{ ws.send(JSON.stringify(hello)); }catch(e){} };
  ws.onmessage = ev => {
    let m; try{ m=JSON.parse(ev.data); }catch(e){ return; }
    if(m.t==='ok'){ NET.joined=true; NET.retry=0; store.set('lagna_room', code); $('toast').hidden=true; reply(m); }
    else if(m.t==='err'){ if(!NET.joined){ NET.want=false; } reply(m); }
    else if(m.t==='state'){ onState(m.V); }
    else if(m.t==='kicked'){ NET.want=false; goHome('اللجنة اتفتحت من جهاز تاني بنفس الاسم.'); }
  };
  ws.onclose = () => {
    if(NET.ws!==ws) return;
    NET.ws=null;
    if(!NET.want) return;
    if(!NET.joined){ NET.want=false; reply({t:'err', e:'net'}); return; }
    reconnect(code);
  };
  ws.onerror = () => {};
}
/** We were in a room and the line dropped: keep trying to get back in, the seat is still ours. */
function reconnect(code){
  toast('الاتصال اتقطع، بنحاول نرجّعك…', true);
  clearTimeout(NET.timer);
  const wait=Math.min(6000, 800*(++NET.retry));
  NET.want=true;
  NET.timer=setTimeout(() => {
    netOpen(code, {t:'join', pid, name:ME.name, g:ME.g}, r => {
      if(r.t!=='err') return;
      if(r.e==='net') reconnect(code); else goHome('اللجنة اتقفلت.');
    });
  }, wait);
}
function netClose(){
  NET.want=false; clearTimeout(NET.timer);
  const ws=NET.ws; NET.ws=null;
  if(ws){ try{ ws.onclose=null; ws.close(); }catch(e){} }
}
function send(msg){
  if(LOCAL){ LOCAL.handle(msg); return; }
  if(NET.ws && NET.ws.readyState===1) try{ NET.ws.send(JSON.stringify(msg)); }catch(e){}
}
const act = d => { if(V) send({t:'input', d}); };
const cmd = (c, extra) => send(Object.assign({t:'cmd', c}, extra||{}));

/** No server: the same engine runs here, and every other player is the computer. */
function localOpen(set){
  const h=new E.Host('0000', pid);
  h.set.name = set.name || ('لجنة ' + ME.name); h.set.pub=false;
  h.add(pid, ME.name, ME.g, false);
  h.cmd(pid, {c:'teams', v:!!set.teams}); h.cmd(pid, {c:'count', v:set.count}); h.cmd(pid, {c:'packs', v:set.packs});
  const push = () => onState(JSON.parse(JSON.stringify(h.view(pid))));
  LOCAL = {
    handle(m){
      if(m.t==='input') h.act(pid, m.d);
      else if(m.t==='cmd'){ h.tick(Date.now()); h.cmd(pid, m); }
      else if(m.t==='leave'){ LOCAL=null; return; }
      push();
    },
    tick(){ h.tick(Date.now()); push(); }
  };
  push();
}
function goHome(msg){
  netClose(); LOCAL=null; V=null; G=null; U.how=false; U.paintKey=''; U.revealKey=''; U.roomKey='';
  store.set('lagna_room','');
  $('toast').hidden=true;
  $('home-err').textContent = msg || '';
  show('s-home');
}
const ERR = { notfound:'مفيش لجنة بالكود ده.', full:'اللجنة كاملة.', net:'مفيش اتصال بالسيرفر.', busy:'السيرفر زحمة، جرّب كمان شوية.', bad:'حصلت مشكلة، جرّب تاني.', exists:'الكود ده مستخدم.' };

/* ============ home ============ */
const nameIn=$('in-name'), codeIns=Array.prototype.slice.call($('codes').querySelectorAll('input'));
nameIn.value=ME.name;
$(ME.g==='f'?'g-f':'g-m').checked=true; syncRadios($('g-row'));
$('g-row').addEventListener('change', () => { ME.g=$('g-f').checked?'f':'m'; store.set('lagna_g', ME.g); syncRadios($('g-row')); });
nameIn.addEventListener('input', () => { ME.name=nameIn.value.trim(); $('name-err').textContent=''; store.set('lagna_name', ME.name); });
function needName(){
  ME.name=nameIn.value.trim();
  if(ME.name) return true;
  $('name-err').textContent='اكتب اسمك الأول'; nameIn.focus(); return false;
}
const codeValue = () => codeIns.map(i => i.value).join('');
function syncCode(){ $('code-go').disabled = codeValue().length!==4; }
codeIns.forEach((inp,i) => {
  inp.addEventListener('input', () => {
    const d=inp.value.replace(/[^0-9٠-٩]/g,'');
    inp.value = d ? ar(latin(d.charAt(d.length-1))) : '';
    if(inp.value && codeIns[i+1]) codeIns[i+1].focus();
    $('home-err').textContent=''; syncCode();
  });
  inp.addEventListener('keydown', e => {
    if(e.key==='Backspace' && !inp.value && codeIns[i-1]){ codeIns[i-1].value=''; codeIns[i-1].focus(); syncCode(); }
    if(e.key==='Enter' && !$('code-go').disabled) $('code-go').click();
  });
});
$('codes').addEventListener('paste', e => {
  const cd=e.clipboardData || window.clipboardData; if(!cd) return;
  const d=latin(cd.getData('text')).replace(/\D/g,'').slice(0,4); if(!d) return;
  e.preventDefault(); codeIns.forEach((inp,i) => { inp.value = d.charAt(i) ? ar(d.charAt(i)) : ''; }); syncCode();
});
function join(code){
  if(!needName()) return;
  if(!canNet){ $('home-err').textContent='الدخول بالكود محتاج النسخة اللي على النت.'; show('s-home'); return; }
  $('home-err').textContent='';
  netOpen(code, {t:'join', pid, name:ME.name, g:ME.g}, r => { if(r.t==='err') goHome(ERR[r.e] || ERR.bad); });
}
$('code-go').addEventListener('click', () => { if(codeValue().length===4) join(latin(codeValue())); });
$('go-create').addEventListener('click', () => { if(needName()) openCreate(); });
$('go-rooms').addEventListener('click', () => { if(needName()) openRooms(); });
Array.prototype.forEach.call(document.querySelectorAll('[data-go]'), b => {
  b.addEventListener('click', () => { clearInterval(U.roomsTimer); show(b.getAttribute('data-go')); });
});
$('home-note').textContent = canNet ? 'كل واحد يدخل من موبايله بنفس الكود.' : 'من غير سيرفر: هنا بتلعب ضد الكمبيوتر بس.';

/* ============ open rooms ============ */
function openRooms(){
  $('rooms-me').textContent='داخل باسم '+ME.name;
  $('room-search').value=''; U.rooms=[]; renderRooms(); show('s-rooms');
  loadRooms(); clearInterval(U.roomsTimer); U.roomsTimer=setInterval(() => { if(U.screen==='s-rooms') loadRooms(); else clearInterval(U.roomsTimer); }, 4000);
}
function loadRooms(){
  if(!canNet){ U.roomsErr='اللجان المفتوحة بتظهر في النسخة اللي على النت.'; renderRooms(); return; }
  fetch('/api/rooms', {cache:'no-store'}).then(r => r.json()).then(l => { U.rooms=Array.isArray(l)?l:[]; U.roomsErr=''; renderRooms(); })
    .catch(() => { U.roomsErr='مش عارفين نجيب اللجان دلوقتي.'; renderRooms(); });
}
function renderRooms(){
  const term=$('room-search').value.trim(), list=$('room-list'); list.textContent='';
  let shown=0;
  U.rooms.forEach(r => {
    if(term && String(r.name).indexOf(term)<0 && String(r.h).indexOf(term)<0) return;
    shown++;
    const full=r.n>=r.m, row=document.createElement('div'); row.className='rrow';
    row.innerHTML='<div class="who"><b></b><span></span></div><div class="cnt"></div><button type="button" class="join"></button>';
    row.querySelector('b').textContent=r.name || ('لجنة '+r.h);
    row.querySelector('.who span').textContent=SAY.opened[r.hg==='f'?'f':'m']+r.h+'، '+(r.teams?'فرق':'فردي');
    row.querySelector('.cnt').textContent=ar(r.n)+' من '+ar(r.m);
    const jb=row.querySelector('.join'); jb.textContent=full?'كاملة':'ادخل'; jb.disabled=full; jb.setAttribute('data-c', r.c);
    list.appendChild(row);
  });
  if(!shown){
    const e=document.createElement('div'); e.className='empty';
    e.textContent = U.roomsErr || (U.rooms.length ? 'مفيش لجنة بالاسم ده.' : 'مفيش لجان مفتوحة دلوقتي. افتح إنت لجنة.');
    list.appendChild(e);
  }
}
$('room-search').addEventListener('input', renderRooms);
$('room-list').addEventListener('click', e => {
  const b=e.target.closest ? e.target.closest('.join') : null;
  if(b && !b.disabled) join(b.getAttribute('data-c'));
});
$('rooms-create').addEventListener('click', openCreate);

/* ============ open a room ============ */
const packSel={};
$('pack-grid').innerHTML='<label class="tick dash" for="pk-all"><input id="pk-all" type="checkbox"><span>كل المواد</span></label>'+PACKS.map(p =>
  '<label class="tick" for="pk-'+p.id+'"><input id="pk-'+p.id+'" type="checkbox"><span>'+p.name+'</span></label>').join('');
function syncCreate(){
  const all=$('pk-all').checked; let n=0;
  $('pk-all').parentNode.classList.toggle('on', all);
  PACKS.forEach(p => {
    const inp=$('pk-'+p.id); inp.disabled=all;
    const on=!all && inp.checked; packSel[p.id]=on; if(on) n++;
    inp.parentNode.classList.toggle('on', on); inp.parentNode.classList.toggle('faded', all);
  });
  const ok=all || n>0;
  $('create-go').disabled=!ok;
  $('create-sub').textContent = !ok ? 'اختار مادة واحدة على الأقل' : (all?'كل المواد':(n===1?'مادة واحدة':n===2?'مادتين':ar(n)+' مواد'))+(canNet?'، وهتاخد كود تبعته لصحابك':'، ضد الكمبيوتر');
  syncRadios($('s-create'));
}
function openCreate(){
  $('create-me').textContent='داخل باسم '+ME.name;
  $('cr-name').value='لجنة '+ME.name;
  $('pk-all').checked=true; PACKS.forEach(p => { $('pk-'+p.id).checked=false; });
  $('cr-open').checked=true; $('cr-solo').checked=true; $('cr-20').checked=true;
  syncCreate(); show('s-create');
}
$('s-create').addEventListener('change', syncCreate);
$('create-go').addEventListener('click', () => {
  const all=$('pk-all').checked, packs = all ? ALL_PACKS.slice() : ALL_PACKS.filter(id => packSel[id]);
  if(!packs.length) return;
  const set = { name:$('cr-name').value.trim() || ('لجنة '+ME.name), pub:$('cr-open').checked, teams:$('cr-teams').checked,
                count:$('cr-30').checked?30:$('cr-20').checked?20:10, packs };
  if(!canNet){ localOpen(set); return; }
  let tries=0;
  (function attempt(){
    let code=''; for(let i=0;i<4;i++) code+=Math.floor(Math.random()*10);
    netOpen(code, {t:'create', pid, name:ME.name, g:ME.g, set}, r => {
      if(r.t!=='err') return;
      if(r.e==='exists' && ++tries<6) return attempt();
      if(r.e==='net'){ localOpen(set); toast('مفيش اتصال بالسيرفر، بتلعب ضد الكمبيوتر.'); return; }
      goHome(ERR[r.e] || ERR.bad);
    });
  })();
});

/* ============ a view arrives ============ */
function onState(v){
  V=v;
  (v.ev||[]).forEach(e => {
    if(e.i<=U.lastEv) return;
    U.lastEv=e.i;
    if(e.id!==pid && v.ph==='play') toast(e.n+' '+SAY[e.k==='back'?'back':'left'][e.g==='f'?'f':'m']);
  });
  if(v.ph==='lobby'){ if(U.lastPh && U.lastPh!=='lobby') U.lastEv=Math.max(U.lastEv, 0); }
  U.lastPh=v.ph;
  route();
}
const meP = () => V.P.find(p => p.id===pid) || null;
const isOwner = () => V.owner===pid;
const myTeam = () => { const p=meP(); return (V.g && V.g.teams && p && p.team>=0) ? p.team : -1; };
function buildG(){
  const v=V.g, mi=v.mi, isPr=v.role==='proctor';
  const S=v.S.map((s,i) => {
    const mine=i===mi;
    return { idx:i, name:mine?'إنت':s.n, real:s.n, g:mine?'u':(s.g==='f'?'f':'m'), user:mine, id:s.id, team:s.team, caught:!!s.caught, away:!!s.away,
      ans: s.ans===undefined ? null : s.ans, bet:s.bet||1, won:!!s.won, mark:s.mark||0, peek:s.peek||null, seen:s.seen||{}, cheater:!!s.cheater, peeking:!!s.peeking, saw:!!s.saw,
      base:s.base||0, near:!!s.near, exact:!!s.exact, bonus:s.bonus||0, delta:s.delta||0, didCopy:!!s.didCopy, copiedFrom:s.copiedFrom, peeked:!!s.peeked, markRes:s.markRes||null };
  });
  G = { mode:v.role, teams:!!v.teams, phase:v.phase, qi:v.qi, qs:{length:v.qn}, qT:v.qT, left:v.left, rc:v.rc, me:mi, q:v.q, disp:v.disp, void:v.void,
    watched:!!v.watched, students:S, hamR:v.hamR||0, hamL:v.hamL||0, tres:v.tres||null, revealLeft:v.revealLeft||0, last:!!v.last,
    pr:{ name:isPr?'إنت':v.pr.n, real:v.pr.n, g:isPr?'u':(v.pr.g==='f'?'f':'m'), id:v.pr.id, isUser:isPr, bot:!!v.pr.bot, away:!!v.pr.away, st:v.pr.st,
         budget: v.pr.budget!==undefined ? v.pr.budget : (v.pr.noBud?0:1), writePts:v.pr.writePts||0, fx:!!v.pr.fx, lookAt:v.pr.lookAt||{},
         catches:v.pr.catches||[], lookCatches:v.pr.lookCatches||[], delta:v.pr.delta||0 } };
  /* what I just tapped shows at once, without waiting for the server to say it back */
  const p=U.pend;
  if(p && mi>=0 && p.qi===v.qi && Date.now()-p.at<600) S[mi].ans=p.ans; else U.pend=null;
  const pb=U.pendB;
  if(pb && mi>=0 && pb.qi===v.qi && Date.now()-pb.at<600) S[mi].bet=pb.bet; else U.pendB=null;
}
function route(){
  if(!V) return;
  const me=meP();
  if(V.ph==='lobby'){ G=null; U.paintKey=''; U.revealKey=''; if(U.how){ show('s-how'); return; } renderRoom(); show('s-room'); return; }
  buildG();
  if(V.ph==='over'){ U.how=false; if(U.revealKey!=='end'){ U.revealKey='end'; renderEnd(); } syncEnd(); show('s-end'); return; }
  if(!me || me.out || G.mode==='wait'){ if(U.how){ show('s-how'); return; } renderRoom(); show('s-room'); return; }
  U.how=false;
  if(G.phase==='reveal'){
    if(U.revealKey!=='q'+G.qi){ U.revealKey='q'+G.qi; U.paintKey=''; renderReveal(); }
    syncReveal(); show('s-reveal'); return;
  }
  const key=G.qi+':'+G.mode+':'+G.me;
  if(U.paintKey!==key){ U.paintKey=key; paintQuestion(); }
  if(G.mode==='student'){ renderStudent(); show('s-student'); }
  else { renderProctor(); show('s-proctor'); }
}

/* small wrappers so the drawing code reads like the rules */
const keyOf = a => E.keyOf(G.q, a);
const tally = t => E.tally(G, t);
const teamBet = t => E.teamBet(G, t);
function betWord(e, g){ return e.bet>1 ? SAY[e.won?'betWon':'betLost'][g].replace('%s', BET[e.bet]) : ''; }
const isPick = q => E.isPick(q);
function ansText(a){
  const q=G.q;
  if(a===null || a===undefined) return '';
  if(q.t==='ord') return a.map(i => q.o[i]).join('، ');
  if(q.t==='num') return ar(a)+(q.u && !q.y ? ' '+q.u : '');
  return q.o[a];
}
function resultWord(e, g){
  const q=G.q;
  if(keyOf(e.ans)===null && !(q.t==='ord' && e.ans && e.ans.length)) return SAY.noans[g];
  if(q.t==='ord'){ const k=E.posRight(e.ans); return e.ans.length===4 && k===4 ? 'الترتيب كله صح' : ar(k)+' في مكانهم'; }
  if(q.t==='num') return SAY.wrote[g]+ar(e.ans)+(e.exact?'، بالظبط':e.near?'، الأقرب':'');
  if(q.t==='vote') return SAY.picked[g]+q.o[e.ans]+(e.base>=10?'، مع الأغلبية':'');
  return e.base>=10 ? 'صح' : 'غلط';
}

/* ============ the room ============ */
function renderRoom(){
  const me=meP(), owner=isOwner(), s=V.set, n=V.P.length, lobby=V.ph==='lobby';
  $('room-name').textContent=s.name;
  $('room-code').textContent = LOCAL ? 'من غير نت' : 'كود '+ar(V.code);
  $('room-count').textContent='الحاضرين '+ar(n)+' من '+ar(V.max);
  const key=JSON.stringify([V.P.map(p => [p.id,p.n,p.on,p.bot,p.out]), V.owner, V.pr]);
  if(U.roomKey!==key){
    U.roomKey=key;
    const ros=$('room-roster'); ros.textContent='';
    V.P.forEach(p => {
      const el=document.createElement('span');
      el.textContent=p.n+(p.id===pid?' (إنت)':'')+(p.id===V.pr?'، المراقب':'');
      el.className=(p.id===pid?'me ':'')+(p.bot?'bot ':'')+(p.id===V.owner?'host ':'')+((!p.on||p.out)?'off':'');
      ros.appendChild(el);
    });
  }
  /* in a team game the lobby shows the two rows instead of one list: pick your row, and each row picks its cheater */
  const rowsOn = lobby && s.teams;
  setHidden($('room-roster'), rowsOn); setHidden($('room-rows'), !rowsOn); setHidden($('rows-hint'), !rowsOn);
  if(rowsOn) renderRows(me, owner);
  setHidden($('room-stepper'), !owner || !lobby);
  $('room-less').disabled=!V.P.some(p => p.bot);
  $('room-more').disabled=n>=V.max;
  setHidden($('room-empty'), n>1 || !lobby);
  $('room-empty').textContent = LOCAL ? 'ضيف لعيبة كمبيوتر تلعب معاهم.' : 'لسه محدش دخل. ابعت دعوة لصحابك، أو ضيف لعيبة كمبيوتر.';
  setHidden($('room-inv'), !!LOCAL);
  $('room-solo').classList.toggle('on', !s.teams); $('room-solo').setAttribute('aria-pressed', s.teams?'false':'true');
  $('room-teams').classList.toggle('on', s.teams); $('room-teams').setAttribute('aria-pressed', s.teams?'true':'false');
  $('room-solo').disabled=$('room-teams').disabled=!owner || !lobby;
  $('room-modehint').textContent = s.teams ? 'صفّين ضد بعض: كل صف ليه إجابة واحدة وغشاش واحد.' : 'كل واحد بيجاوب لنفسه ويبص على اللي جنبه.';
  /* my role: a student, or the proctor if the chair is free */
  const prP=V.P.find(p => p.id===V.pr) || null, iAmPr=V.pr===pid;
  $('role-st').classList.toggle('on', !iAmPr); $('role-st').setAttribute('aria-pressed', iAmPr?'false':'true');
  $('role-pr').classList.toggle('on', iAmPr); $('role-pr').setAttribute('aria-pressed', iAmPr?'true':'false');
  $('role-st').disabled=!lobby; $('role-pr').disabled=!lobby || !!(prP && !iAmPr);
  $('room-prhint').textContent = iAmPr ? 'إنت المراقب طول اللعبة، والباقي طلبة.' : prP ? 'المراقب: '+prP.n+'. إنت طالب.' : 'المراقب دلوقتي الكمبيوتر. عايز تراقب إنت؟ اختار "مراقب".';
  $('room-packs').textContent=(s.packs.length===ALL_PACKS.length?'كل المواد':s.packs.map(id => PACK_NAME[id]).join('، '))+'، '+ar(V.qn)+(V.qn<=10?' أسئلة':' سؤال');

  const live=!lobby;
  setHidden($('room-live'), !live); setHidden($('room-start'), live); setHidden($('room-tune'), !owner || live);
  if(live){
    const wait = !!(V.g && V.g.role==='wait' && me && !me.out);
    setText($('live-t'), wait ? 'اللعبة شغالة' : 'اللعبة شغالة وإنت برّه');
    setText($('live-q'), 'سؤال '+ar(V.g.qi+1)+' من '+ar(V.g.qn));
    setText($('live-rule'), wait ? 'هتقعد مكانك أول ما السؤال الجاي يبدأ.' : (V.g.role==='proctor' ? 'اللجنة من غير مراقب لحد ما ترجع، وهم بيغشوا براحتهم.' : 'اللعبة ماشية من غيرك، والسؤال اللي يفوتك بيتحسب صفر. ارجع في أي وقت.'));
    setHidden($('live-back'), wait); setHidden($('live-end'), !owner);
    $('room-hint').textContent='';
    return;
  }
  const need=V.min-n, ready=!!V.ok, ow=V.P.find(p => p.id===V.owner);
  setHidden($('btn-start'), !owner);
  $('btn-start').disabled=!ready;
  $('btn-start-s').textContent = ready ? ar(n)+' لعيبة، '+ar(V.qn)+(V.qn<=10?' أسئلة':' سؤال') : need>0 ? 'لسه العدد ناقص' : 'الصفوف مش مظبوطة';
  $('room-hint').textContent = need>0 ? 'محتاجين '+(need===1?'لاعب واحد':need===2?'لاعبين':ar(need)+' لعيبة')+' كمان عشان تبدأوا. أقل عدد '+(s.teams?'في الفرق ':'')+ar(V.min)+'.'
    : !ready ? 'كل صف لازم يبقى فيه '+(V.rowMin===2?'اتنين':ar(V.rowMin))+' على الأقل. انقلوا حد للصف الناقص.'
    : owner ? 'كله جاهز. لما الكل يدخل، ابدأ.' : 'مستنيين '+(ow?ow.n:'صاحب اللجنة')+SAY.starts[ow && ow.g==='f'?'f':'m']+'.';
  /* the owner's numbers */
  if(owner) TUNE.forEach(t => { const el=$(t[0]); if(document.activeElement!==el){ el.value=V.cfg[t[1]]; $(t[0]+'-out').textContent=ar(el.value); } });
}
function renderRows(me, owner){
  const iAmPr=V.pr===pid, myRow = (me && !iAmPr) ? me.row : -1;
  const key=JSON.stringify([V.P.map(p => [p.id,p.n,p.on,p.bot,p.out,p.row]), V.owner, V.pr, V.ch, pid]);
  if(U.rowsKey!==key){
    U.rowsKey=key;
    [0,1].forEach(r => {
      const list=$('row-l'+r); list.textContent='';
      const mem=V.P.filter(p => p.row===r && p.id!==V.pr);
      mem.forEach(p => {
        const d=document.createElement('div'), can = owner || (myRow===r);
        d.className='mem'+(p.id===pid?' me':'')+(p.bot?' bot':'')+((!p.on||p.out)?' off':'')+(V.ch[r]===p.id?' ch':'');
        d.innerHTML='<button type="button" class="memb" data-id=""><span></span><i>'+ICON.eyeS+'</i></button>'+(owner?'<button type="button" class="mv" data-id="">انقل</button>':'');
        const b=d.querySelector('.memb'); b.setAttribute('data-id', p.id); b.disabled=!can;
        b.setAttribute('aria-pressed', V.ch[r]===p.id?'true':'false');
        b.querySelector('span').textContent = p.id===pid ? 'إنت' : p.n;
        const mv=d.querySelector('.mv'); if(mv){ mv.setAttribute('data-id', p.id); mv.setAttribute('aria-label', 'انقل '+p.n+' للصف التاني'); mv.disabled=V.rows[1-r]>=V.rowMax; }
        list.appendChild(d);
      });
      if(!mem.length){ const e=document.createElement('div'); e.className='rowempty'; e.textContent='لسه فاضي'; list.appendChild(e); }
      const chP=V.P.find(p => p.id===V.ch[r]);
      $('row-c'+r).textContent = chP ? 'الغشاش: '+chP.n : 'الغشاش: بالدور كل سؤال';
      $('row-n'+r).textContent = ar(mem.length);
      $('row-b'+r).classList.toggle('myrow', myRow===r);
      const sit=$('row-sit'+r);
      setHidden(sit, iAmPr || myRow===r);
      sit.disabled = V.rows[r]>=V.rowMax;
    });
  }
  $('rows-hint').textContent = owner ? 'دوس على اسم عشان يبقى غشاش صفّه، و"انقل" بتودّيه الصف التاني.'
    : iAmPr ? 'إنت المراقب، مش في صف.' : 'دوس على اسم من صفّك عشان يبقى الغشاش بتاعكم.';
}
$('room-rows').addEventListener('click', e => {
  if(!V || V.ph!=='lobby' || !e.target.closest) return;
  const mv=e.target.closest('.mv'), mb=e.target.closest('.memb'), sit=e.target.closest('.sit');
  if(mv && !mv.disabled) cmd('move', {id:mv.getAttribute('data-id')});
  else if(mb && !mb.disabled) act({k:'cheat', id:mb.getAttribute('data-id')});
  else if(sit && !sit.disabled) act({k:'row', v:+sit.getAttribute('data-r')});
});
$('room-less').addEventListener('click', () => cmd('rmbot'));
$('room-more').addEventListener('click', () => cmd('addbot'));
$('room-solo').addEventListener('click', () => cmd('teams', {v:false}));
$('room-teams').addEventListener('click', () => cmd('teams', {v:true}));
$('btn-start').addEventListener('click', () => cmd('start'));
$('role-st').addEventListener('click', () => act({k:'role', v:'st'}));
$('role-pr').addEventListener('click', () => act({k:'role', v:'pr'}));
$('room-leave').addEventListener('click', () => { send({t:'leave'}); goHome(''); });
$('live-back').addEventListener('click', () => act({k:'out', v:false}));
$('live-end').addEventListener('click', () => cmd('end'));
$('room-how').addEventListener('click', () => {
  const teams=V && V.set.teams;
  $('how-title').textContent = teams ? 'إزاي نلعب فرق' : 'إزاي نلعب';
  $('how-steps').innerHTML=HOW[teams?'teams':'solo'].map(t => '<li>'+t+'</li>').join('');
  U.how=true; show('s-how');
});
$('how-go').addEventListener('click', () => { U.how=false; route(); });
function inviteLink(){ return (canNet && V) ? location.origin+location.pathname+'?code='+V.code : ''; }
$('room-copy').addEventListener('click', () => {
  const b=$('room-copy');
  copyText(ar(V.code), ok => flash(b, ok ? 'الكود اتنسخ' : 'انسخه بإيدك: '+ar(V.code)));
});
$('room-invite').addEventListener('click', () => {
  const b=$('room-invite'), msg='تعالى العب معايا "لجنة"! ادخل من هنا: '+inviteLink()+' (كود اللجنة '+ar(V.code)+')';
  const viaCopy = () => copyText(msg, ok => flash(b, ok ? 'الدعوة اتنسخت، ابعتها' : 'ما اتنسختش'));
  try{ if(navigator.share){ navigator.share({text:msg}).then(() => {}, viaCopy); return; } }catch(e){}
  viaCopy();
});
const TUNE=[['cfg-q','qTime'],['cfg-peek','peekTime'],['cfg-turn','turnTime'],['cfg-budget','budget'],['cfg-write','writeRate'],['cfg-catch','catchPts'],['cfg-mark','markPts']];
TUNE.forEach(t => {
  const el=$(t[0]), out=$(t[0]+'-out');
  el.addEventListener('input', () => { out.textContent=ar(el.value); });
  el.addEventListener('change', () => cmd('cfg', {k:t[1], v:parseFloat(el.value)}));
  out.textContent=ar(el.value);
});

/* ============ a question starts: set up the page for my role ============ */
function sideCols(n){ return n<=2 ? Math.max(1,n) : (n<=4 ? 2 : 3); }
function paintQuestion(){
  const q=G.q, count='سؤال '+ar(G.qi+1)+' من '+ar(G.qs.length), N=G.students.length;
  if(G.mode==='student'){
    const u=G.students[G.me], T=G.teams, choice=q.t!=='num';
    $('st-qcount').textContent=count;
    $('st-pack').textContent=PACK_NAME[q.p];
    $('st-kind').textContent = q.t==='mc' ? (KIND_PACK[q.p] || KIND.mc) : KIND[q.t];
    [$('st-q'),$('st-peek-q')].forEach(el => { el.textContent=q.q; el.classList.toggle('small', q.q.length>34); });
    const btns=$('st-opts').children, cells=$('st-peek-opts').children;
    const maxLen = choice ? Math.max.apply(null, q.o.map(t => t.length)) : 0;
    const isLong=maxLen>9, isMid=!isLong && maxLen>4;
    [$('st-opts'),$('st-peek-opts')].forEach(el => {
      el.classList.toggle('long', isLong); el.classList.toggle('mid', isMid); el.classList.toggle('two', q.t==='tf');
      setHidden(el, !choice);
    });
    for(let j=0;j<4;j++){
      const has=choice && j<q.o.length, txt=has?q.o[G.disp[j]]:'', bub=(q.t==='mc'||q.t==='vote')?LETTERS[j]:q.t==='tf'?(j===0?'✓':'✗'):'';
      setHidden(btns[j], !has); setHidden(cells[j], !has);
      btns[j].classList.remove('sel'); cells[j].classList.remove('mark','ranked');
      btns[j].querySelector('.lbl').textContent=txt; cells[j].querySelector('.lbl').textContent=txt;
      btns[j].querySelector('.bub').textContent=bub; cells[j].querySelector('.bub').textContent=bub;
      btns[j].querySelector('.vt').textContent=''; cells[j].querySelector('.vt').textContent='';
    }
    setHidden($('st-num'), q.t!=='num');
    setHidden($('st-peek-big'), choice);
    $('st-num-unit').textContent = q.y ? '' : (q.u||'');
    /* what sits at the bottom of the desk depends on the mode and on who the cheater is */
    const nbR = T ? null : G.students[u.idx-1], nbL = T ? null : G.students[u.idx+1];
    setHidden($('st-teamline'), !T);
    setHidden($('st-peek-l'), T || !nbL);
    setHidden($('st-peek-r'), T ? !u.cheater : !nbR);
    setHidden($('st-teaminfo'), !(T && !u.cheater));
    $('st-notes').classList.toggle('one', T || !nbL || !nbR);
    $('st-peek-r-who').textContent = T ? 'بص على '+TEAM[1-u.team] : (nbR ? 'بص على '+nbR.name : '');
    $('st-peek-l-who').textContent = nbL ? 'بص على '+nbL.name : '';
    $('st-mine-lbl').textContent = T ? 'إجابتك في ورقة صفّكم' : 'إجابتك في ورقتك';
    $('st-alert').textContent = T ? 'الصف التاني بيبص على ورقتكم' : 'في حد بيبص على ورقتك';
  } else {
    $('pr-qcount').textContent=count; $('pr-caught').textContent='';
    const seatKey=G.students.map(s => s.id).join(',')+'|'+G.rc+'|'+(G.teams?1:0);
    if(U.seatKey!==seatKey){
      U.seatKey=seatKey;
      [['pr-side-r',G.students.slice(0,G.rc)],['pr-side-l',G.students.slice(G.rc)]].forEach(side => {
        const el=$(side[0]), c=sideCols(side[1].length);
        el.style.setProperty('--c', c); el.classList.toggle('c3', c===3);
        el.textContent='';
        side[1].forEach(s => { const b=document.createElement('button'); b.type='button'; b.className='seat'; b.setAttribute('data-i', s.idx); b.innerHTML='<b></b><small></small>'; b.querySelector('b').textContent=s.name; el.appendChild(b); });
      });
      $('pr-seats').classList.toggle('dense', N>4);
      $('pr-cap-r').textContent = G.teams ? TEAM[0] : ''; $('pr-cap-l').textContent = G.teams ? TEAM[1] : '';
      const cards=$('pr-cards'); cards.textContent='';
      G.students.forEach(s => { const b=document.createElement('button'); b.type='button'; b.className='card'; b.setAttribute('data-i', s.idx); b.setAttribute('data-ico',''); b.innerHTML='<span class="ico"></span><b></b><small></small>'; b.querySelector('b').textContent=s.name; cards.appendChild(b); });
      cards.classList.toggle('dense', N>4);
      U.seatEls=G.students.map(s => $('pr-seats').querySelector('[data-i="'+s.idx+'"]'));
      U.cardEls=Array.prototype.slice.call(cards.children);
    }
  }
}

/* the four option boxes show an answer of any choice kind: a pick, or the rank given to each item */
function paintBoxes(els, a, pickCls, rankCls){
  const q=G.q;
  for(let j=0;j<4;j++){
    if(q.t==='ord'){
      const rank = a ? a.indexOf(G.disp[j]) : -1;
      setText(els[j].querySelector('.bub'), rank>=0 ? ar(rank+1) : '');
      els[j].classList.toggle(rankCls, rank>=0);
    } else els[j].classList.toggle(pickCls, a===j);
  }
}

function renderStudent(){
  const p=G.pr, u=G.students[G.me], q=G.q, T=G.teams, other=1-u.team, choice=q.t!=='num', peekTime=V.cfg.peekTime;
  const dead = T ? G.void[u.team] : u.caught;
  setText($('st-time'), ar(Math.ceil(G.left)));
  setW($('st-timebar'), G.left/G.qT);
  const danger = p.st!=='writing';
  $('st-strip').classList.toggle('danger', danger);
  $('s-student').classList.toggle('danger', danger);
  const nowGot=p.lookCatches.filter(i => i!==u.idx).map(i => G.students[i].name);
  const allGot=p.catches.filter(i => i!==u.idx).map(i => G.students[i].name);
  const onBoard = u.mark===-1 ? 'اسمك اتكتب في المشاغبين' : u.mark===1 ? 'اسمك اتكتب في الممتازين' : '';
  let t1, t2;
  if(p.st==='watching'){ t1='المراقب باصص!'; t2 = u.caught ? 'لفّ وإنت دايس على الزرار' : nowGot.length ? 'مسك '+nowGot.join(' و')+'!' : (onBoard || 'ما تبصش دلوقتي'); }
  else if(danger){ t1='بيلفّ! سيب إيدك'; t2=''; }
  else if(p.away){ t1='مفيش مراقب'; t2='خرج برّه اللجنة'; }
  else if(p.budget<=0.05){ t1='مش هيلفّ تاني'; t2 = onBoard || 'رصيد المراقب خلص'; }
  else{ t1='المراقب مش شايفك'; t2 = onBoard || (allGot.length ? 'ضهره للجنة. اتمسك: '+allGot.join(' و') : 'المراقب: '+p.real); }
  setText($('st-title'), t1); setText($('st-sub'), t2);
  $('st-alert').classList.toggle('off', !G.watched || dead);

  const pk = dead ? null : u.peek, myKey=keyOf(u.ans);
  setHidden($('st-minewrap'), !!pk); setHidden($('st-peekwrap'), !pk);
  let hint='';
  if(pk){
    const frac=pk.prog/peekTime, clear=frac>=1;
    let mineTxt = myKey===null ? 'لسه ما جاوبتش' : (q.t==='ord' ? 'رتّبتهم' : ansText(u.ans));
    if(isPick(q) && myKey!==null && mineTxt.length>18) mineTxt='الاختيار '+LETTERS[u.ans];
    setText($('st-mypick'), mineTxt);
    setText($('st-clar-lbl'), clear ? 'الوضوح: كامل' : 'الوضوح '+ar(Math.round(frac*100))+'٪، افضل دايس');
    setW($('st-peek-bar'), frac);
    const box=$('st-blur'), blur='blur('+((1-Math.min(1,frac))*13).toFixed(1)+'px)';
    if(box.style.filter!==blur) box.style.filter=blur;
    const cells=$('st-peek-opts').children; let shown, has, gone;
    if(T){
      const oty=tally(other); gone=G.void[other];
      shown = gone ? null : oty.leadAns; has=oty.n>0;
      setText($('st-peek-name'), 'ورقة '+TEAM[other]);
      setText($('st-peek-status'), gone ? 'غشاشهم اتمسك وورقتهم اتسحبت' : !clear ? 'لسه مش واضحة' : !has ? 'لسه ما كتبوش' : 'وضحت خالص');
      if(isPick(q)) for(let j=0;j<4;j++) setText(cells[j].querySelector('.vt'), (!gone && oty.c[j]) ? ar(oty.c[j]) : '');
      if(gone) hint='ورقتهم اتسحبت، مفيش حاجة تتنقل.';
      else if(clear && shown!==null){ const ob=teamBet(other); hint=(oty.all?'كلهم على ':'أغلبهم على ')+(q.t==='ord' || ansText(shown).length>18 ? 'الإجابة دي' : ansText(shown))+(ob>1?' ومراهنين '+BET[ob]:'')+'. صح، ولا بيضحكوا عليكم؟'; }
      else if(clear && has) hint='لسه مختلفين مع بعض. استنى شوية.';
      else if(clear) hint='لسه ما كتبوش حاجة. استنى شوية.';
      else hint='لو سبت الزرار ورجعت، بتكمّل من نفس الوضوح.';
    } else {
      const tg=G.students[pk.target]; gone=tg.caught || tg.away;
      has=!gone && keyOf(tg.ans)!==null; shown = has ? tg.ans : null;
      setText($('st-peek-name'), 'ورقة '+tg.name);
      setText($('st-peek-status'), gone ? (tg.away ? SAY.left[tg.g] : SAY.paperGone[tg.g]) : !clear ? 'لسه مش واضحة' : !has ? SAY.notYet[tg.g] : 'وضحت خالص');
      if(gone) hint='الورقة اتسحبت. بص على حد تاني.';
      else if(clear && has) hint=(isPick(q) && ansText(tg.ans).length<=18 ? tg.name+SAY.chose[tg.g]+ansText(tg.ans) : 'دي إجابة '+tg.name)+(tg.bet>1?SAY.betting[tg.g]+BET[tg.bet]:'')+'. صح، ولا '+(tg.g==='f'?'بتضحك':'بيضحك')+' عليك؟';
      else if(clear) hint='لسه مفيش إجابة في الورقة. استنى شوية أو بص على غيره.';
      else hint='لو سبت الزرار ورجعت، بتكمّل من نفس الوضوح.';
    }
    if(choice) paintBoxes(cells, shown, 'mark', 'ranked');
    else setText($('st-peek-big'), shown===null ? '' : ansText(shown));
  } else {
    const ty = T ? tally(u.team) : null;
    if(choice){
      const btns=$('st-opts').children;
      paintBoxes(btns, u.ans, 'sel', 'sel');
      for(let i=0;i<4;i++){
        btns[i].setAttribute('aria-pressed', btns[i].classList.contains('sel')?'true':'false');
        if(btns[i].disabled!==dead) btns[i].disabled=dead;
        if(T && q.t!=='ord') setText(btns[i].querySelector('.vt'), (!dead && ty.c[i]) ? ar(ty.c[i]) : '');
      }
    } else {
      setText($('st-num-val'), u.ans===null ? '؟' : ar(u.ans));
      Array.prototype.forEach.call($('st-keys').children, b => { if(b.disabled!==dead) b.disabled=dead; });
    }
    /* the wager */
    const left3 = T ? V.TA[u.team] : ((meP()||{}).triples||0), bb=$('st-bets').children;
    for(let i=0;i<3;i++){
      const on = !dead && u.bet===i+1, dis = dead || (i===2 && left3<=0 && u.bet!==3);
      bb[i].classList.toggle('on', on); bb[i].setAttribute('aria-pressed', on?'true':'false');
      if(bb[i].disabled!==dis) bb[i].disabled=dis;
    }
    setText($('st-bet3'), 'تربل ('+ar(Math.max(0,left3))+')');
    if(T){
      const same = q.t==='ord' ? 'نفس الترتيب' : ty.lead===null ? '' : ansText(ty.leadAns);
      /* the row's wager counts only when everyone who answered raised it */
      const tb=teamBet(u.team), betTxt = ty.n===0 ? '' : tb>1 ? ' · رهانكم '+BET[tb] : u.bet>1 ? ' · الرهان لسه عادي' : '';
      setText($('st-tl-t'), dead ? '' : (ty.n===0 ? 'محدش في الصف جاوب لسه' : ty.all ? 'الصف كله على '+same : ty.lead!==null ? ar(ty.max)+' من '+ar(ty.size)+' على '+same : 'الإجابات متقسمة، اتفقوا')+betTxt);
      setHidden($('st-adopt'), dead || isPick(q) || ty.lead===null || myKey===ty.lead);
    }
    $('st-paper').classList.toggle('caught', dead);
    setHidden($('st-caught'), !dead);
    if(dead){
      setText($('st-caught-b'), T && !u.caught ? 'غشاشكم اتمسك!' : 'اتمسكت!');
      setText($('st-caught-s'), T ? 'سؤال صفّكم اتلغى واتخصم منكم ٥ نقط' : 'سؤالك اتلغى واتخصم منك ٥ نقط');
      hint = T && !u.caught ? 'استنوا السؤال الجاي.' : 'استنى السؤال الجاي. المرة الجاية سيب الزرار أول ما السبورة تحمرّ.';
    }
  }
  setText($('st-hint'), hint);

  if(T && !u.cheater){
    const ch=E.cheaterOf(G, u.team);
    setText($('st-ti-b'), !ch ? '' : ch.name+': '+(ch.caught ? SAY.tagCaught[ch.g] : ch.peeking ? SAY.looking[ch.g] : ch.saw ? SAY.saw[ch.g] : SAY.atPaper[ch.g]));
    return;
  }
  const r=$('st-peek-r'), l=$('st-peek-l');
  r.classList.toggle('down', !dead && input.peekDir===-1);
  l.classList.toggle('down', !dead && input.peekDir===1);
  [[-1,'r'],[1,'l']].forEach(side => {
    if(T && side[0]===1) return;
    const btn = side[0]===-1 ? r : l, nb = T ? null : G.students[u.idx+side[0]];
    if(!T && !nb) return;
    const out=!!(nb && nb.away), dis=dead || out;
    if(btn.disabled!==dis) btn.disabled=dis;
    const f=Math.min(1, (u.seen[T?'T':u.idx+side[0]]||0)/peekTime), pct=Math.round(f*100);
    setW($('st-peek-'+side[1]+'-bar'), f);
    setText($('st-peek-'+side[1]+'-sub'), dead ? 'مقفول السؤال ده' : out ? SAY.left[nb.g] : input.peekDir===side[0] ? 'دايس دلوقتي' : pct>=100 ? 'واضحة، دوس تشوفها' : pct>0 ? 'وضحت '+ar(pct)+'٪، كمّل' : (T ? 'إنت غشاش الصف. دوس وافضل دايس' : 'دوس وافضل دايس'));
  });
}

const RING_C=2*Math.PI*56;
function arcLevel(el, ham){ const lv='lv'+(ham<0.3?0:ham<0.62?1:ham<0.87?2:3); if(el.getAttribute('class')!==lv) el.setAttribute('class', lv); }
function renderProctor(){
  const p=G.pr, watching=p.st==='watching', empty=p.budget<=0.05, N=G.students.length, T=G.teams;
  setHidden($('pr-back'), watching); setHidden($('pr-look'), !watching);
  const tLeft=ar(Math.ceil(G.left)), bud=ar(p.budget.toFixed(1))+' ث';
  if(watching){
    setText($('pr-time2'), tLeft); setW($('pr-timebar2'), G.left/G.qT);
    const names=p.lookCatches.map(x => G.students[x].name);
    setText($('pr-banner'), names.length ? 'مسكت '+names.join(' و')+'!' : 'مفيش حد بيبص');
    let sub='لحقوا يعدلوا، أو همهمة كدابة';
    if(names.length===1){ const cs=G.students[p.lookCatches[0]], at=p.lookAt[cs.idx]; sub=SAY.wasAt[cs.g]+(at==='T' ? TEAM[1-cs.team] : (G.students[at] ? G.students[at].name : 'غيره')); }
    else if(names.length>1) sub='اتمسكوا وهم بيبصوا';
    setText($('pr-banner-sub'), sub);
    $('pr-strip').classList.toggle('win', names.length>0);
    const showFx=p.fx && names.length>0;
    if(showFx){
      const one = names.length===1 ? G.students[p.lookCatches[0]] : null;
      setText($('pr-stamp-b'), 'مسكت '+names.join(' و')+'!');
      setText($('pr-stamp-s'), 'كسبت '+ar(V.cfg.catchPts*names.length)+' نقط، '+(one ? (one.g==='f'?'واسمها':'واسمه') : 'وأساميهم')+' على السبورة');
      if(U.fxKey!==G.qi+':'+p.catches.length){ U.fxKey=G.qi+':'+p.catches.length; buzz(90); }
    }
    setHidden($('pr-stamp'), !showFx);
    for(let i=0;i<N;i++){
      const s=G.students[i], c=U.cardEls[i], ico=s.caught?'eye':'paper';
      if(c.getAttribute('data-ico')!==ico){ c.setAttribute('data-ico', ico); c.querySelector('.ico').innerHTML=ICON[ico]; }
      c.classList.toggle('got', s.caught);
      c.classList.toggle('bad', !s.caught && s.mark===-1);
      c.classList.toggle('good', !s.caught && s.mark===1);
      c.classList.toggle('away', s.away);
      if(c.disabled!==(s.caught||s.away)) c.disabled=s.caught||s.away;
      setText(c.querySelector('small'), s.away ? SAY.left[s.g] : s.caught ? SAY.caught[s.g] : SAY.atPaper[s.g]+(s.mark===-1 ? '، '+SAY.tagBad[s.g] : s.mark===1 ? '، '+SAY.tagGood[s.g] : ''));
    }
    setText($('pr-budget-text2'), bud); setW($('pr-budget2'), p.budget/V.cfg.budget);
    return;
  }
  setText($('pr-time'), tLeft); setW($('pr-timebar'), G.left/G.qT);
  const bad=[], good=[];
  G.students.forEach(x => { if(x.mark===-1) bad.push(x.name); else if(x.mark===1) good.push(x.name); });
  [['pr-bad',bad],['pr-good',good]].forEach(col => {
    const el=$(col[0]), many=col[1].length>2;
    el.classList.toggle('many', many);
    setText(el, col[1].join(many?'، ':'\n'));
  });
  setText($('pr-write'), 'نقط الكتابة '+ar(Math.floor(p.writePts)));
  const cn=$('pr-caught');
  while(cn.children.length<p.catches.length){ const sp=document.createElement('span'); sp.textContent=G.students[p.catches[cn.children.length]].name; cn.appendChild(sp); }
  setText($('pr-caught-pts'), p.catches.length ? signed(V.cfg.catchPts*p.catches.length) : '');
  const hotR=G.hamR>=0.3, hotL=G.hamL>=0.3; let word;
  if(p.st==='turning') word='بتلفّ...';
  else if(hotR && hotL) word = T ? 'الصفّين بيهمهموا!' : 'همهمة من الناحيتين!';
  else if(hotR) word = T ? 'صف اليمين بيهمهم!' : 'همهمة من يمينك!';
  else if(hotL) word = T ? 'صف الشمال بيهمهم!' : 'همهمة من شمالك!';
  else word='هادية';
  const nz=$('pr-noise'); setText(nz, word); nz.classList.toggle('hot', (hotR||hotL) && p.st!=='turning');
  arcLevel($('pr-arc-r'), G.hamR); arcLevel($('pr-arc-l'), G.hamL);
  for(let i=0;i<N;i++){
    const st=G.students[i], d=U.seatEls[i], hot = i<G.rc ? hotR : hotL, maybe = hot && !st.caught && !st.away && !st.mark && p.st==='writing';
    d.classList.toggle('got', st.caught);
    d.classList.toggle('bad', !st.caught && st.mark===-1);
    d.classList.toggle('good', !st.caught && st.mark===1);
    d.classList.toggle('maybe', maybe);
    d.classList.toggle('away', st.away);
    if(d.disabled!==(st.caught||st.away)) d.disabled=st.caught||st.away;
    setText(d.querySelector('small'), st.away ? SAY.tagOut[st.g] : st.caught ? SAY.tagCaught[st.g] : st.mark===-1 ? SAY.tagBad[st.g] : st.mark===1 ? SAY.tagGood[st.g] : maybe ? SAY.maybe[st.g] : '');
  }
  setText($('pr-budget-text'), empty ? 'خلص' : bud);
  const dash=(Math.max(0, p.budget/V.cfg.budget)*RING_C).toFixed(1)+' '+RING_C.toFixed(1);
  const ring=$('pr-ring'); if(ring.getAttribute('stroke-dasharray')!==dash) ring.setAttribute('stroke-dasharray', dash);
  const tb=$('pr-turn'), dis = p.st==='turning' || empty;
  if(tb.disabled!==dis) tb.disabled=dis;
  setText(tb, p.st==='turning' ? 'بتلفّ' : empty ? 'الرصيد خلص' : 'لفّ');
}

/* ============ results ============ */
function standings(){
  let rows;
  if(V.g && V.g.teams){
    rows=[0,1].map(t => ({ name:(myTeam()===t?'صفّكم، ':'')+TEAM[t], total:V.T[t], me:myTeam()===t, role:V.P.filter(p => p.team===t).map(p => p.id===pid?'إنت':p.n).join('، ') }));
    V.P.filter(p => p.team<0).forEach(p => rows.push({ name:p.n+(p.id===pid?' (إنت)':''), total:p.pts, me:p.id===pid, role:'المراقب' }));
  }
  else rows=V.P.map(p => ({ name:p.n+(p.id===pid?' (إنت)':''), total:p.pts, me:p.id===pid, role:p.team<0?'المراقب':(p.bot?'كمبيوتر':'طالب') }));
  rows.sort((a,b) => b.total-a.total);
  return rows;
}
function rowEl(name, sub, delta, isMe){
  const d=document.createElement('div'), cls = delta>0 ? ' pos' : delta<0 ? ' neg' : '';
  d.className='rv-row'+(isMe?' me':'');
  d.innerHTML='<div><b></b><span></span></div><div class="num'+cls+'"></div>';
  d.querySelector('b').textContent=name; d.querySelector('span').textContent=sub; d.querySelector('.num').textContent=signed(delta);
  return d;
}
function renderReveal(){
  const q=G.q, p=G.pr;
  $('rv-count').textContent='سؤال '+ar(G.qi+1)+' من '+ar(G.qs.length);
  $('rv-q').textContent=q.q;
  setHidden($('rv-bub'), q.t!=='mc');
  $('rv-bub').textContent = q.t==='mc' ? LETTERS[q.a] : '';
  const right = q.t==='vote' ? (q.win.length ? 'الأغلبية قالت: '+q.win.map(i => q.o[i]).join(' و') : 'مفيش أغلبية، محدش كسب') : ansText(E.correctAns(q));
  $('rv-txt').textContent=right;
  $('rv-ans').classList.toggle('small', right.length>14);
  $('rv-why').textContent=q.why || '';
  const box=$('rv-rows'); box.textContent='';
  const g3 = s => s.g==='u' ? 'm' : s.g;
  if(G.teams){
    G.tres.forEach((r,t) => {
      const mine=myTeam()===t, parts=[];
      if(r.dead){ const cc=G.students[p.catches.filter(i => G.students[i].team===t)[0]]; parts.push((cc && cc.user ? 'اتمسكت وإنت بتبص' : 'الغشاش '+(cc?cc.name:'')+' اتمسك')+'، والسؤال اتلغى'); }
      else{
        if(keyOf(r.ans)===null) parts.push(r.voted ? (mine?'ما اتفقتوش على إجابة':'ما اتفقوش على إجابة') : (mine?'ما جاوبتوش':'ما جاوبوش'));
        else parts.push(resultWord(r,'m').replace(/^كتب /, mine?'كتبتوا ':'كتبوا ').replace(/^اختار /, mine?'اخترتوا ':'اختاروا ')+(r.all?'، بالإجماع':'، بالأغلبية'));
        if(r.bet>1) parts.push((mine?'راهنتوا ':'راهنوا ')+BET[r.bet]+(r.won ? (mine?' وكسبتوا':' وكسبوا') : (mine?' وخسرتوا':' وخسروا')));
        if(r.copied) parts.push(mine?'نقلتوا من الصف التاني':'نقلوا من الصف التاني');
        else if(r.peeked) parts.push(mine?'غشاشكم بص وما نقلتوش':'غشاشهم بص وما نقلوش');
        if(r.bonus>0) parts.push(mine?'ضحكتوا على الصف التاني':'ضحكوا على الصف التاني');
        G.students.forEach(s => { if(s.team===t && s.markRes) parts.push(s.real+' '+SAY[s.markRes==='bad'?'bad':s.markRes==='wronged'?'wronged':'good'][g3(s)]); });
      }
      box.appendChild(rowEl((mine?'صفّكم، ':'')+TEAM[t], parts.join('، '), r.delta, mine));
    });
  } else {
    G.students.forEach(s => {
      const t=[];
      if(s.caught) t.push(SAY.caught[s.g]);
      else if(s.away && keyOf(s.ans)===null) t.push(SAY.out[s.g]);
      else{
        t.push(resultWord(s, s.g));
        if(s.bet>1) t.push(betWord(s, s.g));
        if(s.didCopy && G.students[s.copiedFrom]) t.push(SAY.copied[s.g]+G.students[s.copiedFrom].name);
        else if(s.peeked) t.push(SAY.peeked[s.g]);
        if(s.bonus>0) t.push(SAY.fooled[s.g]);
        if(s.markRes==='bad') t.push(SAY.bad[s.g]); else if(s.markRes==='wronged') t.push(SAY.wronged[s.g]); else if(s.markRes) t.push(SAY.good[s.g]);
      }
      box.appendChild(rowEl(s.name, t.join('، '), s.delta, s.user));
    });
  }
  const did=[], caught=p.catches.map(i => G.students[i].name);
  if(p.away && !caught.length) did.push('كان برّه اللجنة');
  if(caught.length) did.push(SAY.prCaught[p.g]+caught.join(' و'));
  G.students.forEach(s => {
    if(!s.markRes) return;
    const k={bad:'prRight',wronged:'prWrong',good:'prGood',fooled:'prFooled'}[s.markRes];
    did.push(s.user ? SAY[k+'U'][p.g==='f'?'f':'m'] : SAY[k][p.g]+s.name);
  });
  box.appendChild(rowEl(p.name+' (المراقب)', did.length ? did.join('، ') : SAY.prNone[p.g], p.delta, p.isUser));
  box.classList.toggle('dense', !G.teams && G.students.length>4);
  /* a running score */
  const st=standings(); let rank=1, mine=0;
  st.forEach((r,i) => { if(r.me){ rank=i+1; mine=r.total; } });
  $('rv-me').textContent=(myTeam()>=0?'مجموع صفّكم ':'مجموعك ')+num(mine)+'، والترتيب '+ar(rank)+' من '+ar(st.length);
}
function syncReveal(){
  const owner=isOwner();
  $('rv-next').disabled=!owner;
  setText($('rv-next-b'), G.last ? 'النتيجة' : 'السؤال الجاي');
  setText($('rv-next-s'), (owner?'أو استنى ':'بعد ')+ar(G.revealLeft)+' ث');
}
function renderEnd(){
  const rows=standings(); let meRank=1;
  rows.forEach((r,i) => { if(r.me) meRank=i+1; });
  let title = meRank===1 ? 'إنت الأول!' : 'ترتيبك '+ar(meRank)+' من '+ar(rows.length);
  if(myTeam()>=0){ const a=V.T[myTeam()], b=V.T[1-myTeam()]; title = a>b ? 'صفّكم كسب!' : a===b ? 'تعادل بين الصفّين' : 'صفّكم خسر'; }
  $('end-title').textContent=title;
  const box=$('end-rows'); box.textContent='';
  box.classList.toggle('dense', rows.length>6);
  rows.forEach((r,i) => {
    const d=document.createElement('div'); d.className='er'+(r.me?' me':'');
    d.innerHTML='<div class="rank"></div><div><b></b><span></span></div><div class="num"></div>';
    d.querySelector('.rank').textContent=ar(i+1);
    d.querySelector('b').textContent=r.name;
    d.querySelector('span').textContent=r.role;
    d.querySelector('.num').textContent=num(r.total);
    box.appendChild(d);
  });
}
function syncEnd(){
  const owner=isOwner(), ow=V.P.find(p => p.id===V.owner);
  $('end-again').disabled=!owner;
  setText($('end-again-s'), owner ? 'ارجعوا اللجنة وابدأوا تاني' : 'مستنيين '+(ow?ow.n:'صاحب اللجنة'));
}

/* ============ the clock between two views ============ */
let last=performance.now();
function frame(now){
  const dt=Math.min(0.1, Math.max(0, (now-last)/1000)); last=now;
  if(LOCAL) LOCAL.tick();
  else if(V && G && V.ph==='play' && G.phase==='play' && (U.screen==='s-student' || U.screen==='s-proctor')){
    /* the server speaks ten times a second; in between, time keeps moving on the screen */
    G.left=Math.max(0, G.left-dt);
    if(G.mode==='student'){
      const u=G.students[G.me];
      if(u && u.peek && input.peekDir!==0){ u.peek.prog=Math.min(V.cfg.peekTime, u.peek.prog+dt); u.seen[u.peek.target]=u.peek.prog; }
      renderStudent();
    } else if(G.mode==='proctor'){
      if(G.pr.st==='watching') G.pr.budget=Math.max(0, G.pr.budget-dt);
      renderProctor();
    }
  }
  requestAnimationFrame(frame);
}

/* ============ what the player does ============ */
function hold(el, down, up){
  let active=false;
  function d(e){
    if(el.disabled) return;
    if(e && e.type==='pointerdown'){ e.preventDefault(); try{ el.setPointerCapture(e.pointerId); }catch(err){} }
    if(!active){ active=true; down(); }
  }
  function u(){ if(active){ active=false; up(); } }
  el.addEventListener('pointerdown', d);
  ['pointerup','pointercancel','lostpointercapture'].forEach(t => el.addEventListener(t, u));
  el.addEventListener('keydown', e => { if((e.key===' '||e.key==='Enter') && !e.repeat){ e.preventDefault(); d(); } });
  el.addEventListener('keyup', e => { if(e.key===' '||e.key==='Enter'){ e.preventDefault(); u(); } });
  el.addEventListener('blur', u);
  el.addEventListener('contextmenu', e => e.preventDefault());
  holds.push({ reset(){ active=false; } });
}
function setPeek(d){ if(input.peekDir===d) return; input.peekDir=d; act({k:'peek', v:d}); }
hold($('st-peek-r'), () => setPeek(-1), () => { if(input.peekDir===-1) setPeek(0); });
hold($('st-peek-l'), () => setPeek(1), () => { if(input.peekDir===1) setPeek(0); });
function dropPeek(){ holds.forEach(h => h.reset()); if(input.peekDir!==0) setPeek(0); }
window.addEventListener('blur', dropPeek);
document.addEventListener('visibilitychange', () => { if(document.hidden) dropPeek(); });

function proctorAction(){
  if(!G || G.mode!=='proctor' || G.phase!=='play') return;
  if(G.pr.st==='writing') act({k:'turn'});
  else if(G.pr.st==='watching') act({k:'back'});
}
$('pr-turn').addEventListener('click', proctorAction);
$('pr-backbtn').addEventListener('click', proctorAction);
/* the board: tap a student to cycle  nothing -> troublemakers -> excellent -> nothing */
function markTap(e){
  const d=e.target.closest ? e.target.closest('[data-i]') : null;
  if(!d || !G || G.mode!=='proctor' || G.phase!=='play') return;
  const i=+d.getAttribute('data-i'), s=G.students[i];
  if(!s || s.caught || s.away) return;
  s.mark = s.mark===0 ? -1 : (s.mark===-1 ? 1 : 0);
  act({k:'mark', i}); renderProctor();
}
$('pr-seats').addEventListener('click', markTap);
$('pr-cards').addEventListener('click', markTap);

function player(){
  if(!G || G.mode!=='student' || G.phase!=='play') return null;
  const u=G.students[G.me];
  return (!u || (G.teams ? G.void[u.team] : u.caught)) ? null : u;
}
function setAns(u, a){ u.ans=a; U.pend={ qi:G.qi, ans:clone(a), at:Date.now() }; act({k:'ans', v:a}); renderStudent(); }
function boxTap(i){
  const u=player(); if(!u) return;
  const q=G.q; if(q.t==='num' || i>=q.o.length) return;
  if(q.t==='ord'){
    /* tap the items in order; tap a ranked one to take it back; the last one fills itself in */
    const id=G.disp[i], a = u.ans ? u.ans.slice() : [], at=a.indexOf(id);
    if(at>=0) a.splice(at,1);
    else{ a.push(id); if(a.length===3) a.push([0,1,2,3].filter(x => a.indexOf(x)<0)[0]); }
    setAns(u, a.length ? a : null);
  } else setAns(u, i);
}
function numKey(d){
  const u=player(); if(!u || G.q.t!=='num') return;
  if(d==='del'){ const s = u.ans===null ? '' : String(u.ans).slice(0,-1); setAns(u, s==='' ? null : +s); }
  else{ const cur = u.ans===null ? '' : String(u.ans); if(cur.length<6) setAns(u, +(cur+d)); }
}
Array.prototype.forEach.call($('st-opts').children, (b,i) => b.addEventListener('click', () => boxTap(i)));
$('st-keys').addEventListener('click', e => { const b=e.target.closest ? e.target.closest('[data-d]') : null; if(b) numKey(b.getAttribute('data-d')); });
$('st-bets').addEventListener('click', e => {
  const b=e.target.closest ? e.target.closest('.bet') : null, u=player();
  if(!b || b.disabled || !u) return;
  u.bet=+b.getAttribute('data-b'); U.pendB={ qi:G.qi, bet:u.bet, at:Date.now() };
  act({k:'bet', v:u.bet}); renderStudent();
});
$('st-adopt').addEventListener('click', () => { if(player() && G.teams){ U.pend=null; act({k:'adopt'}); } });

/* desktop keys: arrows peek, digits answer; proctor: space turns / goes back */
document.addEventListener('keydown', e => {
  const tag=e.target && e.target.tagName;
  if(!G || e.repeat || G.phase!=='play' || tag==='INPUT' || (tag==='BUTTON' && (e.key===' '||e.key==='Enter'))) return;
  if(G.mode==='student' && U.screen==='s-student'){
    if(e.key==='ArrowRight'){ if(!$('st-peek-r').hidden && !$('st-peek-r').disabled) setPeek(-1); e.preventDefault(); }
    else if(e.key==='ArrowLeft' && !G.teams){ if(!$('st-peek-l').hidden && !$('st-peek-l').disabled) setPeek(1); e.preventDefault(); }
    else if(G.q.t==='num'){ if(e.key>='0' && e.key<='9') numKey(e.key); else if(e.key==='Backspace') numKey('del'); }
    else if(e.key>='1' && e.key<='4') boxTap((+e.key)-1);
  } else if(G.mode==='proctor' && e.key===' '){ proctorAction(); e.preventDefault(); }
});
document.addEventListener('keyup', e => {
  if(e.key==='ArrowRight' && input.peekDir===-1) setPeek(0);
  else if(e.key==='ArrowLeft' && input.peekDir===1) setPeek(0);
});

/* stepping out: first tap asks, second tap within 3s leaves the game (it carries on, and you can come back) */
const exitBtns=Array.prototype.slice.call(document.querySelectorAll('.exit')); let exitTimer=null;
function exitReset(){ clearTimeout(exitTimer); exitBtns.forEach(b => { b.classList.remove('sure'); b.textContent='خروج'; }); }
exitBtns.forEach(b => b.addEventListener('click', () => {
  if(!b.classList.contains('sure')){ exitReset(); b.classList.add('sure'); b.textContent='متأكد؟'; exitTimer=setTimeout(exitReset, 3000); return; }
  exitReset(); dropPeek(); act({k:'out', v:true});
}));
$('rv-next').addEventListener('click', () => { if(V && isOwner()) cmd('next'); });
$('end-again').addEventListener('click', () => { if(V && isOwner()) cmd('newgame'); });
$('end-leave').addEventListener('click', () => { send({t:'leave'}); goHome(''); });

/* ============ start ============ */
try{
  const invited=(/[?&]code=(\d{4})(?:&|$)/.exec(location.search)||[])[1];
  if(invited){ codeIns.forEach((inp,i) => { inp.value=ar(invited.charAt(i)); }); syncCode(); store.set('lagna_room',''); }
  else{
    /* the page was reloaded in the middle of a game: go straight back to the same seat */
    const room=store.get('lagna_room');
    if(canNet && room && /^\d{4}$/.test(room) && ME.name) netOpen(room, {t:'join', pid, name:ME.name, g:ME.g}, r => { if(r.t==='err') goHome(''); });
  }
}catch(e){}
window.__lagna = { state:() => G, view:() => V, local:() => LOCAL, pid };
requestAnimationFrame(frame);
})();
