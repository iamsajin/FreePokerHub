/* ============================================================
   TEXAS HOLD'EM — engine + UI
   ============================================================ */
const SUITS = ['♠','♥','♦','♣'];      // 0 spade,1 heart,2 diamond,3 club
const RED = new Set([1,2]);
const RANKS = {14:'A',13:'K',12:'Q',11:'J',10:'10',9:'9',8:'8',7:'7',6:'6',5:'5',4:'4',3:'3',2:'2'};
const RANKNAME = {14:'Ace',13:'King',12:'Queen',11:'Jack',10:'Ten',9:'Nine',8:'Eight',7:'Seven',6:'Six',5:'Five',4:'Four',3:'Three',2:'Two'};
const START_CHIPS = 1000, BASE_SB = 10, BASE_BB = 20;
const BOT_NAMES = ['Ava','Marco','Lena','Diego'];
const AVATARS = {
  'Ava':  {photo:'https://randomuser.me/api/portraits/women/68.jpg', img:'images/avatar-ava.svg'},
  'Marco':{photo:'https://randomuser.me/api/portraits/men/32.jpg',   img:'images/avatar-marco.svg'},
  'Lena': {photo:'https://randomuser.me/api/portraits/women/44.jpg', img:'images/avatar-lena.svg'},
  'Diego':{photo:'https://randomuser.me/api/portraits/men/75.jpg',   img:'images/avatar-diego.svg'}
};
// AI behaviour per difficulty. Higher difficulty = tighter, more aggressive, fewer mistakes, more bluffs.
const DIFFICULTY = {
  easy:   {label:'Easy',   betThresh:0.72, raiseThresh:0.86, foldBelow:0.20, bluff:0.03, callStation:0.55, noise:0.20},
  medium: {label:'Medium', betThresh:0.62, raiseThresh:0.78, foldBelow:0.32, bluff:0.06, callStation:0.30, noise:0.10},
  hard:   {label:'Hard',   betThresh:0.55, raiseThresh:0.70, foldBelow:0.38, bluff:0.11, callStation:0.18, noise:0.06},
  expert: {label:'Expert', betThresh:0.50, raiseThresh:0.64, foldBelow:0.42, bluff:0.16, callStation:0.12, noise:0.04}
};
// Rising blind schedule; level advances every BLIND_EVERY hands.
const BLINDS = [[10,20],[15,30],[25,50],[40,80],[60,120],[100,200],[150,300],[250,500],[400,800],[600,1200]];
const BLIND_EVERY = 5;

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const $ = id => document.getElementById(id);
const money = n => '$' + Number(n).toLocaleString('en-US');

let G = null;            // game state
let user = {name:'', email:''};
let humanResolve = null; // resolves human action promise
let difficulty = 'medium';

/* ---------- SOUND (Web Audio, generated — no files) ---------- */
const Sound = (()=>{
  let ctx=null, on=true;
  const ac=()=>{ if(!ctx){ try{ ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } return ctx; };
  function tone(freq,dur,type='sine',vol=0.18,slideTo){
    if(!on) return; const c=ac(); if(!c) return;
    const o=c.createOscillator(), g=c.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,c.currentTime);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo,c.currentTime+dur);
    g.gain.setValueAtTime(vol,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001,c.currentTime+dur);
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime+dur);
  }
  function noise(dur,vol){
    if(!on) return; const c=ac(); if(!c) return;
    const b=c.createBuffer(1,Math.floor(c.sampleRate*dur),c.sampleRate);
    const d=b.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length);
    const s=c.createBufferSource(); s.buffer=b; const g=c.createGain();
    g.gain.value=vol; s.connect(g).connect(c.destination); s.start();
  }
  return {
    deal:()=>noise(0.07,0.12),
    chip:()=>{ tone(880,0.05,'square',0.09); setTimeout(()=>tone(1180,0.05,'square',0.08),45); },
    check:()=>tone(320,0.08,'sine',0.14),
    fold:()=>tone(220,0.14,'sawtooth',0.10,130),
    raise:()=>{ tone(520,0.07,'square',0.11); setTimeout(()=>tone(760,0.08,'square',0.11),70); },
    win:()=>{ [523,659,784,1047].forEach((f,k)=>setTimeout(()=>tone(f,0.2,'triangle',0.16),k*95)); },
    click:()=>tone(620,0.04,'sine',0.08),
    resume:()=>{ const c=ac(); if(c && c.state==='suspended') c.resume(); },
    set:(v)=>{ on = (v===undefined)? !on : !!v; return on; },
    isOn:()=>on
  };
})();

/* ---------- DECK / CARDS ---------- */
function makeDeck(){
  const d=[];
  for(let s=0;s<4;s++) for(let r=2;r<=14;r++) d.push({r,s});
  for(let i=d.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; }
  return d;
}

/* ---------- HAND EVALUATION ----------
   returns array [category, tiebreakers...] ; higher compares greater
   category: 8 SF, 7 quads, 6 full, 5 flush, 4 straight, 3 trips, 2 two pair, 1 pair, 0 high */
