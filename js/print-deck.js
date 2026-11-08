// Print PDFs, made in the browser. Cards print at real size, 2.5 × 3.5 in (63.5 × 88.9 mm), nine to a page in a
// 3 × 3 grid centred on Letter or A4, butted together so every cut line is one straight cut.
//  • The Deck → "Download print PDF": the cards the Deck's search and filters show.
//  • Card Master → Printing: fronts (full deck or one type, each type starting on a new page), 3 × 3 back sheets per
//    type, and a two-sided alignment test. Back sheets use exactly the same grid as the fronts, moved by the printer
//    nudge Billy reads off the alignment test, so fronts and backs line up.
// Card backs come from assets/backs/{attack,modifier,fate}.png (any 5:7 image); until those exist a plain
// placeholder is printed. Fetches cards itself so the Deck grid's own loading is left alone.
(()=>{'use strict';
const ROOT='https://chfzvfyigycpkcsxbscu.supabase.co/rest/v1',KEY='sb_publishable_0zmkCJDMk_qAex_bnopfsA_CQP21oxN';
const el=id=>document.getElementById(id);
const PAPER={letter:[612,792],a4:[595.28,841.89]};      // PDF points, 72 per inch
const CW=180,CH=252,COLS=3,ROWS=3,PER=COLS*ROWS,MM=72/25.4;
const TYPES=['attack','modifier','fate'],LABEL={attack:'Attack',modifier:'Modifier',fate:'Fate'};
const TYPE_ORDER={attack:0,modifier:1,fate:2};
const BACKS={attack:'assets/backs/attack.png',modifier:'assets/backs/modifier.png',fate:'assets/backs/fate.png'};
const PLACEHOLDER={attack:'#ed9caf',modifier:'#acd4a5',fate:'#f1d46f'};
const f=n=>(+n.toFixed(2)).toString();
const creatorKey=row=>(row.creator_name||'').trim().toLowerCase()||'unknown';
const byTypeThenName=(a,b)=>(TYPE_ORDER[a.card_type]??9)-(TYPE_ORDER[b.card_type]??9)||String(a.name).localeCompare(String(b.name));

async function fetchCards(){const r=await fetch(ROOT+'/glep_cards?select=id,name,card_type,card_data,artwork_url,creator_name&review_status=eq.approved&order=created_at.desc&limit=300',{headers:{apikey:KEY}});
 if(!r.ok)throw Error('the Deck could not load (HTTP '+r.status+')');return r.json()}

async function jpeg(canvas){const out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height;const x=out.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,out.width,out.height);x.drawImage(canvas,0,0);
 const blob=await new Promise((ok,no)=>out.toBlob(b=>b?ok(b):no(Error('image conversion failed')),'image/jpeg',.92));return {bytes:new Uint8Array(await blob.arrayBuffer()),w:out.width,h:out.height}}
// Card picture on white (so nothing transparent prints black), at the card's own 300 dpi.
async function cardJPEG(row){const c=row.card_data||{};return jpeg(await window.glepCardCanvas({...c,name:row.name,type:row.card_type,image:row.artwork_url||'',strokes:[]}))}

function loadImg(url){return new Promise(ok=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>ok(null);i.src=url+'?v=2026-11-08'})}
const backCache={};
// Billy's back designs have a plain margin (about 15 px) outside their outer border, while the fronts' border runs to
// the very edge, so a back printed as-is looks smaller than its front. Find the outer border (the first row/column
// from each edge that is mostly dark) and crop to it, so the back's border lands exactly on the card edge like the front.
function frameEdges(img){const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
 const d=x.getImageData(0,0,c.width,c.height).data,W=c.width,H=c.height,dark=(px,py)=>{const i=(py*W+px)*4;return d[i+3]>0&&(d[i]+d[i+1]+d[i+2])/3<110};
 const colDark=px=>{let n=0;for(let py=0;py<H;py++)n+=dark(px,py);return n/H>.5},rowDark=py=>{let n=0;for(let px=0;px<W;px++)n+=dark(px,py);return n/W>.5};
 const lim=Math.round(Math.min(W,H)*.08),find=(test,from,step)=>{for(let k=0;k<=lim;k++)if(test(from+k*step))return k;return 0};
 const l=find(colDark,0,1),r=find(colDark,W-1,-1),t=find(rowDark,0,1),b=find(rowDark,H-1,-1);return {x:l,y:t,w:W-l-r,h:H-t-b}}
