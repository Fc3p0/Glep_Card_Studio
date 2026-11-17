// Card Master → Catalog: a spreadsheet of every card. Approved Deck cards appear on their own (their name, type,
// damage, stars, elements, effect and Status "In Deck" show live from the card and are edited in Manage Deck); idea lines and
// printed-only cards are typed straight in. Anyone with the Card Master code can add, rename and hide columns and
// edit cells (any column can be moved or renamed; custom ones removed); a 👁 button previews the card; every cell saves on its own as soon as you leave it. The last column (Code to deploy) is read-only on
// the site: only Claude fills it, through SQL Francesca runs.
// Storage: Supabase tables glep_catalog_rows / glep_catalog_settings, reached only through the glep_catalog_*
// functions in backend/glep-catalog.sql (each checks the admin code). Reads the cards Card Master already loaded,
// so the existing Card Master views and loading are untouched.
(()=>{'use strict';
const RPC='https://chfzvfyigycpkcsxbscu.supabase.co/rest/v1/rpc/',KEY='sb_publishable_0zmkCJDMk_qAex_bnopfsA_CQP21oxN';
const $=id=>document.getElementById(id);
const LIVE={name:1,type:1,damage:1,stars:1,elements:1,effect:1,status:1};   // shown from the Deck card when a line is linked
const LONG={effect:1,art:1};                                              // wider columns
const STATUS=['Ideas','In Deck'];
const TYPE_ORDER={attack:0,modifier:1,fate:2};
const SUGGEST={type:['attack','modifier','fate'],elements:['Earth','Water','Fire','Air']};
let columns=[],rows=[],loaded=false,busy=false,sortKey='',sortDir=1;

function make(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
function say(t,bad){const s=$('catalogStatus');s.textContent=t;s.dataset.result=bad?'error':''}
const pass=()=>window.glepMaster?.pass()||'';
async function rpc(fn,args){
 const r=await fetch(RPC+fn,{method:'POST',cache:'no-store',headers:{apikey:KEY,'Content-Type':'application/json'},body:JSON.stringify({p_code:pass(),...args})});
 const x=await r.json().catch(()=>null);
 if(!r.ok){const m=x?.message||('HTTP '+r.status);const e=Error(/could not find the function|PGRST202/i.test(m+(x?.code||''))?'SETUP':m);throw e}
 return x}

async function load(){
 if(busy||!pass())return;busy=true;say('Loading catalog…');
 try{const data=await rpc('glep_catalog_load',{});columns=Array.isArray(data.columns)?data.columns:[];rows=data.rows||[];loaded=true;draw();
 }catch(e){loaded=false;$('catalogTable').replaceChildren();
  if(e.message==='SETUP')say('The catalog needs a one-time setup: paste backend/glep-catalog.sql into the Supabase SQL Editor and press Run, then come back and tap Reload.',true);
  else say('Catalog could not load: '+e.message,true)}
 finally{busy=false}}

function deckCards(){return (window.glepMaster?.cards()||[]).filter(c=>c.review_status==='approved')}
function lines(){
 const cards=deckCards(),byCard=new Map(rows.filter(r=>r.card_id).map(r=>[r.card_id,r])),seen=new Set(),out=[];
 for(const c of cards){out.push({card:c,row:byCard.get(c.id)||null});seen.add(c.id)}
 for(const r of rows)if(!r.card_id||!seen.has(r.card_id))out.push({card:null,row:r,gone:!!r.card_id});
 return out}
function value(line,key){
 const c=line.card;
 if(c&&LIVE[key]){const d=c.card_data||{};
  if(key==='name')return c.name||'';if(key==='type')return c.card_type||'';if(key==='status')return 'In Deck';
  if(key==='elements')return [d.element1,d.element2].filter(v=>v&&v!=='None').join(', ');
  if(key==='stars'&&c.card_type==='fate')return '';
  return d[key]==null?'':String(d[key])}
 const v=line.row?.data?.[key];return v==null?'':String(v)}

function visible(){
 const q=($('catalogSearch').value||'').trim().toLowerCase(),t=$('catalogType').value,w=$('catalogWhere').value;
 let list=lines().filter(l=>{
  if(w==='deck'&&!l.card)return false;if(w==='other'&&l.card)return false;
  const ty=value(l,'type').toLowerCase();if(t==='none'?TYPE_ORDER[ty]!=null:t&&ty!==t)return false;
  if(q&&!columns.some(c=>value(l,c.key).toLowerCase().includes(q)))return false;return true});
 const cmp=(a,b)=>{if(!sortKey){return (TYPE_ORDER[value(a,'type').toLowerCase()]??9)-(TYPE_ORDER[value(b,'type').toLowerCase()]??9)||value(a,'name').localeCompare(value(b,'name'),undefined,{sensitivity:'base'})}
  const x=value(a,sortKey),y=value(b,sortKey);if(x===''&&y!=='')return 1;if(y===''&&x!=='')return -1;
  const nx=Number(x),ny=Number(y);return sortDir*(x!==''&&y!==''&&!isNaN(nx)&&!isNaN(ny)?nx-ny:x.localeCompare(y,undefined,{sensitivity:'base',numeric:true}))};
 return list.sort(cmp)}

function fit(t){t.style.height='auto';t.style.height=Math.min(t.scrollHeight+2,180)+'px'}
function draw(){
 const host=$('catalogTable'),list=visible(),table=make('table','catalog-grid'),head=make('tr');
 const stick=columns[0]?.key==='name';head.append(make('th','catalog-rownum','#'));
 for(const col of columns){const th=make('th',LONG[col.key]||col.locked?'catalog-long':'');if(stick&&col.key==='name')th.classList.add('catalog-sticky');
  const b=make('button','catalog-sort',col.label+(sortKey===col.key?(sortDir>0?' ▲':' ▼'):''));b.type='button';b.title='Sort by '+col.label;
  b.onclick=()=>{if(sortKey===col.key){if(sortDir>0)sortDir=-1;else sortKey=''}else{sortKey=col.key;sortDir=1}draw()};th.append(b);
  if(!col.locked){const btn=(t,title,fn)=>{const x=make('button','catalog-col-btn',t);x.type='button';x.title=title;x.setAttribute('aria-label',title+': '+col.label);x.onclick=fn;th.append(x)};
   const ci=columns.indexOf(col);if(ci>0)btn('◀','Move column left',()=>moveColumn(col,-1));if(columns[ci+1]&&!columns[ci+1].locked)btn('▶','Move column right',()=>moveColumn(col,1));btn('✎','Rename column',()=>renameColumn(col));
   if(!col.builtin)btn('×','Remove column',()=>removeColumn(col))}
  head.append(th)}
 const thead=make('thead');thead.append(head);const body=make('tbody');
 list.forEach((line,i)=>{const tr=make('tr');if(!line.card)tr.className='catalog-idea';
  const num=make('td','catalog-rownum',String(i+1));
  const eye=make('button','catalog-eye','👁');eye.type='button';eye.title='Preview card';eye.setAttribute('aria-label','Preview '+(value(line,'name')||'card'));eye.onclick=()=>preview(line);num.append(eye);
  if(!line.card&&line.row&&!line.gone){const del=make('button','catalog-del','×');del.type='button';del.title='Delete this line';del.onclick=()=>deleteLine(line);num.append(del)}
  tr.append(num);
  for(const col of columns){const td=make('td',LONG[col.key]||col.locked?'catalog-long':'');if(stick&&col.key==='name')td.classList.add('catalog-sticky');
   const v=value(line,col.key);
   if(col.locked){td.classList.add('catalog-live','catalog-code');td.textContent=v;td.title='Only Fran fills this in: the code this behavior needs deployed.'}
   else if(line.card&&LIVE[col.key]){td.classList.add('catalog-live');td.textContent=v;td.title='From the Deck card. Edit it in Manage Deck.'}
   else if(col.key==='status'){const t=make('select');for(const x of STATUS){const o=make('option','',x);o.value=x;t.append(o)}t.value=STATUS.includes(v)?v:'Ideas';
    t.setAttribute('aria-label','Status for '+(value(line,'name')||'new line'));t.addEventListener('change',()=>saveCell(line,col,t));td.append(t)}
   else{const t=make('textarea');t.rows=1;t.value=v;t.setAttribute('aria-label',col.label+' for '+(value(line,'name')||'new line'));
    if(SUGGEST[col.key])t.setAttribute('list','catalogList-'+col.key);
    t.addEventListener('input',()=>fit(t));t.addEventListener('focus',()=>fit(t));
    t.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();t.blur()}if(e.key==='Escape'){t.value=v;t.blur()}});
    t.addEventListener('change',()=>saveCell(line,col,t));td.append(t)}
   tr.append(td)}
  body.append(tr)});
 table.append(thead,body);
 const lists=Object.entries(SUGGEST).map(([k,vals])=>{const d=make('datalist');d.id='catalogList-'+k;for(const x of vals){const o=make('option');o.value=x;d.append(o)}return d});
 host.replaceChildren(table,...lists);
 requestAnimationFrame(()=>{const ts=[...host.querySelectorAll('textarea')].filter(t=>t.value);const hs=ts.map(t=>t.scrollHeight);ts.forEach((t,i)=>{if(hs[i]>t.clientHeight+1)t.style.height=Math.min(hs[i]+2,180)+'px'})});
 const all=lines(),inDeck=all.filter(l=>l.card).length;
 say(list.length+' of '+all.length+' lines shown · '+inDeck+' in the Deck · '+(all.length-inDeck)+' ideas. Cells save when you click away.')}