function rank5(cards){
  const rs = cards.map(c=>c.r).sort((a,b)=>b-a);
  const ss = cards.map(c=>c.s);
  const counts = {};
  rs.forEach(r=>counts[r]=(counts[r]||0)+1);
  const flush = ss.every(s=>s===ss[0]);
  // straight detection (with wheel A-5)
  let uniq = [...new Set(rs)];
  let straightHigh = 0;
  if(uniq.length===5){
    if(uniq[0]-uniq[4]===4) straightHigh = uniq[0];
    else if(uniq[0]===14 && uniq[1]===5 && uniq[4]===2) straightHigh = 5; // wheel
  }
  // group by count then rank
  const groups = Object.entries(counts).map(([r,c])=>({r:+r,c}))
    .sort((a,b)=> b.c-a.c || b.r-a.r);
  const pattern = groups.map(g=>g.c).join('');
  const kick = groups.map(g=>g.r);
  if(straightHigh && flush) return [8, straightHigh];
  if(pattern==='41') return [7, kick[0], kick[1]];
  if(pattern==='32') return [6, kick[0], kick[1]];
  if(flush) return [5, ...rs];
  if(straightHigh) return [4, straightHigh];
  if(pattern==='311') return [3, kick[0], kick[1], kick[2]];
  if(pattern==='221') return [2, kick[0], kick[1], kick[2]];
  if(pattern==='2111') return [1, kick[0], kick[1], kick[2], kick[3]];
  return [0, ...rs];
}
function combos(arr,k){
  const res=[]; const n=arr.length;
  (function go(start,cur){
    if(cur.length===k){ res.push(cur.slice()); return; }
    for(let i=start;i<n;i++){ cur.push(arr[i]); go(i+1,cur); cur.pop(); }
  })(0,[]);
  return res;
}
function bestOf7(cards){
  let best=null;
  for(const c of combos(cards,5)){
    const s=rank5(c);
    if(!best || cmp(s,best)>0) best=s;
  }
  return best;
}
function cmp(a,b){ for(let i=0;i<Math.max(a.length,b.length);i++){ const x=a[i]||0,y=b[i]||0; if(x!==y) return x-y;} return 0; }
const CAT_NAME=['High Card','Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush'];
function handName(score){
  if(score[0]===8 && score[1]===14) return 'Royal Flush';
  return CAT_NAME[score[0]];
}
// Detailed description of an evaluated 5-card score, e.g. "Two Pair, Kings & Nines".
function describeBest(b){
  const N=RANKNAME;
  switch(b[0]){
    case 8: return b[1]===14 ? 'Royal Flush' : ('Straight Flush, '+N[b[1]]+' high');
    case 7: return 'Four of a Kind, '+N[b[1]]+'s';
    case 6: return 'Full House, '+N[b[1]]+'s over '+N[b[2]]+'s';
    case 5: return 'Flush, '+N[b[1]]+' high';
    case 4: return 'Straight, '+N[b[1]]+' high';
    case 3: return 'Three of a Kind, '+N[b[1]]+'s';
    case 2: return 'Two Pair, '+N[b[1]]+'s & '+N[b[2]]+'s';
    case 1: return 'Pair of '+N[b[1]]+'s';
    default: return N[b[1]]+' high';
  }
}
// Preflop description of two hole cards.
function describeHole(cards){
  const [a,b]=cards.map(c=>c.r).sort((x,y)=>y-x);
  if(a===b) return 'Pair of '+RANKNAME[a]+'s';
  const suited = cards[0].s===cards[1].s ? ' suited' : '';
  return RANKNAME[a]+' '+RANKNAME[b]+suited;
}
function updateHandInfo(){
  const el=$('handInfo'); if(!el) return;
  const p=G && G.players && G.players[0];
  if(!p || !p.cards.length || p.folded){ el.innerHTML=''; return; }
  const cc=G.community;
  const text = cc.length>=3 ? describeBest(bestOf7([...p.cards,...cc])) : describeHole(p.cards);
  el.innerHTML='Your hand: <b>'+text+'</b>';
}

/* ---------- SEAT POSITIONS (percent of table-wrap) ---------- */
const SEAT_POS = [
  {x:50, y:75},   // 0 human bottom (raised so it clears the floating controls panel)
  {x:9,  y:52},   // 1 left
  {x:22, y:16},   // 2 top-left
  {x:78, y:16},   // 3 top-right
  {x:91, y:52},   // 4 right
];
const BET_POS = [
  {x:50, y:63}, {x:22, y:48}, {x:31, y:30}, {x:69, y:30}, {x:78, y:48}
];