// One card back per type, drawn into a 750 × 1050 canvas (covering it, centred, if the image isn't exactly 5:7).
// Blank card for hand drawing: the type's frame with an empty white art window, no title, numbers or text.
const FRAMES={attack:'assets/frames/damage.png',modifier:'assets/frames/modifier.png',fate:'assets/frames/fate.png'},blankCache={};
function blankJPEG(type){return blankCache[type]||(blankCache[type]=(async()=>{const c=document.createElement('canvas');c.width=750;c.height=1050;const x=c.getContext('2d'),img=await loadImg(FRAMES[type]);
 if(img)x.drawImage(img,0,0,750,1050);else{x.fillStyle=PLACEHOLDER[type];x.fillRect(0,0,750,1050);x.fillStyle='#d8c6b9';x.fillRect(43,111,664,828)}
 x.fillStyle='#fff';x.fillRect(85,196,580,408);x.strokeStyle='#1c1512';x.lineWidth=3;x.strokeRect(83.5,194.5,583,411);return jpeg(c)})())}
function backJPEG(type){return backCache[type]||(backCache[type]=(async()=>{const c=document.createElement('canvas');c.width=750;c.height=1050;const x=c.getContext('2d'),img=await loadImg(BACKS[type]);
 if(img){const r=frameEdges(img);x.drawImage(img,r.x,r.y,r.w,r.h,0,0,750,1050)}
 else{x.fillStyle=PLACEHOLDER[type];x.fillRect(0,0,750,1050);x.strokeStyle='#222';x.lineWidth=14;x.strokeRect(40,40,670,970);x.fillStyle='#222';x.textAlign='center';x.font='bold 84px sans-serif';x.fillText(LABEL[type].toUpperCase(),375,500);x.font='40px sans-serif';x.fillText('card back · placeholder',375,570)}
 return {...await jpeg(c),placeholder:!img}})())}

// ---- page geometry -------------------------------------------------------------------------------------------
// Grid is centred, so it sits in the same place on both sides of the sheet. Slots are numbered 0–8, left to right,
// top to bottom, as seen on that side.
function grid(pw,ph){const x0=(pw-COLS*CW)/2,y0=(ph-ROWS*CH)/2;return {x0,y0,top:y0+ROWS*CH}}
function slotXY(g,slot){const col=slot%COLS,row=Math.floor(slot/COLS);return [g.x0+col*CW,g.top-(row+1)*CH]}
// The slot on the back of the sheet behind front slot s. Long-edge flip mirrors left/right; short-edge flip mirrors
// top/bottom and turns the back upside down.
function behind(s,flip){const col=s%COLS,row=Math.floor(s/COLS);return flip==='short'?(ROWS-1-row)*COLS+col:row*COLS+(COLS-1-col)}
// Nudge is what the alignment test shows, seen from the front: the backs look this many mm to the right / down (the Printing page's "Move backs" boxes pass the opposite).
// Converted to a move of the back page, in the back page's own coordinates (PDF y goes up), that cancels it.
function backShift(nudge,flip){const rx=(+nudge.x||0)*MM,ry=(+nudge.y||0)*MM;return flip==='short'?[-rx,-ry]:[rx,ry]}