async function saveCell(line,col,t){
 const val=t.value.slice(0,5000);t.classList.remove('catalog-err');t.classList.add('catalog-saving');
 try{const saved=await rpc('glep_catalog_set_cell',{p_row_id:line.row?.id||null,p_card_id:line.row?null:line.card?.id||null,p_key:col.key,p_value:val});
  if(line.row){Object.assign(line.row,saved);const i=rows.findIndex(r=>r.id===saved.id);if(i>=0)rows[i]=line.row}else{line.row=saved;rows.push(saved)}
  t.classList.remove('catalog-saving');t.classList.add('catalog-saved');setTimeout(()=>t.classList.remove('catalog-saved'),900);say('Saved '+col.label+' for '+(value(line,'name')||'the new line')+'.')
 }catch(e){t.classList.remove('catalog-saving');t.classList.add('catalog-err');say('Not saved: '+(e.message==='SETUP'?'the catalog setup SQL has not been run yet.':e.message),true)}}

async function addLine(){
 const name=(prompt('Name of the new card idea:')||'').trim();if(!name)return;
 try{const saved=await rpc('glep_catalog_set_cell',{p_row_id:null,p_card_id:null,p_key:'name',p_value:name.slice(0,200)});
  await rpc('glep_catalog_set_cell',{p_row_id:saved.id,p_card_id:null,p_key:'status',p_value:'Ideas'}).then(s=>rows.push(s)).catch(()=>rows.push(saved));
  $('catalogSearch').value='';$('catalogWhere').value='';$('catalogType').value='';draw();say('Added "'+name+'". Fill in the rest of its line.');
  const row=[...$('catalogTable').querySelectorAll('textarea')].find(t=>t.value===name);row?.scrollIntoView({block:'center'});row?.focus()
 }catch(e){say('Could not add the line: '+(e.message==='SETUP'?'run the catalog setup SQL first.':e.message),true)}}