/* ---------- RENDER ---------- */
function cardHTML(card, big){
  const cls = big?'card big':'card';
  if(!card) return `<div class="${cls} back"></div>`;
  const color = RED.has(card.s)?'red':'black';
  return `<div class="${cls} ${color}">
      <div class="r">${RANKS[card.r]}</div>
      <div class="s-mid">${SUITS[card.s]}</div>
      <div class="r bot">${RANKS[card.r]}</div>
    </div>`;
}
function buildSeats(){
  const wrap=$('seats'); wrap.innerHTML='';
  G.players.forEach((p,i)=>{
    const pos=SEAT_POS[i];
    const seat=document.createElement('div');
    seat.className='seat'; seat.id='seat'+i;
    seat.style.left=pos.x+'%'; seat.style.top=pos.y+'%';
    const av = AVATARS[p.name];
    const avatarHTML = (!p.isHuman && av)
      ? `<div class="p-avatar"><img src="${av.photo}" alt="${p.name}" loading="lazy" onerror="this.onerror=null;this.src='${av.img}';"></div>` : '';
    seat.innerHTML=`
      <div class="p-action" id="pa${i}"></div>
      <div class="player-card">
        <div class="crown">
          <svg viewBox="0 0 48 40" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 32 L8 12 L18 23 L24 6 L30 23 L40 12 L44 32 Z" fill="#f0d878" stroke="#b8860b" stroke-width="1.5" stroke-linejoin="round"/>
            <rect x="4" y="31" width="40" height="6" rx="2" fill="#d4af37" stroke="#b8860b" stroke-width="1"/>
            <circle cx="24" cy="6" r="3" fill="#e74c3c"/><circle cx="8" cy="12" r="2.4" fill="#2471a3"/><circle cx="40" cy="12" r="2.4" fill="#2471a3"/>
          </svg>
        </div>
        <div class="pc-left">
          ${avatarHTML}
          <div class="p-name">${p.isHuman?'★ ':''}${p.name}</div>
          <div class="p-chips" id="chips${i}">${money(p.chips)}</div>
        </div>
        <div class="p-hand" id="hand${i}"></div>
      </div>`;
    wrap.appendChild(seat);
    const bet=document.createElement('div');
    bet.className='seat-bet'; bet.id='bet'+i; bet.style.opacity='0';
    bet.style.left=BET_POS[i].x+'%'; bet.style.top=BET_POS[i].y+'%';
    wrap.appendChild(bet);
  });
}
function renderHands(reveal){
  G.players.forEach((p,i)=>{
    const el=$('hand'+i);
    if(!p.cards.length){ el.innerHTML=''; return; }
    const show = p.isHuman || reveal || (p.revealed);
    el.innerHTML = p.cards.map(c=> show?cardHTML(c,false):cardHTML(null,false)).join('');
  });
}
function renderChips(){
  G.players.forEach((p,i)=>{
    $('chips'+i).textContent = money(p.chips);
    // a player with $0 who is out of the hand (busted / sitting out) looks disabled;
    // an all-in player mid-hand still has $0 but is NOT disabled.
    const out = p.chips===0 && (G.handOver || p.folded);
    $('seat'+i).classList.toggle('busted', out);
  });
}
function renderPot(){ $('pot').innerHTML = `<span class="pot-label">POT</span> <span class="pot-value">${money(G.pot + G.players.reduce((s,p)=>s+p.bet,0))}</span>`; }
function renderBets(){
  G.players.forEach((p,i)=>{
    const el=$('bet'+i);
    if(p.bet>0){ el.textContent=money(p.bet); el.style.opacity='1'; }
    else el.style.opacity='0';
  });
}
function setActive(idx){
  G.players.forEach((p,i)=> $('seat'+i).classList.toggle('active', i===idx && !p.folded));
}
function showAction(i,text,type){
  const el=$('pa'+i); el.textContent=text; el.className='p-action show '+(type||'');
  setTimeout(()=>{ el.classList.remove('show'); }, 1400);
}
function positionDealer(){
  const d=$('dbtn'); d.style.display='flex';
  const p=SEAT_POS[G.dealer];
  // nudge dealer button toward center
  d.style.left=(p.x + (p.x<50?6:p.x>50?-6:0))+'%';
  d.style.top=(p.y + (p.y<50?8:-8))+'%';
}
function setMsg(html){ $('msg').innerHTML=html; }

/* chip fly animation from seat to pot */
function flyChips(fromIdx){
  const wrap=$('seats').parentElement; // table-wrap
  const rect=wrap.getBoundingClientRect();
  const from=BET_POS[fromIdx];
  const chipColors=[['#c0392b','#f6f6f6'],['#2471a3','#f6f6f6'],['#1e8449','#f6f6f6'],['#5b2c6f','#f0e6f5'],['#b7950b','#fff8dc']];
  for(let k=0;k<3;k++){
    const c=document.createElement('div'); c.className='fly-chip';
    const col=chipColors[Math.floor(Math.random()*chipColors.length)];
    c.style.setProperty('--body',col[0]); c.style.setProperty('--edge',col[1]);
    c.style.left=from.x+'%'; c.style.top=from.y+'%';
    wrap.appendChild(c);
    requestAnimationFrame(()=>{
      const dx=(50-from.x)/100*rect.width;
      const dy=(60-from.y)/100*rect.height;
      c.style.transform=`translate(${dx}px,${dy}px) scale(.6)`;
      c.style.opacity='0';
    });
    setTimeout(()=>c.remove(), 600);
  }
}

/* ============================================================
   GAME FLOW
   ============================================================ */
function initGame(){
  G = {
    players: [
      {name:user.name||'You', chips:START_CHIPS, isHuman:true},
      ...BOT_NAMES.map(n=>({name:n, chips:START_CHIPS, isHuman:false}))
    ].map(p=>({...p, cards:[], bet:0, contributed:0, folded:false, allIn:false, revealed:false})),
    deck:[], community:[], pot:0, dealer: Math.floor(Math.random()*5),
    currentBet:0, minRaise:BASE_BB, stage:'idle', handOver:true,
    difficulty: difficulty,
    sb:BASE_SB, bb:BASE_BB, handCount:0,
    stats:{played:0, won:0, biggestPot:0}
  };
  buildSeats(); renderChips(); renderPot(); updateBlindDisplay();
}
function updateBlindDisplay(){
  const el=$('blindInfo'); if(!el) return;
  const lvl=Math.min(Math.floor(G.handCount/BLIND_EVERY), BLINDS.length-1)+1;
  el.innerHTML=`Blinds <b>${money(G.sb)}/${money(G.bb)}</b> · Lvl ${lvl}`;
}