function frontMarks(g,slots){const s=['0.75 G 0.25 w'];for(const i of slots){const [x,y]=slotXY(g,i);s.push(f(x)+' '+f(y)+' '+CW+' '+CH+' re S')}
 const n=Math.max(...slots)+1,used=Math.ceil(n/COLS),cols=Math.min(n,COLS),bottom=g.top-used*CH,right=g.x0+cols*CW,gap=3,len=Math.max(4,Math.min(14,g.y0-gap-1)),side=Math.max(4,Math.min(14,g.x0-gap-1));s.push('0 G 0.5 w');
 for(let c=0;c<=cols;c++){const x=f(g.x0+c*CW);s.push(x+' '+f(g.top+gap)+' m '+x+' '+f(g.top+gap+len)+' l S',x+' '+f(bottom-gap)+' m '+x+' '+f(bottom-gap-len)+' l S')}
 for(let r=0;r<=used;r++){const y=f(g.top-r*CH);s.push(f(g.x0-gap)+' '+y+' m '+f(g.x0-gap-side)+' '+y+' l S',f(right+gap)+' '+y+' m '+f(right+gap+side)+' '+y+' l S')}
 return s}

// A page is {cards:[{im,slot}], back?:true, rotate?:true, shift?:[dx,dy], extra?:string[] (more drawing), text?:true}.
function pageContent(p,pw,ph){const g=grid(pw,ph),[dx,dy]=p.shift||[0,0],s=[];
 p.cards.forEach(({slot},i)=>{const [x,y]=slotXY(g,slot),X=x+dx,Y=y+dy;s.push(p.rotate?'q '+(-CW)+' 0 0 '+(-CH)+' '+f(X+CW)+' '+f(Y+CH)+' cm /C'+i+' Do Q':'q '+CW+' 0 0 '+CH+' '+f(X)+' '+f(Y)+' cm /C'+i+' Do Q')});
 if(!p.back&&p.cards.length)s.push(...frontMarks(g,p.cards.map(c=>c.slot)));
 if(p.extra)s.push(...p.extra);s.push(...feedArrow(pw,ph));return s.join('\n')}
// Arrow in both side margins, level with the middle row (clear of cards and cut marks), pointing at the top edge:
// that edge goes into the printer first. Same on fronts and backs, so the stack goes back in the same way round.
function feedArrow(pw,ph){const cy=ph/2,s=['0 g 0 G 0.8 w'],t=(x,y,str)=>'BT /F1 6 Tf 0 1 -1 0 '+f(x)+' '+f(y)+' Tm ('+str+') Tj ET';
 for(const ax of [24,pw-24]){s.push(f(ax)+' '+f(cy-44)+' m '+f(ax)+' '+f(cy+30)+' l S',f(ax-4.5)+' '+f(cy+30)+' m '+f(ax+4.5)+' '+f(cy+30)+' l '+f(ax)+' '+f(cy+40)+' l h f')}
 s.push(t(19,cy-44,'FEED THIS WAY - TOP EDGE FIRST'),t(pw-12,cy-44,'FEED THIS WAY - TOP EDGE FIRST'));return s}

