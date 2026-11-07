// The Deck → "Download print PDF": every approved card (or just the ones the search and filters show) at real
// card size, 2.5 × 3.5 in (63.5 × 88.9 mm), nine to a page on Letter or A4, with cut marks. Runs in the browser.
// It fetches the cards itself so the Deck grid's own loading is left alone.
(()=>{'use strict';
const ROOT='https://chfzvfyigycpkcsxbscu.supabase.co/rest/v1',KEY='sb_publishable_0zmkCJDMk_qAex_bnopfsA_CQP21oxN';
const el=id=>document.getElementById(id);
const PAPER={letter:[612,792],a4:[595.28,841.89]};      // PDF points, 72 per inch
const CW=180,CH=252,COLS=3,ROWS=3,PER=COLS*ROWS;          // one card is 2.5 × 3.5 in
const TYPE_ORDER={attack:0,modifier:1,fate:2};
let busy=false;

function say(s){el('deckPrintStatus').textContent=s}
const creatorKey=row=>(row.creator_name||'').trim().toLowerCase()||'unknown';

// Same rules as the Deck grid: search, card type and "Submitted by" narrow the list; nothing set = every card.
function matches(row){const search=(el('deckSearch')?.value||'').trim().toLowerCase(),type=el('deckTypeFilter')?.value||'',who=el('deckCreatorFilter')?.value||'';
 return (!who||creatorKey(row)===who)&&(!type||row.card_type===type)&&(!search||(row.name+' '+row.creator_name+' '+row.card_type+' '+(row.card_data?.tags||'')).toLowerCase().includes(search))}

async function fetchCards(){const r=await fetch(ROOT+'/glep_cards?select=id,name,card_type,card_data,artwork_url,creator_name&review_status=eq.approved&order=created_at.desc&limit=300',{headers:{apikey:KEY}});
 if(!r.ok)throw Error('the Deck could not load (HTTP '+r.status+')');return r.json()}

// Card picture on white (so nothing transparent prints black), as JPEG bytes at the card's own 300 dpi.
async function cardJPEG(row){const c=row.card_data||{},src=await window.glepCardCanvas({...c,name:row.name,type:row.card_type,image:row.artwork_url||'',strokes:[]});
 const out=document.createElement('canvas');out.width=src.width;out.height=src.height;const x=out.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,out.width,out.height);x.drawImage(src,0,0);
 const blob=await new Promise((ok,no)=>out.toBlob(b=>b?ok(b):no(Error('image conversion failed')),'image/jpeg',.92));return {bytes:new Uint8Array(await blob.arrayBuffer()),w:out.width,h:out.height}}

const f=n=>(+n.toFixed(2)).toString();
// Page drawing: cards butted together in a 3 × 3 grid (one straight cut per line), a faint outline round each card,
// and short cut marks in the margin lined up with every cut.
function pageContent(n,pw,ph){const gw=COLS*CW,gh=ROWS*CH,x0=(pw-gw)/2,y0=(ph-gh)/2,top=y0+gh,s=[];
 for(let i=0;i<n;i++){const col=i%COLS,row=Math.floor(i/COLS),x=x0+col*CW,y=top-(row+1)*CH;s.push('q '+CW+' 0 0 '+CH+' '+f(x)+' '+f(y)+' cm /C'+i+' Do Q')}
 const used=Math.ceil(n/COLS),cols=Math.min(n,COLS),bottom=top-used*CH,right=x0+cols*CW;
 s.push('0.75 G 0.25 w');for(let i=0;i<n;i++){const col=i%COLS,row=Math.floor(i/COLS);s.push(f(x0+col*CW)+' '+f(top-(row+1)*CH)+' '+CW+' '+CH+' re S')}
 const gap=3,len=Math.max(4,Math.min(14,y0-gap-1)),side=Math.max(4,Math.min(14,x0-gap-1));s.push('0 G 0.5 w');
 for(let c=0;c<=cols;c++){const x=f(x0+c*CW);s.push(x+' '+f(top+gap)+' m '+x+' '+f(top+gap+len)+' l S',x+' '+f(bottom-gap)+' m '+x+' '+f(bottom-gap-len)+' l S')}
 for(let r=0;r<=used;r++){const y=f(top-r*CH);s.push(f(x0-gap)+' '+y+' m '+f(x0-gap-side)+' '+y+' l S',f(right+gap)+' '+y+' m '+f(right+gap+side)+' '+y+' l S')}
 return s.join('\n')}

// Small PDF writer: one page per sheet, each card its own image, so cards stay sharp and sit at exact sizes.
function makePDF(pages,pw,ph){const enc=new TextEncoder(),chunks=[],offsets=[0];let size=0,obj=2;const add=b=>{chunks.push(b);size+=b.length},str=s=>add(enc.encode(s));
 const start=id=>{offsets[id]=size;str(id+' 0 obj\n')},end=()=>str('\nendobj\n');str('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
 const pageIds=[];for(const cards of pages){const page=++obj,content=++obj,imgs=cards.map(()=>++obj);pageIds.push(page);
  start(page);str('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+f(pw)+' '+f(ph)+'] /Resources << /XObject << '+imgs.map((id,i)=>'/C'+i+' '+id+' 0 R').join(' ')+' >> >> /Contents '+content+' 0 R >>');end();
  const draw=enc.encode(pageContent(cards.length,pw,ph));start(content);str('<< /Length '+draw.length+' >>\nstream\n');add(draw);str('\nendstream');end();
  cards.forEach((im,i)=>{start(imgs[i]);str('<< /Type /XObject /Subtype /Image /Width '+im.w+' /Height '+im.h+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+im.bytes.length+' >>\nstream\n');add(im.bytes);str('\nendstream');end()})}
 start(1);str('<< /Type /Catalog /Pages 2 0 R >>');end();start(2);str('<< /Type /Pages /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pageIds.length+' >>');end();
 const xref=size;str('xref\n0 '+(obj+1)+'\n0000000000 65535 f \n');for(let i=1;i<=obj;i++)str(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 str('trailer\n<< /Size '+(obj+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n');return new Blob(chunks,{type:'application/pdf'})}

async function exportDeck(){if(busy)return;if(!window.glepCardCanvas)return say('The card drawer has not loaded yet. Reload the page and try again.');busy=true;const btn=el('deckPrintBtn');btn.disabled=true;
 try{say('Loading the Deck…');const rows=(await fetchCards()).filter(matches).sort((a,b)=>(TYPE_ORDER[a.card_type]??9)-(TYPE_ORDER[b.card_type]??9)||String(a.name).localeCompare(String(b.name)));
  if(!rows.length)return say('No cards match the search and filters, so there is nothing to print.');
  const paper=el('deckPrintPaper').value==='a4'?'a4':'letter',[pw,ph]=PAPER[paper],pages=[];
  for(let i=0;i<rows.length;i++){say('Drawing card '+(i+1)+' of '+rows.length+'…');const im=await cardJPEG(rows[i]);if(i%PER===0)pages.push([]);pages[pages.length-1].push(im)}
  say('Building the PDF…');const blob=makePDF(pages,pw,ph),a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download='glep-deck-'+new Date().toISOString().slice(0,10)+'-'+paper+'.pdf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  say('PDF ready: '+rows.length+' card'+(rows.length===1?'':'s')+' on '+pages.length+' page'+(pages.length===1?'':'s')+'. Print at 100% / "Actual size", not "Fit to page".')}
 catch(e){say('PDF export failed: '+e.message)}finally{busy=false;btn.disabled=false}}

el('deckPrintBtn').addEventListener('click',exportDeck);
})();