async function startHand(){
  // Re-buy / reset logic. If human busts, or fewer than 2 players have chips, reset the table.
  if(G.players[0].chips<=0){ setMsg('You ran out of chips. Table re-bought, good luck!'); G.players.forEach(p=>p.chips=START_CHIPS); }
  else if(G.players.filter(p=>p.chips>0).length<2){ setMsg('Everyone else busted. Table re-bought!'); G.players.forEach(p=>{ if(p.chips<=0) p.chips=START_CHIPS; }); }
  // rising blinds: advance level based on hands played
  G.handCount++;
  const lvl=Math.min(Math.floor((G.handCount-1)/BLIND_EVERY), BLINDS.length-1);
  const prevBB=G.bb;
  [G.sb,G.bb]=BLINDS[lvl];
  updateBlindDisplay();
  if(G.handCount>1 && G.bb!==prevBB) setMsg(`Blinds up! Now ${money(G.sb)}/${money(G.bb)}`);

  // reset
  G.players.forEach(p=>{ p.cards=[]; p.bet=0; p.contributed=0; p.folded=(p.chips<=0); p.allIn=false; p.revealed=false; });
  G.players.forEach((p,i)=>{ $('seat'+i).classList.remove('folded','winner'); });
  G.deck=makeDeck(); G.community=[]; G.pot=0; G.currentBet=0; G.minRaise=G.bb;
  G.handOver=false;
  $('board').innerHTML=''; $('stageTag').textContent=''; updateHandInfo();
  renderHands(false); renderChips(); renderPot(); renderBets();
  $('btn-newhand').style.display='none';

  // rotate dealer to next player with chips
  do { G.dealer=(G.dealer+1)%5; } while(G.players[G.dealer].chips<=0);
  positionDealer();

  // blinds: SB = next after dealer, BB = next
  const sbIdx = nextActive(G.dealer);
  const bbIdx = nextActive(sbIdx);
  postBlind(sbIdx, G.sb); postBlind(bbIdx, G.bb);
  G.currentBet=G.bb;
  renderBets(); renderChips(); renderPot();

  // deal hole cards (2 rounds)
  await dealHoleCards();
  updateHandInfo();

  G.stage='preflop';
  $('stageTag').textContent='Pre-Flop';
  const firstToAct = nextActive(bbIdx);
  const result = await bettingRound(firstToAct, bbIdx);
  await proceed(result);
}

function nextActive(i){ let j=i; do{ j=(j+1)%5; }while(G.players[j].chips<=0 && j!==i); return j; }
function postBlind(i,amt){
  const p=G.players[i]; const pay=Math.min(amt,p.chips);
  p.chips-=pay; p.bet=pay; p.contributed+=pay; if(p.chips===0)p.allIn=true;
}

async function dealHoleCards(){
  for(let round=0; round<2; round++){
    for(let k=0;k<5;k++){
      const i=(G.dealer+1+k)%5;
      const p=G.players[i];
      if(p.chips<=0 && p.bet===0 && p.folded) continue;
      if(p.folded && p.chips<=0) continue;
      p.cards.push(G.deck.pop());
      renderHands(false);
      // deal animation on the new card
      const el=$('hand'+i);
      if(el.lastChild){ el.lastChild.classList.add('deal'); }
      Sound.deal();
      await sleep(120);
    }
  }
}

/* betting round. startIdx first to act. bbOption index gets to act even if matched (preflop). */
async function bettingRound(startIdx, bbOption){
  // reset hasActed
  G.players.forEach(p=>p.hasActed=false);
  let i=startIdx;
  // safety cap
  let guard=0;
  while(guard++<200){
    const contenders=G.players.filter(p=>!p.folded);
    if(contenders.length<=1) return 'earlywin';
    const p=G.players[i];
    const canAct = !p.folded && !p.allIn && p.chips>0;
    const needs = canAct && (!p.hasActed || p.bet<G.currentBet);
    if(needs){
      setActive(i);
      if(p.isHuman){ await humanAction(p,i); }
      else { await sleep(650+Math.random()*500); botAction(p,i); }
      renderChips(); renderBets(); renderPot();
    }
    // termination check
    const stillNeed = G.players.some(pl=>!pl.folded && !pl.allIn && pl.chips>0 && (!pl.hasActed || pl.bet<G.currentBet));
    if(!stillNeed) break;
    i=nextActive(i);
  }
  setActive(-1);
  return 'continue';
}