async function deleteLine(line){
 if(!confirm('Delete the line "'+(value(line,'name')||'(no name)')+'" from the catalog? This cannot be undone.'))return;
 try{await rpc('glep_catalog_delete_row',{p_row_id:line.row.id});rows=rows.filter(r=>r.id!==line.row.id);draw()}catch(e){say('Could not delete: '+e.message,true)}}

// Column changes start from the latest saved list, so two people adding columns don't undo each other.
async function changeColumns(fn,done){
 try{const latest=await rpc('glep_catalog_load',{});rows=latest.rows||rows;const next=fn((latest.columns||columns).map(c=>({...c})));if(!next)return;
  columns=await rpc('glep_catalog_save_columns',{p_columns:next});draw();say(done)}catch(e){say('Column change not saved: '+e.message,true)}}
function addColumn(){
 const label=(prompt('Name of the new column (for example Behavior, Rules, Artist):')||'').trim().slice(0,60);if(!label)return;
 const key='c_'+(label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,24)||'col')+'_'+Math.random().toString(36).slice(2,6);
 changeColumns(cols=>{const i=cols.findIndex(c=>c.locked);if(i<0)return cols.concat({key,label});cols.splice(i,0,{key,label});return cols},'Added the column "'+label+'".')}
function renameColumn(col){
 const label=(prompt('New name for "'+col.label+'":',col.label)||'').trim().slice(0,60);if(!label||label===col.label)return;
 changeColumns(cols=>cols.map(c=>c.key===col.key?{...c,label}:c),'Renamed to "'+label+'".')}
