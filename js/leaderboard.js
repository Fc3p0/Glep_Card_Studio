// Scoreboard: "Add these results to the scoreboard" on the Scorekeeper page, and the Leaderboard page.
// Results live in the Supabase table public.glep_scoreboard (backend/glep-scoreboard.sql), so everyone sees them.
(()=>{'use strict';
const ROOT='https://chfzvfyigycpkcsxbscu.supabase.co/rest/v1/glep_scoreboard',KEY='sb_publishable_0zmkCJDMk_qAex_bnopfsA_CQP21oxN';
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el};
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const prettyDate=iso=>{const [y,m,d]=iso.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})};
const cards=n=>n+' card'+(n===1?'':'s');
const notReady=status=>status===404||status===400; // table not created yet

async function saveResult(winner,margin,played_on){
  const r=await fetch(ROOT,{method:'POST',headers:{apikey:KEY,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({winner,margin,played_on})});
  if(!r.ok)throw Error(notReady(r.status)?'The scoreboard isn\u2019t switched on yet (the Supabase table is missing).':'Could not save (HTTP '+r.status+'). Try again.');
  cache=null;
}
function checkEntry(winner,margin,played_on){
  if(!winner)return 'Who won?';
  if(!Number.isFinite(margin)||margin<0||margin>999)return '"Won by" needs a number of cards (0\u2013999).';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(played_on))return 'Pick a date.';
  return '';
}
function readGame(){try{const g=JSON.parse(localStorage.getItem('glep-scorekeeper-v1')||'null');return g&&Array.isArray(g.players)?g:null}catch(e){return null}}

// ---------- Scorekeeper: log a result ----------
const form=$('scoreLogForm'),openBtn=$('scoreLogOpen'),status=$('scoreLogStatus');
function openForm(){
  const game=readGame(),players=(game?.players||[]).filter(p=>p&&p.name);
  const sorted=[...players].sort((a,b)=>b.gems-a.gems);
  const pick=$('scoreLogWinner');pick.replaceChildren();
  for(const p of players)pick.append(new Option(p.name,p.name,false,p===sorted[0]));
  pick.append(new Option('Someone else\u2026','__other'));
  $('scoreLogOther').hidden=players.length>0;$('scoreLogOther').value='';
  if(!players.length)pick.value='__other';
  const gap=sorted.length>1?sorted[0].gems-sorted[1].gems:'';
  $('scoreLogMargin').value=gap>0?String(gap):'';
  $('scoreLogDate').value=today();$('scoreLogDate').max=today();
  status.textContent='';status.dataset.result='';
  form.hidden=false;openBtn.hidden=true;$('scoreLogMargin').focus();
}
function closeForm(){form.hidden=true;openBtn.hidden=false}
openBtn.onclick=openForm;$('scoreLogCancel').onclick=closeForm;
$('scoreLogWinner').addEventListener('change',e=>{const other=e.target.value==='__other';$('scoreLogOther').hidden=!other;if(other)$('scoreLogOther').focus()});
form.addEventListener('submit',async e=>{
  e.preventDefault();
  const pick=$('scoreLogWinner').value,winner=(pick==='__other'?$('scoreLogOther').value:pick).trim().slice(0,36);
  const margin=Math.floor(Number($('scoreLogMargin').value));const played_on=$('scoreLogDate').value;
  const bad=checkEntry(winner,margin,played_on);if(bad){status.textContent=bad;status.dataset.result='error';return}
  const save=$('scoreLogSave');save.disabled=true;save.textContent='Saving\u2026';status.textContent='';status.dataset.result='';
  try{
    await saveResult(winner,margin,played_on);
    closeForm();status.dataset.result='success';status.textContent='\u2713 Added: '+winner+' won by '+cards(margin)+' on '+prettyDate(played_on)+'.';
  }catch(err){status.dataset.result='error';status.textContent=err.message||'Could not save. Check your connection and try again.'}
  finally{save.disabled=false;save.textContent='Add to scoreboard'}
});
$('scoreLogView').onclick=()=>{document.querySelector('#sideNav [data-go="leaderboard"]').click();window.scrollTo({top:0,behavior:'instant'})};