function applyCall(p,i){
  const need=Math.min(G.currentBet-p.bet, p.chips);
  p.chips-=need; p.bet+=need; p.contributed+=need; p.hasActed=true;
  if(p.chips===0){ p.allIn=true; showAction(i,'All-In'); }
  else showAction(i, need===0?'Check':'Call '+money(need));
  if(need>0){ flyChips(i); Sound.chip(); } else Sound.check();
}
function applyFold(p,i){ p.folded=true; p.hasActed=true; showAction(i,'Fold','fold'); $('seat'+i).classList.add('folded'); Sound.fold(); if(p.isHuman) updateHandInfo(); }
function applyRaise(p,i,to){
  to=Math.min(to, p.bet+p.chips);
  const inc=to-p.bet;
  p.chips-=inc; p.contributed+=inc; p.bet=to;
  const raiseAmt=to-G.currentBet;
  if(raiseAmt>=G.minRaise) G.minRaise=raiseAmt;
  G.currentBet=to;
  p.hasActed=true;
  // everyone else must act again
  G.players.forEach(o=>{ if(o!==p && !o.folded && !o.allIn) o.hasActed=false; });
  if(p.chips===0){ p.allIn=true; showAction(i,'All-In'); } else showAction(i,'Raise '+money(to));
  flyChips(i); Sound.raise();
}

/* ---- HUMAN ---- */
function humanAction(p,i){
  return new Promise(resolve=>{
    humanResolve=resolve;
    const toCall=G.currentBet-p.bet;
    const callBtn=$('a-call'), raiseBtn=$('a-raise'), foldBtn=$('a-fold');
    $('actionBtns').style.display='flex';
    foldBtn.disabled=false;
    // call/check
    callBtn.disabled=false;
    callBtn.textContent = toCall<=0 ? 'Check' : (toCall>=p.chips? 'Call '+money(p.chips)+' (All-In)' : 'Call '+money(toCall));
    // raise setup
    const minTo=Math.max(G.currentBet+G.minRaise, G.currentBet+G.bb);
    const maxTo=p.bet+p.chips;
    if(maxTo<=G.currentBet || p.chips<=toCall){
      // can't raise (not enough)
      raiseBtn.disabled=true; $('raiseRow').style.display='none'; $('quickRow').style.display='none';
    } else {
      raiseBtn.disabled=false;
      $('raiseRow').style.display='flex'; $('quickRow').style.display='flex';
      const sld=$('raiseSlider');
      sld.min=Math.min(minTo,maxTo); sld.max=maxTo; sld.step=G.sb;
      sld.value=Math.min(minTo,maxTo);
      $('raiseVal').textContent=money(sld.value);
      raiseBtn.textContent = (+sld.value>=maxTo)?'All-In':'Raise to '+money(sld.value);
    }
    setMsg(toCall>0 ? `Your move: call <b>${money(toCall)}</b> or raise.` : `Your move: check or bet.`);

    foldBtn.onclick=()=>{ finishHuman(()=>applyFold(p,i)); };
    callBtn.onclick=()=>{ finishHuman(()=>applyCall(p,i)); };
    raiseBtn.onclick=()=>{ const to=+$('raiseSlider').value; finishHuman(()=>applyRaise(p,i,to)); };
    $('raiseSlider').oninput=()=>{
      const v=+$('raiseSlider').value; $('raiseVal').textContent=money(v);
      raiseBtn.textContent=(v>=maxTo)?'All-In':'Raise to '+money(v);
    };
    $('quickRow').querySelectorAll('button').forEach(b=>{
      b.onclick=()=>{
        const pot=G.pot+G.players.reduce((s,pl)=>s+pl.bet,0);
        let v;
        if(b.dataset.f==='min') v=minTo;
        else if(b.dataset.f==='half') v=G.currentBet+Math.round(pot/2);
        else if(b.dataset.f==='pot') v=G.currentBet+pot;
        else v=maxTo;
        v=Math.max(minTo,Math.min(maxTo,Math.round(v/G.sb)*G.sb));
        $('raiseSlider').value=v; $('raiseVal').textContent=money(v);
        raiseBtn.textContent=(v>=maxTo)?'All-In':'Raise to '+money(v);
      };
    });
  });
}
function finishHuman(act){
  act();
  $('actionBtns').style.display='none';
  $('raiseRow').style.display='none'; $('quickRow').style.display='none';
  setMsg('');
  const r=humanResolve; humanResolve=null; r();
}