// Small PDF writer: one page per sheet, each card its own image, so cards stay sharp and sit at exact sizes.
function makePDF(pages,pw,ph){const enc=new TextEncoder(),chunks=[],offsets=[0];let size=0,obj=3;const add=b=>{chunks.push(b);size+=b.length},str=s=>add(enc.encode(s));
 const start=id=>{offsets[id]=size;str(id+' 0 obj\n')},end=()=>str('\nendobj\n');str('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
 const pageIds=[],imgIds=new Map();
 for(const p of pages){const page=++obj,content=++obj;pageIds.push(page);const refs=p.cards.map(({im})=>{if(!imgIds.has(im))imgIds.set(im,++obj);return imgIds.get(im)});
  start(page);str('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+f(pw)+' '+f(ph)+'] /Resources << /Font << /F1 3 0 R >> /XObject << '+refs.map((id,i)=>'/C'+i+' '+id+' 0 R').join(' ')+' >> >> /Contents '+content+' 0 R >>');end();
  const draw=enc.encode(pageContent(p,pw,ph));start(content);str('<< /Length '+draw.length+' >>\nstream\n');add(draw);str('\nendstream');end()}
 for(const [im,id] of imgIds){start(id);str('<< /Type /XObject /Subtype /Image /Width '+im.w+' /Height '+im.h+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+im.bytes.length+' >>\nstream\n');add(im.bytes);str('\nendstream');end()}
 start(1);str('<< /Type /Catalog /Pages 2 0 R >>');end();start(2);str('<< /Type /Pages /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pageIds.length+' >>');end();
 start(3);str('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');end();
 const xref=size;str('xref\n0 '+(obj+1)+'\n0000000000 65535 f \n');for(let i=1;i<=obj;i++)str(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 str('trailer\n<< /Size '+(obj+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');return new Blob(chunks,{type:'application/pdf'})}

function save(blob,name){const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
const today=()=>new Date().toISOString().slice(0,10);
const text=(x,y,size,t)=>'BT /F1 '+size+' Tf '+f(x)+' '+f(y)+' Td ('+String(t).replace(/[\\()]/g,'\\$&')+') Tj ET';

// Fronts as pages of 9. byType: each card type starts on a new page (so every page has one matching back sheet).
async function frontPages(rows,byType,say){const groups=byType?TYPES.map(t=>rows.filter(r=>r.card_type===t)).filter(g=>g.length):[rows],pages=[];let done=0;
 for(const group of groups){for(let i=0;i<group.length;i++){say('Drawing card '+(++done)+' of '+rows.length+'…');const im=await cardJPEG(group[i]);if(i%PER===0)pages.push({cards:[],type:group[i].card_type});pages[pages.length-1].cards.push({im,slot:i%PER})}
  // Printing page: fill the rest of a type's last page with blank cards, so the full 3 × 3 back sheet matches every slot.
  const last=pages[pages.length-1];if(byType&&last.cards.length<PER){const im=await blankJPEG(last.type);for(let k=last.cards.length;k<PER;k++)last.cards.push({im,slot:k,blank:true})}}
 return pages}
function backPage(type,im,front,opt){const slots=front?front.cards.map(c=>behind(c.slot,opt.flip)):[...Array(PER).keys()];return {back:true,rotate:opt.flip==='short',shift:backShift(opt.nudge,opt.flip),cards:slots.map(slot=>({im,slot})),type}}

// ---- what the buttons make -----------------------------------------------------------------------------------
// opt: {paper:'letter'|'a4', flip:'long'|'short', nudge:{x,y} in mm, withBacks:bool, say:fn}
async function printFronts(which,opt){const say=opt.say||(()=>{});say('Loading the Deck…');
 const rows=(await fetchCards()).filter(r=>which==='all'||r.card_type===which).sort(byTypeThenName);
 if(!rows.length)return say('There are no approved '+(which==='all'?'':LABEL[which]+' ')+'cards to print yet.');
 let pages=await frontPages(rows,true,say),note='';
 if(opt.withBacks){const out=[];for(const p of pages){const b=await backJPEG(p.type);out.push(p,backPage(p.type,b,p,opt));if(b.placeholder)note=' Backs are placeholders until the designs are added.'}pages=out}
 say('Building the PDF…');const [pw,ph]=PAPER[opt.paper]||PAPER.letter,sheets=opt.withBacks?pages.length/2:pages.length;
 save(makePDF(pages,pw,ph),'glep-'+(which==='all'?'deck':which)+'-fronts'+(opt.withBacks?'-and-backs':'')+'-'+today()+'-'+opt.paper+'.pdf');
 const blanks=pages.reduce((n,p)=>n+p.cards.filter(c=>c.blank).length,0);say('PDF ready: '+rows.length+' card'+(rows.length===1?'':'s')+(blanks?' + '+blanks+' blank':'')+' on '+sheets+' sheet'+(sheets===1?'':'s')+(opt.withBacks?', with the backs on every second page. Print two-sided, flip on '+opt.flip+' edge.':'.')+' Print at "Actual size".'+note)}

async function printBacks(type,opt){const say=opt.say||(()=>{});say('Drawing the '+LABEL[type]+' back sheet…');const b=await backJPEG(type),[pw,ph]=PAPER[opt.paper]||PAPER.letter;
 save(makePDF([backPage(type,b,null,opt)],pw,ph),'glep-'+type+'-backs-3x3-'+today()+'-'+opt.paper+'.pdf');
 say(LABEL[type]+' backs ready. Flip the printed '+LABEL[type]+' fronts and print on the back at "Actual size".'+(b.placeholder?' This is a placeholder until the '+LABEL[type]+' back design is added.':''))}

// Two-sided test: front has the card grid and mm rulers through the middle; back has a cross at the middle, moved
// by the current nudge. Hold the printed sheet up to a light and read where the cross lands.
async function printTest(opt){const [pw,ph]=PAPER[opt.paper]||PAPER.letter,g=grid(pw,ph),cx=pw/2,cy=ph/2,s=['0 G 0.4 w'];
 for(let i=0;i<PER;i++){const [x,y]=slotXY(g,i);s.push(f(x)+' '+f(y)+' '+CW+' '+CH+' re S')}
 s.push('0.3 w');for(let m=-10;m<=10;m++){const t=m%5===0?7:m%1===0?3.5:2;s.push(f(cx+m*MM)+' '+f(cy-t)+' m '+f(cx+m*MM)+' '+f(cy+t)+' l S',f(cx-t)+' '+f(cy-m*MM)+' m '+f(cx+t)+' '+f(cy-m*MM)+' l S')}
 s.push(f(cx-10*MM)+' '+f(cy)+' m '+f(cx+10*MM)+' '+f(cy)+' l S',f(cx)+' '+f(cy-10*MM)+' m '+f(cx)+' '+f(cy+10*MM)+' l S');
 for(const m of [-10,-5,5,10]){s.push(text(cx+m*MM-(m>0?5:3),cy-14,5,-m),text(cx+12,cy-m*MM-2,5,-m))}
 const tx=g.x0+8,ty=cy-CH/2+40;s.push(text(tx,ty+30,9,'Glep alignment test - side 1 (front)'),
  text(tx,ty+18,6.5,'Print both pages on ONE sheet: two-sided, flip on '+opt.flip+' edge, 100% / Actual size.'),
  text(tx,ty+9,6.5,'Hold it up to a light. Read the ruler number where the cross from the back lands (each tick = 1 mm).'),
  text(tx,ty,6.5,'Add those numbers to "Move backs" under Needs alignment?. Current: right '+(opt.move?.x||0)+' mm, down '+(opt.move?.y||0)+' mm.'));
 const [dx,dy]=backShift(opt.nudge,opt.flip),b=['0 G 0.6 w',f(cx+dx-14*MM)+' '+f(cy+dy)+' m '+f(cx+dx+14*MM)+' '+f(cy+dy)+' l S',f(cx+dx)+' '+f(cy+dy-14*MM)+' m '+f(cx+dx)+' '+f(cy+dy+14*MM)+' l S','0.3 w'];
 for(let i=0;i<PER;i++){const [x,y]=slotXY(g,i);b.push(f(x+dx)+' '+f(y+dy)+' '+CW+' '+CH+' re S')}
 b.push(text(g.x0+8,cy+CH/2-20,9,'Glep alignment test - side 2 (back)'));
 save(makePDF([{cards:[],extra:s},{cards:[],back:true,extra:b}],pw,ph),'glep-alignment-test-'+opt.paper+'.pdf');
 opt.say?.('Test sheet ready. Print both pages on one sheet (two-sided), hold it to a light, and add the ruler numbers where the back cross lands.')}

// Quick test: just the 3 × 3 grid outline on both sides (no art). The back uses the same shift as real backs.
async function printGrid(opt){const [pw,ph]=PAPER[opt.paper]||PAPER.letter,g=grid(pw,ph),[dx,dy]=backShift(opt.nudge,opt.flip),box=(ox,oy)=>{const s=['0 G 0.5 w'];for(let i=0;i<PER;i++){const [x,y]=slotXY(g,i);s.push(f(x+ox)+' '+f(y+oy)+' '+CW+' '+CH+' re S')}return s};
 save(makePDF([{cards:[],extra:box(0,0)},{cards:[],back:true,extra:box(dx,dy)}],pw,ph),'glep-grid-test-'+opt.paper+'.pdf');
 opt.say?.('Grid test ready (2 pages). Print it two-sided on one sheet and hold it to a light: the lines should sit on top of each other.')}

window.glepPrint={fronts:printFronts,backs:printBacks,test:printTest,grid:printGrid};

// ---- The Deck page button: follows the Deck's search and filters --------------------------------------------
let busy=false;
async function guard(btn,fn){if(busy)return;if(!window.glepCardCanvas)throw Error('the card drawer has not loaded yet. Reload the page and try again');busy=true;btn.disabled=true;try{await fn()}finally{busy=false;btn.disabled=false}}
function matches(row){const search=(el('deckSearch')?.value||'').trim().toLowerCase(),type=el('deckTypeFilter')?.value||'',who=el('deckCreatorFilter')?.value||'';
 return (!who||creatorKey(row)===who)&&(!type||row.card_type===type)&&(!search||(row.name+' '+row.creator_name+' '+row.card_type+' '+(row.card_data?.tags||'')).toLowerCase().includes(search))}
el('deckPrintBtn')?.addEventListener('click',()=>{const say=t=>el('deckPrintStatus').textContent=t;guard(el('deckPrintBtn'),async()=>{say('Loading the Deck…');
 const rows=(await fetchCards()).filter(matches).sort(byTypeThenName);if(!rows.length)return say('No cards match the search and filters, so there is nothing to print.');
 const paper=el('deckPrintPaper').value==='a4'?'a4':'letter',[pw,ph]=PAPER[paper],pages=await frontPages(rows,false,say);say('Building the PDF…');
 save(makePDF(pages,pw,ph),'glep-deck-'+today()+'-'+paper+'.pdf');say('PDF ready: '+rows.length+' card'+(rows.length===1?'':'s')+' on '+pages.length+' page'+(pages.length===1?'':'s')+'. Print at 100% / "Actual size", not "Fit to page".')}).catch(e=>say('PDF export failed: '+e.message))});

// ---- Card Master → Printing ----------------------------------------------------------------------------------
const PREF='glep-print-settings-v1';
function prefs(){try{return JSON.parse(localStorage.getItem(PREF)||'{}')}catch{return {}}}
function opts(){const o={paper:'letter',flip:'long',move:{x:+el('printNudgeX').value||0,y:+el('printNudgeY').value||0},withBacks:false,say:t=>el('printStatus').textContent=t};
 o.nudge={x:-o.move.x,y:-o.move.y};try{localStorage.setItem(PREF,JSON.stringify({move:o.move}))}catch{}return o}
if(el('printingPanel')){const p=prefs();if(p.move){el('printNudgeX').value=p.move.x||0;el('printNudgeY').value=p.move.y||0;if(p.move.x||p.move.y)el('printingPanel').querySelector('.print-align').open=true}
 el('printingPanel').addEventListener('click',e=>{const b=e.target.closest('button[data-print]');if(!b)return;const o=opts(),[kind,arg]=b.dataset.print.split(':');
  guard(b,()=>kind==='front'?printFronts(arg,o):kind==='back'?printBacks(arg,o):kind==='grid'?printGrid(o):printTest(o)).catch(err=>o.say('PDF failed: '+err.message))})}
})();
