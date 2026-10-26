(()=>{'use strict';
/* v3 top bar: routes through the existing navigation buttons so every page keeps its loaders. */
const go=page=>{
 const target=page==='game'?document.querySelector('#homePage [data-home-go="game"]'):document.querySelector('#sideNav [data-go="'+page+'"]');
 if(target)target.click();window.scrollTo({top:0,behavior:'instant'});
};
document.querySelectorAll('[data-gx-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.gxGo)));
document.querySelector('.gx-menu')?.addEventListener('click',()=>document.getElementById('menuToggle')?.click());
const mark=()=>{const page=document.body.dataset.page;document.querySelectorAll('.gx-bar [data-gx-go]').forEach(b=>{const on=b.dataset.gxGo===page;b.classList.toggle('on',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')})};
new MutationObserver(mark).observe(document.body,{attributes:true,attributeFilter:['data-page']});mark();

/* Game: the big "table is open" headline shows on the start screens only; once in a room the table takes the page. */
const frame=document.getElementById('gameBetaFrame'),gamePage=document.getElementById('gamePage');
const syncTable=()=>{try{const d=frame.contentDocument;const start=!d||!d.getElementById('entry')||d.querySelector('#entry:not(.hidden),#join:not(.hidden)');gamePage.classList.toggle('gx-playing',!start)}catch(e){}};
if(frame&&gamePage){window.addEventListener('message',e=>{if(e.source===frame.contentWindow)syncTable()});frame.addEventListener('load',syncTable)}

/* Home: latest approved cards, read-only, same public query The Deck uses. */
const ROOT='https://chfzvfyigycpkcsxbscu.supabase.co/rest/v1',KEY='sb_publishable_0zmkCJDMk_qAex_bnopfsA_CQP21oxN';
const host=document.getElementById('gxDeck');if(!host)return;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
/* Newest = most recently approved by Billy; falls back to creation date if approval time can't be read. */
const cardQuery=order=>fetch(ROOT+'/glep_cards?select=id,name,card_type,card_data,artwork_url,creator_name,created_at&review_status=eq.approved&order='+order+'&limit=10',{headers:{apikey:KEY,Prefer:'count=exact'}}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);total=+((r.headers.get('content-range')||'').split('/')[1])||0;return r.json()});
let total=0;
cardQuery('reviewed_at.desc.nullslast,created_at.desc').catch(()=>cardQuery('created_at.desc'))
 .then(rows=>{
  host.replaceChildren();document.getElementById('gxDeckCount').textContent='/ '+String(Math.max(total,rows.length)).padStart(2,'0');
  if(!rows.length){host.append(el('div','gx-empty','Nothing approved yet. Billy is being picky.'));return}
  const fresh=Date.now()-7*864e5;
  rows.slice(0,5).forEach((row,i)=>{
   const c=row.card_data||{},type=row.card_type||'attack';
   const card=el('button','gx-card t-'+type);card.type='button';card.setAttribute('aria-label','Open '+row.name+' in The Deck');
   if(new Date(row.created_at).getTime()>fresh)card.append(el('span','tag','NEW'));
   const art=el('div','art');if(row.artwork_url){const img=el('img');img.src=row.artwork_url;img.alt='';img.loading='lazy';art.append(img)}card.append(art);
   const body=el('div','body'),meta=el('div','gx-type gx-mono');meta.append(el('b',null,type),el('span',null,'#'+String(Math.max(total,rows.length)-i).padStart(3,'0')));
   const stats=el('div','stats'),dmg=el('span');dmg.append(el('em',null,'DMG'),String(c.damage??0));stats.append(dmg);
   if(type!=='fate'){const st=el('span');st.append(el('em',null,'★'),String(c.stars??0));stats.append(st)}
   body.append(meta,el('h3',null,row.name),el('p','by','by '+(row.creator_name||'someone')),stats);card.append(body);
   card.onclick=()=>go('shared');host.append(card);
  });
  const t=document.getElementById('gxTicker');
  if(t){const items=rows.slice(0,3).map(r=>'✶ '+r.name+' by '+(r.creator_name||'someone')+' is in the deck').concat(['✶ Next game night: bring gems','✶ Ten stars gets you a Fate card']);t.replaceChildren();for(const s of items.concat(items))t.append(el('b',null,s))}
 })
 .catch(()=>{host.replaceChildren(el('div','gx-empty','The deck is out of reach right now. Try The Deck page in a moment.'))});
})();