/* ---- BOT AI (difficulty-aware) ---- */
function botAction(p,i){
  const d = DIFFICULTY[G.difficulty] || DIFFICULTY.medium;
  const toCall=G.currentBet-p.bet;
  const pot=G.pot+G.players.reduce((s,pl)=>s+pl.bet,0);
  // add per-difficulty noise so weaker levels misjudge hand strength (mistakes)
  let strength=evalStrength(p) + (Math.random()*2-1)*d.noise;
  strength=Math.max(0,Math.min(1,strength));
  const potOdds = toCall>0 ? toCall/(pot+toCall) : 0;
  const canRaise = p.chips>toCall;
  const bluffing = Math.random()<d.bluff && strength<0.42;   // occasional bluff

  // no bet to call: check or bet for value/bluff
  if(toCall===0){
    if((strength>d.betThresh || bluffing) && canRaise && Math.random()<0.75){
      const bet=G.currentBet + Math.round((0.4+strength*0.6)*pot);
      applyRaise(p,i,clampBet(p,bet));
    } else applyCall(p,i); // check
    return;
  }
  // facing a bet: fold weak hands (unless cheap or a "call station" at low difficulty)
  if(strength<d.foldBelow && !bluffing){
    if(toCall<=p.chips*0.05 || Math.random()<d.callStation) applyCall(p,i);
    else applyFold(p,i);
    return;
  }
  // strong hand or bluff: raise
  if((strength>d.raiseThresh || bluffing) && canRaise && Math.random()<0.8){
    const raiseTo=G.currentBet + Math.round((0.5+strength*0.7)*pot);
    applyRaise(p,i,clampBet(p,raiseTo));
    return;
  }
  // otherwise call when price is right
  if(strength>=potOdds || strength>0.42 || toCall<=p.chips*0.12 || Math.random()<d.callStation){
    applyCall(p,i);
  } else applyFold(p,i);
}
function clampBet(p,to){
  const minTo=G.currentBet+G.minRaise;
  return Math.max(minTo, Math.min(to, p.bet+p.chips));
}
/* hand strength heuristic 0..1 */
function evalStrength(p){
  const cc=G.community;
  if(cc.length===0){
    // preflop: Chen-like
    const [a,b]=p.cards.map(c=>c.r).sort((x,y)=>y-x);
    let score=0;
    const hi=a;
    score += hi===14?10:hi===13?8:hi===12?7:hi===11?6:hi/2;
    if(a===b) score=Math.max(score*2, 5);          // pair
    if(p.cards[0].s===p.cards[1].s) score+=2;       // suited
    const gap=a-b;
    if(gap===1) score+=1; else if(gap===2) score-=1; else if(gap===3) score-=2; else if(gap>=4 && a!==b) score-=4;
    return Math.max(0, Math.min(1, score/20));
  }
  // postflop: use made hand category + a little draw allowance
  const seven=[...p.cards,...cc];
  const best=bestOf7(seven);
  // normalize category 0..8 -> map
  const catScore=[0.12,0.30,0.45,0.58,0.68,0.76,0.86,0.95,1][best[0]];
  // high card fraction
  let s=catScore;
  if(best[0]===0){ s = 0.05 + (best[1]-2)/12*0.25; }        // high card weak
  if(best[0]===1){ s = 0.32 + (best[1]-2)/12*0.14; }        // pair scaled by pair rank
  return Math.max(0,Math.min(1,s));
}

/* ---- STAGE PROGRESSION ---- */
async function proceed(result){
  // collect bets into pot
  collectBets();
  renderBets(); renderPot(); renderChips();

  if(result==='earlywin' || G.players.filter(p=>!p.folded).length===1){
    return endHand();
  }
  // if only one player can still act (others all-in), deal out remaining board
  const canBet = G.players.filter(p=>!p.folded && !p.allIn).length;

  if(G.stage==='preflop'){ await dealBoard(3,'Flop'); G.stage='flop'; }
  else if(G.stage==='flop'){ await dealBoard(1,'Turn'); G.stage='turn'; }
  else if(G.stage==='turn'){ await dealBoard(1,'River'); G.stage='river'; }
  else if(G.stage==='river'){ return endHand(); }

  // reset bets for new round
  G.players.forEach(p=>p.bet=0); G.currentBet=0; G.minRaise=G.bb;
  renderBets();

  if(canBet<=1){
    // everyone (relevant) all-in: skip betting, continue dealing
    await sleep(700);
    return proceed('continue');
  }

  const first=firstActivePostflop();
  const res=await bettingRound(first);
  return proceed(res);
}
function firstActivePostflop(){
  let j=G.dealer;
  for(let k=0;k<5;k++){ j=nextActive(j); if(!G.players[j].folded && !G.players[j].allIn) return j; }
  return nextActive(G.dealer);
}
function collectBets(){ G.players.forEach(p=>{ G.pot+=p.bet; p.bet=0; }); }

async function dealBoard(n,label){
  $('stageTag').textContent=label;
  G.deck.pop(); // burn
  for(let k=0;k<n;k++){
    const card=G.deck.pop(); G.community.push(card);
    const div=document.createElement('div');
    div.innerHTML=cardHTML(card,true);
    const el=div.firstChild; el.classList.add('flip');
    $('board').appendChild(el);
    Sound.deal();
    await sleep(300);
  }
  updateHandInfo();
  await sleep(250);
}

/* minimal confetti burst raining onto the winner card(s) */
function launchConfetti(seats){
  const idxs = (seats && seats.length) ? seats : [0];
  let layer=document.querySelector('.confetti-layer');
  if(!layer){ layer=document.createElement('div'); layer.className='confetti-layer'; document.body.appendChild(layer); }
  const colors=['#d4af37','#f0d878','#c0392b','#2471a3','#1e8449','#ffffff'];
  idxs.forEach(si=>{
    const seatEl=$('seat'+si); if(!seatEl) return;
    const card=seatEl.querySelector('.player-card')||seatEl;
    const r=card.getBoundingClientRect();
    const N=22;
    for(let i=0;i<N;i++){
      const p=document.createElement('div'); p.className='confetti-pc';
      p.style.left=(r.left + Math.random()*r.width)+'px';
      p.style.top=(r.top - 20 - Math.random()*14)+'px';
      p.style.background=colors[i%colors.length];
      p.style.width=(5+Math.random()*4)+'px';
      p.style.height=(8+Math.random()*5)+'px';
      p.style.setProperty('--fall', (r.height + 26 + Math.random()*22)+'px');
      const dur=0.9+Math.random()*0.7, delay=Math.random()*0.3;
      p.style.animation=`confetti-drop ${dur}s cubic-bezier(.25,.6,.4,1) ${delay}s forwards`;
      layer.appendChild(p);
      setTimeout(()=>p.remove(), (dur+delay)*1000+150);
    }
  });
}