function moveColumn(col,dir){
 changeColumns(cols=>{const i=cols.findIndex(c=>c.key===col.key),j=i+dir;if(i<0||j<0||j>=cols.length||cols[j].locked)return null;[cols[i],cols[j]]=[cols[j],cols[i]];return cols},'Moved "'+col.label+'".')}
// Preview: draws just this one card on click (same renderer as the Deck). Ideas preview from what's typed in their line.
let previewURL='';
async function preview(line){
 const box=$('catalogPreview'),img=$('catalogPreviewImg');if(previewURL){URL.revokeObjectURL(previewURL);previewURL=''}
 img.removeAttribute('src');img.alt='Preview: '+(value(line,'name')||'card');$('catalogPreviewName').textContent=value(line,'name')||'(no name)';box.hidden=false;$('catalogPreviewClose').focus();
 const c=line.card;let card;
 if(c)card={...(c.card_data||{}),name:c.name,type:c.card_type,image:c.artwork_url||'',strokes:[]};
 else{const el=value(line,'elements').split(/[,/]+/).map(x=>x.trim()).map(x=>x.charAt(0).toUpperCase()+x.slice(1).toLowerCase()).filter(x=>['Earth','Water','Fire','Air'].includes(x)),t=value(line,'type').toLowerCase(),n=k=>{const x=parseInt(value(line,k),10);return isNaN(x)?0:Math.max(-10,Math.min(10,x))};
  card={name:value(line,'name')||'Untitled',type:TYPE_ORDER[t]!=null?t:'attack',damage:n('damage'),stars:n('stars'),element1:el[0]||'None',element2:el[1]||'None',effect:value(line,'effect'),tags:'',image:'',strokes:[]}}
 try{const draw=window.glepRenderCardURL||window.glepRenderCard;if(!draw){if(c?.artwork_url)img.src=c.artwork_url;return}const u=await draw(card);if(box.hidden||$('catalogPreviewName').textContent!==(value(line,'name')||'(no name)')){if(u.startsWith('blob:'))URL.revokeObjectURL(u);return}if(u.startsWith('blob:'))previewURL=u;img.src=u}
 catch(e){if(c?.artwork_url)img.src=c.artwork_url;else say('Preview failed: '+e.message,true)}}
function closePreview(){$('catalogPreview').hidden=true;if(previewURL){URL.revokeObjectURL(previewURL);previewURL=''}}
function removeColumn(col){
 if(!confirm('Remove the column "'+col.label+'"? It disappears for everyone. What was typed in it is kept in Supabase, so it can be brought back.'))return;
 changeColumns(cols=>cols.filter(c=>c.key!==col.key),'Removed the column "'+col.label+'".')}

function csv(){
 const cell=v=>/[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v,list=visible();
 const text=[columns.map(c=>cell(c.label)).join(',')].concat(list.map(l=>columns.map(c=>cell(value(l,c.key))).join(','))).join('\r\n');
 const a=make('a');a.href=URL.createObjectURL(new Blob(['﻿'+text],{type:'text/csv;charset=utf-8'}));a.download='glep-card-catalog-'+new Date().toISOString().slice(0,10)+'.csv';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),4000)}

const panelOpen=()=>!$('catalogPanel').hidden;
document.querySelector('[data-master-tab="catalog"]')?.addEventListener('click',()=>{if(!loaded)load();else draw()});
window.addEventListener('glep-master-refreshed',()=>{if(panelOpen())load()});
$('catalogReload').onclick=load;$('catalogPreviewClose').onclick=closePreview;$('catalogPreview').addEventListener('click',e=>{if(e.target.id==='catalogPreview')closePreview()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('catalogPreview').hidden)closePreview()});$('catalogAddLine').onclick=addLine;$('catalogAddColumn').onclick=addColumn;$('catalogCsv').onclick=csv;
for(const id of ['catalogType','catalogWhere'])$(id).addEventListener('change',()=>loaded&&draw());
let typing;$('catalogSearch').addEventListener('input',()=>{clearTimeout(typing);typing=setTimeout(()=>loaded&&draw(),200)});
$('masterLock')?.addEventListener('click',()=>{columns=[];rows=[];loaded=false;$('catalogTable').replaceChildren();say('')});
})();