// ---------- Leaderboard page ----------
let cache=null,loading=null;
// Shown only until the Supabase table exists; the SQL seeds these same two games.
const STARTER=[{id:'s2',winner:'Francesca',margin:25,played_on:'2026-11-09',created_at:'2026-11-10T03:36:00Z'},{id:'s1',winner:'Kim Mom OG',margin:20,played_on:'2026-11-09',created_at:'2026-11-09T20:00:00Z'}];
async function load(){
  const r=await fetch(ROOT+'?select=id,winner,margin,played_on,created_at&order=played_on.desc,created_at.desc&limit=1000',{headers:{apikey:KEY}});
  if(!r.ok){const e=Error(notReady(r.status)?'not-ready':'HTTP '+r.status);throw e}
  return r.json();
}
function standings(rows){
  const by=new Map();
  for(const g of rows){const k=g.winner.trim().toLowerCase();const s=by.get(k)||{name:g.winner.trim(),wins:0,total:0,best:0,last:g.played_on};s.wins++;s.total+=g.margin;s.best=Math.max(s.best,g.margin);if(g.played_on>s.last)s.last=g.played_on;by.set(k,s)}
  return [...by.values()].sort((a,b)=>b.wins-a.wins||b.total-a.total||a.name.localeCompare(b.name));
}
function render(rows){
  const board=$('leaderBoard'),log=$('leaderLog'),msg=$('leaderStatus');board.replaceChildren();log.replaceChildren();msg.textContent='';
  if(!rows.length){msg.textContent='No games logged yet. Finish a game in the Scorekeeper and add the results.';return}
  const list=standings(rows);let rank=0,prev=null;
  list.forEach((s,i)=>{if(!prev||prev.wins!==s.wins||prev.total!==s.total)rank=i+1;prev=s;
    const row=make('li','leader-row'+(rank===1?' top':''));
    row.append(make('span','leader-rank',String(rank)));
    const who=make('div','leader-who');who.append(make('strong',null,s.name),make('small',null,'Biggest win: '+cards(s.best)+' \xb7 Last win: '+prettyDate(s.last)));row.append(who);
    const wins=make('div','leader-stat');wins.append(make('b',null,String(s.wins)),make('small',null,s.wins===1?'win':'wins'));
    const tot=make('div','leader-stat');tot.append(make('b',null,String(s.total)),make('small',null,'cards won by'));
    row.append(wins,tot);board.append(row)});
  for(const g of rows){const li=make('li','leader-game');li.append(make('span','leader-date',prettyDate(g.played_on)));const t=make('span',null);t.append(make('strong',null,g.winner),document.createTextNode(' won by '+cards(g.margin)));li.append(t);log.append(li)}
}
async function open(){
  const msg=$('leaderStatus');
  if(cache){render(cache)}else{$('leaderBoard').replaceChildren();$('leaderLog').replaceChildren();msg.textContent='Loading scoreboard\u2026'}
  if(loading)return;
  loading=load().then(rows=>{cache=rows;render(rows)}).catch(err=>{if(cache)return;if(err.message==='not-ready'){render(STARTER);msg.textContent='Showing the first two games. New games will save once the scoreboard table is switched on in Supabase.'}else msg.textContent='Could not load the scoreboard. Check your connection and refresh.'}).finally(()=>{loading=null});
}
window.addEventListener('glep-leaderboard-open',open);
const lf=$('leaderAddForm'),ls=$('leaderAddStatus');
$('leaderAdd').onclick=()=>{lf.hidden=false;$('leaderAdd').hidden=true;$('leaderAddDate').value=today();$('leaderAddDate').max=today();ls.textContent='';ls.dataset.result='';
  const names=$('leaderNames');names.replaceChildren();for(const s of standings(cache||STARTER))names.append(new Option(s.name));$('leaderAddWinner').focus()};
$('leaderAddCancel').onclick=()=>{lf.hidden=true;$('leaderAdd').hidden=false};
lf.addEventListener('submit',async e=>{e.preventDefault();
  const winner=$('leaderAddWinner').value.trim().slice(0,36),margin=Math.floor(Number($('leaderAddMargin').value)),played_on=$('leaderAddDate').value;
  const bad=checkEntry(winner,margin,played_on);if(bad){ls.textContent=bad;ls.dataset.result='error';return}
  const b=$('leaderAddSave');b.disabled=true;b.textContent='Saving\u2026';
  try{await saveResult(winner,margin,played_on);lf.reset();lf.hidden=true;$('leaderAdd').hidden=false;ls.dataset.result='success';ls.textContent='\u2713 Added: '+winner+' won by '+cards(margin)+' on '+prettyDate(played_on)+'.';open()}
  catch(err){ls.dataset.result='error';ls.textContent=err.message||'Could not save. Check your connection and try again.'}
  finally{b.disabled=false;b.textContent='Add to leaderboard'}});
$('leaderRefresh').onclick=()=>{cache=null;open()};
$('leaderToScore').onclick=()=>{document.querySelector('#sideNav [data-go="score"]').click();window.scrollTo({top:0,behavior:'instant'})};
if(document.body.dataset.page==='leaderboard')open();
})();