/* ---- SHOWDOWN / END ---- */
async function endHand(){
  setActive(-1);
  const contenders=G.players.map((p,i)=>({p,i})).filter(o=>!o.p.folded);
  // reveal
  if(contenders.length>1){
    $('stageTag').textContent='Showdown';
    contenders.forEach(o=>o.p.revealed=true);
    renderHands(true);
    await sleep(600);
  }
  // build pots (side pots)
  const pots=buildPots();
  let summary=[];
  const potTotal=G.pot;
  let humanWon=false;
  const winnerSeats=new Set();
  const resultRows=[];
  for(const pot of pots){
    const elig=pot.eligible.filter(i=>!G.players[i].folded);
    if(elig.length===0) continue;
    let best=null, winners=[];
    if(elig.length===1){
      winners=[elig[0]];
      best = G.community.length===5 ? bestOf7([...G.players[elig[0]].cards,...G.community]) : null;
    } else {
      for(const i of elig){
        const sc=bestOf7([...G.players[i].cards,...G.community]);
        if(!best||cmp(sc,best)>0){ best=sc; winners=[i]; }
        else if(cmp(sc,best)===0) winners.push(i);
      }
    }
    const share=Math.floor(pot.amt/winners.length);
    let rem=pot.amt-share*winners.length;
    winners.forEach((wi,idx)=>{ G.players[wi].chips+=share+(idx<rem?1:0); });
    const nm=winners.map(wi=>G.players[wi].name).join(' & ');
    const withStr = best ? ' with '+handName(best) : '';
    summary.push(`<b>${nm}</b> wins ${money(pot.amt)}${withStr}`);
    resultRows.push({names:nm, amt:pot.amt, hand: best?describeBest(best):null});
    winners.forEach(wi=>{ showAction(wi,'WIN +'+money(share),'win'); winnerSeats.add(wi); if(wi===0) humanWon=true; });
  }
  // Friendlier message when everyone else folded (pot already awarded above — do NOT re-award).
  if(contenders.length===1){
    summary=[`<b>${contenders[0].p.name}</b> wins ${money(potTotal)} (all others folded)`];
    resultRows.length=0;
    resultRows.push({names:contenders[0].p.name, amt:potTotal, hand:null, folded:true});
    winnerSeats.add(contenders[0].i);
    if(contenders[0].i===0) humanWon=true;
  }
  // crown the winning seat(s) and enlarge their card
  winnerSeats.forEach(i=>$('seat'+i).classList.add('winner'));
  G.pot=0;
  renderChips(); renderPot();
  setMsg(summary.join(' &nbsp;•&nbsp; '));
  // session stats
  G.stats.played++;
  if(humanWon){ G.stats.won++; Sound.win(); }
  if(potTotal>G.stats.biggestPot) G.stats.biggestPot=potTotal;
  launchConfetti([...winnerSeats]);
  updateStatsDisplay();
  updateHandInfo();
  G.handOver=true;
  $('btn-newhand').style.display='block';
  $('actionBtns').style.display='none';
  await sleep(700);            // let the crown/confetti register first
  showResultModal(resultRows);
}
function showResultModal(rows){
  const body = rows.map(r=>`
    <div class="result-row">
      <div class="result-win">🏆 ${r.names} wins <span class="amt">${money(r.amt)}</span></div>
      ${r.hand ? `<div class="result-hand">Hand: <b>${r.hand}</b></div>`
               : (r.folded ? `<div class="result-hand"><span class="muted">All others folded</span></div>` : '')}
    </div>`).join('');
  $('result-body').innerHTML = body;
  $('resultModal').classList.add('show');
}
function updateStatsDisplay(){
  if(!G || !G.stats) return;
  const s=G.stats;
  const wr = s.played? Math.round(s.won/s.played*100):0;
  const net = G.players[0].chips - START_CHIPS;
  const set=(id,v)=>{ const e=$(id); if(e) e.textContent=v; };
  set('st-played', s.played);
  set('st-won', s.won);
  set('st-winrate', wr+'%');
  set('st-biggest', money(s.biggestPot));
  set('st-net', (net>=0?'+':'')+money(net));
}
function totalPotAmount(){ return G.pot; }
function buildPots(){
  // use contributed amounts
  const contribs=G.players.map((p,i)=>({i, amt:p.contributed, folded:p.folded}));
  const pots=[];
  let remaining=contribs.filter(c=>c.amt>0);
  while(remaining.length>0){
    const min=Math.min(...remaining.map(c=>c.amt));
    let amt=0; const eligible=[];
    remaining.forEach(c=>{ amt+=min; c.amt-=min; if(!c.folded) eligible.push(c.i); });
    if(pots.length && sameSet(pots[pots.length-1].eligible,eligible)){
      pots[pots.length-1].amt+=amt;
    } else {
      pots.push({amt, eligible});
    }
    remaining=remaining.filter(c=>c.amt>0);
  }
  return pots;
}
function sameSet(a,b){ return a.length===b.length && a.every(x=>b.includes(x)); }

/* ============================================================
   LOGIN + WIRING
   ============================================================ */
/* ---------- FULLSCREEN (mobile) ---------- */
const isTouchDevice = matchMedia('(hover: none) and (pointer: coarse)').matches;
function isFullscreen(){ return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function enterFullscreen(){
  const el = document.documentElement;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  if(fn){ try{ Promise.resolve(fn.call(el)).then(lockLandscape).catch(()=>{}); }catch(e){} }
}
function exitFullscreen(){
  const fn = document.exitFullscreen || document.webkitExitFullscreen;
  if(isFullscreen() && fn){ try{ fn.call(document); }catch(e){} }
}
function toggleFullscreen(){ isFullscreen() ? exitFullscreen() : enterFullscreen(); }
function lockLandscape(){
  try{ if(screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(()=>{}); }catch(e){}
}
const ICON_FS_ENTER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const ICON_FS_EXIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';
function updateFsIcon(){
  const b = $('btn-fullscreen'); if(!b) return;
  const fs = isFullscreen();
  b.querySelector('.mi-icon').innerHTML = fs ? ICON_FS_EXIT : ICON_FS_ENTER;
  b.querySelector('.mi-label').textContent = fs ? 'Exit fullscreen' : 'Enter fullscreen';
}
document.addEventListener('fullscreenchange', updateFsIcon);
document.addEventListener('webkitfullscreenchange', updateFsIcon);
$('btn-fullscreen').onclick = ()=>{ closeMenu(); toggleFullscreen(); };

/* ---------- HEADER MENU (⋮) ---------- */
const appMenu = $('appMenu'), btnMenu = $('btn-menu');
function closeMenu(){ appMenu.classList.remove('open'); btnMenu.setAttribute('aria-expanded','false'); }
function toggleMenu(){ const open = appMenu.classList.toggle('open'); btnMenu.setAttribute('aria-expanded', open?'true':'false'); }
btnMenu.onclick = e => { e.stopPropagation(); toggleMenu(); };
document.addEventListener('click', e => {
  if(appMenu.classList.contains('open') && !appMenu.contains(e.target) && !btnMenu.contains(e.target)) closeMenu();
});

function doLogin(name){
  user.name=name||'Player';
  $('uname').textContent=user.name;
  $('ua').textContent=(user.name[0]||'P').toUpperCase();
  $('login').style.display='none';
  $('game').style.display='flex';
  if(isTouchDevice) enterFullscreen();
  initGame();
  updateStatsDisplay();
  setMsg('Welcome, <b>'+user.name+'</b>! ('+DIFFICULTY[difficulty].label+') Click “Deal New Hand” to start.');
  $('btn-newhand').style.display='block';
  $('actionBtns').style.display='none';
}
// difficulty selection on the name screen
document.querySelectorAll('.diff-opt').forEach(b=>{
  b.onclick=()=>{
    document.querySelectorAll('.diff-opt').forEach(x=>x.classList.remove('sel'));
    b.classList.add('sel');
    difficulty=b.dataset.diff;
  };
});
$('btn-signin').onclick=()=>{
  const n=$('in-name').value.trim();
  if(!n){ $('in-name').focus(); $('in-name').style.borderColor='#EA4335'; return; }
  Sound.resume();
  doLogin(n);
};
$('in-name').addEventListener('keydown',e=>{ if(e.key==='Enter') $('btn-signin').click(); });
$('btn-logout').onclick=()=>{ $('confirm').classList.add('show'); };
$('cf-cancel').onclick=()=>{ $('confirm').classList.remove('show'); };
$('cf-ok').onclick=()=>{ location.reload(); };
$('confirm').addEventListener('click',e=>{ if(e.target===$('confirm')) $('confirm').classList.remove('show'); });
$('btn-newhand').onclick=()=>{ Sound.resume(); if(G && G.handOver){ startHand(); } };

// sound toggle (swaps between speaker-on and muted white vector icons)
const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a9 9 0 0 1 0 14"/></svg>';
const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
$('btn-sound').onclick=()=>{ const on=Sound.set(); $('btn-sound').querySelector('.mi-icon').innerHTML = on?ICON_SOUND_ON:ICON_SOUND_OFF; $('btn-sound').querySelector('.mi-label').textContent = on?'Sound on':'Sound off'; if(on) Sound.resume(); };
// How to Play modal
$('btn-help').onclick=()=>{ closeMenu(); $('howto').classList.add('show'); };
$('help-close').onclick=()=>$('howto').classList.remove('show');
$('howto').addEventListener('click',e=>{ if(e.target===$('howto')) $('howto').classList.remove('show'); });
// Stats modal
$('btn-stats').onclick=()=>{ closeMenu(); updateStatsDisplay(); $('statsModal').classList.add('show'); };
$('stats-close').onclick=()=>$('statsModal').classList.remove('show');
$('statsModal').addEventListener('click',e=>{ if(e.target===$('statsModal')) $('statsModal').classList.remove('show'); });
// Hand result modal
$('result-ok').onclick=()=>$('resultModal').classList.remove('show');
$('resultModal').addEventListener('click',e=>{ if(e.target===$('resultModal')) $('resultModal').classList.remove('show'); });
// Esc closes any open modal
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ closeMenu(); document.querySelectorAll('.modal-overlay.show').forEach(m=>m.classList.remove('show')); }
});