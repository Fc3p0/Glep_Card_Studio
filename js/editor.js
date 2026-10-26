(()=>{'use strict';
if(!CanvasRenderingContext2D.prototype.roundRect){CanvasRenderingContext2D.prototype.roundRect=function(x,y,w,h,r){r=Array.isArray(r)?r[0]:r;r=Math.min(Math.max(0,r||0),w/2,h/2);this.moveTo(x+r,y);this.arcTo(x+w,y,x+w,y+h,r);this.arcTo(x+w,y+h,x,y+h,r);this.arcTo(x,y+h,x,y,r);this.arcTo(x,y,x+w,y,r);this.closePath();return this}}
const $=id=>document.getElementById(id), W=750,H=1050,AW=538,AH=378,STORE='card-studio-v1',TYPES={attack:{label:'ATTACK',color:'#ed9caf'},modifier:{label:'MODIFIER',color:'#acd4a5'},fate:{label:'FATE',color:'#f1d46f'}},ELEMENTS=['None','Earth','Water','Fire','Air'],ART_FIT={artZoom:1,artX:0,artY:0};
let cards=[],current=null,dirty=false,artImage='',strokes=[],activeStroke=null,eraser=false,revision=0;const artCache=new Map(),pad=$('drawPad'),pctx=pad.getContext('2d'),canvas=$('preview'),ctx=canvas.getContext('2d');
let model={type:'attack',name:'',tags:'',damage:0,stars:0,element1:'None',element2:'None',effect:'',...ART_FIT,textSize:28};
function uuid(){return 'c-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9)}
function say(msg){$('status').textContent=msg}
function setDirty(){dirty=true;$('dirtyFlag').textContent='• unsaved'}
function safeNum(v){return Math.max(-10,Math.min(10,Math.round(Number(v)||0)))}
// Image zoom/position and the largest text size are per card; missing values (older cards) mean the original look.
function clampTo(v,min,max,def){v=Number(v);return Number.isFinite(v)?Math.max(min,Math.min(max,v)):def}
function artFit(c){return {artZoom:clampTo(c.artZoom,.5,3,1),artX:clampTo(c.artX,-1,1,0),artY:clampTo(c.artY,-1,1,0)}}
function textSizeOf(c){return Math.round(clampTo(c.textSize,14,44,28))}
function drawRound(c,x,y,w,h,r,fill,stroke,lineWidth=1){c.beginPath();c.roundRect(x,y,w,h,r);if(fill){c.fillStyle=fill;c.fill()}if(stroke){c.strokeStyle=stroke;c.lineWidth=lineWidth;c.stroke()}}
function polygon(c,pts){c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath()}
function elementIcon(c,type,x,y,size=75){if(!type||type==='None')return;c.save();c.translate(x,y);c.scale(size/90,size/90);c.lineWidth=7;c.lineCap='round';c.lineJoin='round';c.strokeStyle='#101010';c.fillStyle='#fff';c.beginPath();if(type==='Water'){c.moveTo(0,-43);c.bezierCurveTo(-7,-17,-35,9,-35,31);c.bezierCurveTo(-35,73,35,73,35,31);c.bezierCurveTo(35,9,7,-17,0,-43);c.closePath();c.stroke()}else if(type==='Fire'){c.moveTo(-15,44);c.bezierCurveTo(-50,18,-27,-12,-20,-18);c.bezierCurveTo(-20,-2,-9,4,-5,5);c.bezierCurveTo(-19,-28,0,-43,8,-50);c.bezierCurveTo(7,-17,36,-19,33,4);c.bezierCurveTo(44,-7,43,29,20,44);c.bezierCurveTo(29,20,10,5,7,6);c.bezierCurveTo(14,28,-4,37,-2,44);c.closePath();c.stroke()}else if(type==='Earth'){polygon(c,[[-42,14],[-12,-20],[28,-15],[42,11],[26,29],[-35,29]]);c.stroke();polygon(c,[[-2,26],[14,10],[33,16],[22,35],[7,36]]);c.stroke();polygon(c,[[-20,41],[-4,36],[11,44],[5,52],[-17,52]]);c.stroke()}else if(type==='Air'){c.beginPath();c.moveTo(34,-3);c.bezierCurveTo(7,2,-20,-4,-24,-21);c.bezierCurveTo(-30,-45,7,-48,12,-31);c.bezierCurveTo(21,-10,-17,-6,-12,-23);c.stroke();c.beginPath();c.moveTo(-41,13);c.bezierCurveTo(-10,13,24,12,40,10);c.moveTo(-19,28);c.bezierCurveTo(3,27,17,27,35,26);c.stroke()}c.restore()}
function wrapText(c,text,maxWidth,maxLines=Infinity){
  const words=(text||'').replace(/\r/g,'').split(/\s+/).filter(Boolean),lines=[];
  let line='';
  // Split extremely long unbroken words too, so no line can escape the text box.
  for(const word of words){
    let remainder=word;
    while(remainder){
      let candidate=line?line+' '+remainder:remainder;
      if(c.measureText(candidate).width<=maxWidth){line=candidate;break}
      if(line){lines.push(line);line='';continue}
      let cut=1;
      while(cut<remainder.length && c.measureText(remainder.slice(0,cut+1)).width<=maxWidth)cut++;
      lines.push(remainder.slice(0,cut));remainder=remainder.slice(cut);
    }
  }
  if(line)lines.push(line);
  if(lines.length>maxLines){
    const clipped=lines.slice(0,maxLines);let last=clipped.length-1;
    while(clipped[last].length && c.measureText(clipped[last]+'…').width>maxWidth)clipped[last]=clipped[last].slice(0,-1);
    clipped[last]+='…';return clipped;
  }
  return lines;
}
// Billy's printed frames (750x1050, same size as the card canvas). Slot positions below are measured from them:
// title bar 206-544 x 30-97, corner circles r=68 at (98,98) (652,98) (98,952) (652,952), paper 43-707 x 111-939.
const FRAMES={attack:'assets/frames/damage.png',modifier:'assets/frames/modifier.png',fate:'assets/frames/fate.png'},frameImgs={};
let framesReady=null;
function loadFrames(){return framesReady||(framesReady=Promise.all(Object.entries(FRAMES).map(([k,url])=>loadImage(url).then(i=>{frameImgs[k]=i}))))}
function paint(c,m,img,overlay){c.clearRect(0,0,W,H);const type=TYPES[m.type]||TYPES.attack,frame=frameImgs[m.type]||frameImgs.attack;
if(frame)c.drawImage(frame,0,0,W,H);else{c.fillStyle=type.color;c.fillRect(0,0,W,H);c.fillStyle='#d8c6b9';c.fillRect(43,111,664,828)}
const ink='#1c1512';
// title bar
const title=(m.name||'UNTITLED CARD').toUpperCase();c.textAlign='center';c.textBaseline='alphabetic';c.fillStyle=ink;let fs=30;c.font=`800 ${fs}px system-ui,sans-serif`;while(c.measureText(title).width>310&&fs>14){fs-=1;c.font=`800 ${fs}px system-ui,sans-serif`}c.fillText(title,375,72);c.font='700 12px system-ui,sans-serif';c.fillStyle='#6b5a50';c.fillText(type.label,375,90);
// damage + stars in the top corner circles
c.fillStyle=ink;c.font='800 56px system-ui,sans-serif';c.fillText(String(safeNum(m.damage)),98,113);c.font='800 13px system-ui,sans-serif';c.fillText('DMG',98,138);
if(m.type!=='fate'){c.font='800 56px system-ui,sans-serif';c.fillText(String(safeNum(m.stars)),652,113);c.font='800 13px system-ui,sans-serif';c.fillText('STARS',652,138)}else{c.font='700 20px system-ui,sans-serif';c.fillStyle='#7a6a5e';c.fillText('FATE',652,105)}
// artwork window keeps the drawing pad's 538:378 ratio so strokes aren't stretched
const ax=85,ay=196,aw=580,ah=408;c.fillStyle='#fff';c.fillRect(ax,ay,aw,ah);if(img)drawArt(c,img,ax,ay,aw,ah,m);if(overlay)c.drawImage(overlay,ax,ay,aw,ah);
c.strokeStyle=ink;c.lineWidth=3;c.strokeRect(ax-1.5,ay-1.5,aw+3,ah+3);
const effect=(m.effect||'').trim();
// The text block sits on the paper between the art and the lower corner circles (rings start near y=865).
// Select the largest size that fits both vertically and horizontally; truncate only
// when there isn't enough room even at the minimum legible font size.
const textTop=626,textBottom=858,textWidth=560,minSize=12,maxSize=textSizeOf(m);
let chosenSize=minSize,lines=[],lineHeight=0;
for(let fontSize=maxSize;fontSize>=minSize;fontSize--){
  c.font=`500 ${fontSize}px system-ui,sans-serif`;
  const height=fontSize*1.26;
  const trial=wrapText(c,effect,textWidth);
  if(trial.length*height<=textBottom-textTop){chosenSize=fontSize;lines=trial;lineHeight=height;break}
}
if(effect && !lines.length){
  c.font=`500 ${minSize}px system-ui,sans-serif`;
  lineHeight=minSize*1.26;chosenSize=minSize;
  lines=wrapText(c,effect,textWidth,Math.floor((textBottom-textTop)/lineHeight));
}
c.fillStyle=ink;c.textAlign='center';c.textBaseline='alphabetic';
c.font=`500 ${chosenSize}px system-ui,sans-serif`;
let ypos=textTop+chosenSize;
for(const line of lines){c.fillText(line,375,ypos,textWidth);ypos+=lineHeight}
elementIcon(c,m.element1,98,954,62);elementIcon(c,m.element2,652,954,62);
}
// Fits the image inside the window, then applies the card's zoom and offset (fractions of the window), clipped to the window.
function drawArt(c,img,x,y,w,h,m){const f=artFit(m),r=Math.min(w/img.width,h/img.height)*f.artZoom,dw=img.width*r,dh=img.height*r;c.save();c.beginPath();c.rect(x,y,w,h);c.clip();c.drawImage(img,x+(w-dw)/2+f.artX*w,y+(h-dh)/2+f.artY*h,dw,dh);c.restore()}
function loadImage(url){if(!url)return Promise.resolve(null);if(artCache.has(url))return artCache.get(url);let p=new Promise(resolve=>{let i=new Image();i.onload=()=>resolve(i);i.onerror=()=>resolve(null);if(/^https?:/.test(url))i.crossOrigin='anonymous';i.src=url});artCache.set(url,p);return p}
function drawStroke(c,s){if(!s.points?.length)return;c.save();c.lineCap='round';c.lineJoin='round';c.globalCompositeOperation=s.erase?'destination-out':'source-over';c.strokeStyle=s.color;c.lineWidth=s.size*(s.erase?4:1);c.beginPath();c.moveTo(s.points[0][0],s.points[0][1]);if(s.points.length===1)c.lineTo(s.points[0][0]+.01,s.points[0][1]+.01);else s.points.slice(1).forEach(p=>c.lineTo(p[0],p[1]));c.stroke();c.restore()}
function renderPad(){pctx.clearRect(0,0,AW,AH);for(const s of strokes)drawStroke(pctx,s);if(activeStroke)drawStroke(pctx,activeStroke)}
async function drawPreview(){canvas.classList.toggle('art-movable',!!artImage);const n=++revision,img=await loadImage(artImage);await loadFrames();if(n!==revision)return;renderPad();paint(ctx,model,img,pad)}
function syncSizeControls(){const f=artFit(model);$('artZoom').value=f.artZoom;$('artZoomLabel').textContent=Math.round(f.artZoom*100)+'%';$('textSize').value=textSizeOf(model);$('textSizeLabel').textContent=textSizeOf(model)+' px';canvas.classList.toggle('art-movable',!!artImage)}
function resetArtFit(){Object.assign(model,ART_FIT);syncSizeControls()}
function fillControls(){document.querySelectorAll('[data-type]').forEach(b=>{b.classList.toggle('active',b.dataset.type===model.type);b.setAttribute('aria-pressed',b.dataset.type===model.type)});$('cardName').value=model.name;$('cardTags').value=model.tags||'';model.damage=safeNum(model.damage);$('damage').value=model.damage;model.stars=safeNum(model.stars);$('stars').value=model.stars;$('element1').value=model.element1;$('element2').value=model.element2;$('effect').value=model.effect;syncSizeControls();$('starsField').classList.toggle('hidden',model.type==='fate');$('effectHint').textContent=model.type==='attack'?'Attack description text is flavor only — it does not change damage.':model.type==='fate'?'Fate cards have no stars; effects can change damage, gems or round results.':'Modifier text describes the effect of the modifier.'}
for(const id of ['element1','element2'])for(const e of ELEMENTS){let o=document.createElement('option');o.value=e;o.textContent=e;$(id).append(o)}
// Damage and stars use dropdowns only; no quick-select button rows.
for(const id of ['cardName','cardTags','damage','stars','element1','element2','effect']){const update=()=>{let key=id==='cardName'?'name':id==='cardTags'?'tags':id;if(['damage','stars'].includes(key)){const raw=$(id).value.trim();if(raw==='-'||raw==='')return; if(!/^-?\d{1,2}$/.test(raw))return;model[key]=safeNum(raw)}else model[key]=$(id).value;setDirty();drawPreview()};$(id).addEventListener('input',update);$(id).addEventListener('change',update)}
for(const id of ['damage','stars']){$(id).addEventListener('blur',()=>{const num=safeNum($(id).value);$(id).value=num;model[id]=num;drawPreview()})}
document.querySelectorAll('[data-type]').forEach(b=>b.onclick=()=>{model.type=b.dataset.type;fillControls();setDirty();drawPreview()});
$('artZoom').oninput=()=>{model.artZoom=clampTo($('artZoom').value,.5,3,1);syncSizeControls();setDirty();drawPreview()};$('artReset').onclick=()=>{resetArtFit();setDirty();drawPreview()};
$('textSize').oninput=()=>{model.textSize=textSizeOf({textSize:$('textSize').value});syncSizeControls();setDirty();drawPreview()};
// Drag inside the preview's art window to move the uploaded image (preview canvas is 750x1050; art window 85,196 580x408).
(function(){let drag=null;const at=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*W/r.width,(e.clientY-r.top)*H/r.height]};
canvas.addEventListener('pointerdown',e=>{if(!artImage)return;const [x,y]=at(e);if(x<85||x>665||y<196||y>604)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);canvas.classList.add('art-moving');drag={x,y,artX:artFit(model).artX,artY:artFit(model).artY}});
canvas.addEventListener('pointermove',e=>{if(!drag)return;const [x,y]=at(e);model.artX=clampTo(drag.artX+(x-drag.x)/580,-1,1,0);model.artY=clampTo(drag.artY+(y-drag.y)/408,-1,1,0);drawPreview()});
const end=()=>{if(!drag)return;drag=null;canvas.classList.remove('art-moving');setDirty();drawPreview()};canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end)})();
$('penSize').oninput=()=>$('penLabel').textContent=$('penSize').value+' px';$('eraser').onclick=()=>{eraser=!eraser;$('eraser').textContent='Eraser: '+(eraser?'on':'off')};
// XP Paint-inspired controls reuse existing drawing functions.
(function(){const icons=document.querySelectorAll('[data-xp-tool]');function selectTool(name){icons.forEach(b=>b.classList.toggle('xp-current',b.dataset.xpTool===name));if(name==='eraser'){if(!eraser)$('eraser').click()}else{if(eraser)$('eraser').click();if(name==='thin')$('penSize').value='1';if(name==='brush')$('penSize').value='8';if(name==='pen')$('penSize').value='3';$('penSize').dispatchEvent(new Event('input'))}$('xpPaintStatus').textContent=name==='eraser'?'Eraser':name==='brush'?'Brush':'Pencil'}icons.forEach(b=>b.onclick=()=>selectTool(b.dataset.xpTool));$('xpUndo').onclick=()=>$('undo').click();$('xpClear').onclick=()=>$('clearDrawing').click();document.querySelectorAll('[data-paint-color]').forEach(b=>b.onclick=()=>{$('penColor').value=b.dataset.paintColor;$('xpColorPreview').style.background=b.dataset.paintColor;document.querySelectorAll('[data-paint-color]').forEach(x=>x.classList.toggle('xp-selected',x===b));if(eraser)selectTool('pen')});$('penColor').addEventListener('input',()=>{$('xpColorPreview').style.background=$('penColor').value});})();
function pointerPos(e){let r=pad.getBoundingClientRect();return [Math.max(0,Math.min(AW,(e.clientX-r.left)*AW/r.width)),Math.max(0,Math.min(AH,(e.clientY-r.top)*AH/r.height))]}
pad.addEventListener('pointerdown',e=>{e.preventDefault();pad.setPointerCapture(e.pointerId);activeStroke={color:$('penColor').value,size:Number($('penSize').value),erase:eraser,points:[pointerPos(e)]};renderPad()});pad.addEventListener('pointermove',e=>{if(!activeStroke)return;activeStroke.points.push(pointerPos(e));renderPad()});function endStroke(){if(activeStroke){strokes.push(activeStroke);activeStroke=null;setDirty();drawPreview()}}pad.addEventListener('pointerup',endStroke);pad.addEventListener('pointercancel',endStroke);
$('undo').onclick=()=>{strokes.pop();setDirty();drawPreview()};$('clearDrawing').onclick=()=>{if(strokes.length&&!confirm('Clear all drawing strokes?'))return;strokes=[];setDirty();drawPreview()};$('clearImage').onclick=()=>{artImage='';$('artFile').value='';resetArtFit();setDirty();drawPreview()};
function artDataURL(c,type){if(type==='image/jpeg')return c.toDataURL('image/jpeg',.85);const w=c.toDataURL('image/webp',.9);return w.startsWith('data:image/webp')?w:c.toDataURL('image/png')}
$('artFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>18e6){say('Image is too large. Choose one under 18 MB.');return}try{const url=await fileData(f);const img=await loadImage(url);if(!img){say('Could not read that image.');return}const c=document.createElement('canvas'),max=1100,s=Math.min(1,max/Math.max(img.width,img.height));c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);artImage=artDataURL(c,f.type);resetArtFit();setDirty();drawPreview()}catch(err){say('Image upload failed: '+err.message)}};
function fileDataText(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Read failed'));r.readAsText(file)})}
function fileData(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Read failed'));r.readAsDataURL(file)})}
function snapshot(){return {id:current||uuid(),...model,image:artImage,strokes:JSON.parse(JSON.stringify(strokes)),updatedAt:new Date().toISOString()}}
// On failure the list goes back to what's really stored, so nothing looks saved that isn't.
function saveStore(){try{localStorage.setItem(STORE,JSON.stringify(cards));return true}catch(e){reloadSaved();const msg='NOT SAVED: this device\'s card storage is full or unavailable. Your edits are still on screen. Use Backup JSON to keep a copy, delete some cards you have backed up, then save again.';say(msg);alert(msg);return false}}
// Re-reads My Cards from storage so a save never overwrites cards another tab or The Deck's "Copy to My Cards" added. Keeps the current list if storage can't be read.
function reloadSaved(){try{const c=JSON.parse(localStorage.getItem(STORE)||'[]');if(Array.isArray(c))cards=c}catch(e){}}
function getSaved(){try{let c=JSON.parse(localStorage.getItem(STORE)||'[]');cards=Array.isArray(c)?c:[]}catch(e){cards=[];say('Local storage could not be loaded. Import a backup if available.')}}
function persist(){const card=snapshot();reloadSaved();let ix=cards.findIndex(c=>c.id===card.id);if(ix>=0)cards[ix]=card;else cards.unshift(card);current=card.id;if(saveStore()){dirty=false;$('dirtyFlag').textContent='';say('Card saved. Remember to back up your collection.')}renderLibrary()}
$('saveBtn').onclick=persist;
$('submitCurrentCard').onclick=()=>{const card=snapshot();window.dispatchEvent(new CustomEvent('glep-submit-current-card',{detail:{card}}))};
window.addEventListener('glep-art-picked',e=>{artImage=e.detail.image;strokes=[];resetArtFit();setDirty();drawPreview();say('Gallery artwork added to card. Save your card when ready.')});window.addEventListener('glep-art-request',()=>{if(!artImage){say('Upload an image first, then save it to Gallery.');return}window.dispatchEvent(new CustomEvent('glep-art-save',{detail:{image:artImage,name:model.name||'Untitled artwork'}}))});
function newCard(copy=false){if(dirty&&!confirm('Discard unsaved edits?'))return;const old=snapshot();current=null;model=copy?{type:old.type,name:old.name+' (copy)',tags:old.tags||'',damage:old.damage,stars:old.stars,element1:old.element1,element2:old.element2,effect:old.effect,...artFit(old),textSize:textSizeOf(old)}:{type:'attack',name:'',damage:0,stars:0,element1:'None',element2:'None',effect:'',...ART_FIT,textSize:28};artImage=copy?old.image:'';strokes=copy?old.strokes:[];fillControls();dirty=false;$('dirtyFlag').textContent='';say(copy?'Duplicate ready. Save it as a new card.':'New blank card ready.');drawPreview();window.scrollTo({top:0,behavior:'smooth'})}
$('newBtn').onclick=()=>newCard(false);$('duplicateBtn').onclick=()=>newCard(true);
function openCard(id){if(dirty&&!confirm('Discard unsaved edits?'))return;let c=cards.find(x=>x.id===id);if(!c)return;current=c.id;model={type:c.type||'attack',name:c.name||'',tags:c.tags||'',damage:safeNum(c.damage),stars:safeNum(c.stars),element1:ELEMENTS.includes(c.element1)?c.element1:'None',element2:ELEMENTS.includes(c.element2)?c.element2:'None',effect:c.effect||'',...artFit(c),textSize:textSizeOf(c)};artImage=c.image||'';strokes=Array.isArray(c.strokes)?JSON.parse(JSON.stringify(c.strokes)):[];dirty=false;$('dirtyFlag').textContent='';fillControls();drawPreview();window.scrollTo({top:0,behavior:'smooth'});say('Editing saved card.')}
function makeCardCanvas(){let c=document.createElement('canvas');c.width=W;c.height=H;return c}
window.glepRenderCard=async c=>(await cardToCanvas(c)).toDataURL('image/png');
window.glepArtworkComposite=async c=>{const out=document.createElement('canvas');out.width=AW;out.height=AH;const x=out.getContext('2d');const img=await loadImage(c.image||'');if(img)drawArt(x,img,0,0,AW,AH,c);const over=document.createElement('canvas');over.width=AW;over.height=AH;const oc=over.getContext('2d');for(const st of c.strokes||[])drawStroke(oc,st);x.drawImage(over,0,0);return out.toDataURL('image/png')};
async function cardToCanvas(c){let out=makeCardCanvas();const img=await loadImage(c.image||'');await loadFrames();let ov=document.createElement('canvas');ov.width=AW;ov.height=AH;let oc=ov.getContext('2d');for(const s of c.strokes||[])drawStroke(oc,s);paint(out.getContext('2d'),c,img,ov);return out}
function download(blob,name){let a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
function slug(x){return String(x||'untitled-card').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55)||'card'}
function canvasBlob(c,format='image/png',quality){return new Promise((resolve,reject)=>c.toBlob(x=>x?resolve(x):reject(new Error('Image conversion failed')),format,quality))}
$('pngBtn').onclick=async()=>{try{const c=await cardToCanvas(snapshot());download(await canvasBlob(c),'card-'+slug(model.name)+'.png');say('PNG downloaded.')}catch(e){say('PNG export failed: '+e.message)}};
// Minimal standards-compliant PDF encoder. Each Letter page contains one compressed JPEG raster sheet.
function makePDF(images){const enc=new TextEncoder(),chunks=[],offsets=[0];let size=0;function add(bytes){chunks.push(bytes);size+=bytes.length}function str(s){add(enc.encode(s))}str('%PDF-1.4\n');let obj=0;function startObj(){offsets[++obj]=size;str(obj+' 0 obj\n');return obj}function endObj(){str('\nendobj\n')}
startObj();str('<< /Type /Catalog /Pages 2 0 R >>');endObj();startObj();const pageIds=images.map((_,i)=>3+i*3);str('<< /Type /Pages /Kids ['+pageIds.map(x=>x+' 0 R').join(' ') +'] /Count '+images.length+' >>');endObj();
for(let i=0;i<images.length;i++){let page=3+i*3,content=page+1,imgID=page+2,b=images[i];startObj();str('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 '+imgID+' 0 R >> >> /Contents '+content+' 0 R >>');endObj();let drawing=enc.encode('q\n612 0 0 792 0 0 cm\n/Im0 Do\nQ\n');startObj();str('<< /Length '+drawing.length+' >>\nstream\n');add(drawing);str('endstream');endObj();startObj();str('<< /Type /XObject /Subtype /Image /Width 1275 /Height 1650 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+b.length+' >>\nstream\n');add(b);str('\nendstream');endObj()}
const xref=size;str('xref\n0 '+(obj+1)+'\n0000000000 65535 f \n');for(let i=1;i<=obj;i++)str(String(offsets[i]).padStart(10,'0')+' 00000 n \n');str('trailer\n<< /Size '+(obj+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');return new Blob(chunks,{type:'application/pdf'})}
function base64Bytes(uri){let s=atob(uri.split(',')[1]),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a}
async function generateSheet(items){let pages=[];for(let p=0;p<items.length;p+=9){let sheet=document.createElement('canvas');sheet.width=1275;sheet.height=1650;const c=sheet.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,1275,1650);for(let j=0;j<9&&p+j<items.length;j++){let card=await cardToCanvas(items[p+j]);let col=j%3,row=Math.floor(j/3);c.drawImage(card,75+col*375,30+row*525,375,525)}pages.push(base64Bytes(sheet.toDataURL('image/jpeg',.92)))}return makePDF(pages)}
async function exportPDF(items,name){if(!items.length){say('No cards to export. Save at least one card first.');return}try{say('Preparing '+items.length+' card(s) for print…');download(await generateSheet(items),name);say('PDF ready. Print at 100% / actual size (not fit to page).')}catch(e){say('PDF export failed: '+e.message)}}
$('pdfCurrentBtn').onclick=()=>exportPDF([snapshot()],'card-'+slug(model.name)+'-print.pdf');$('pdfAllBtn').onclick=()=>exportPDF(cards,'card-studio-print-sheet.pdf');
function exportBackup(){let payload={format:'card-studio',version:1,exportedAt:new Date().toISOString(),cards};download(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),'card-studio-backup-'+new Date().toISOString().slice(0,10)+'.json');say('Editable JSON backup downloaded.')} $('backupBtn').onclick=exportBackup;
$('importBackup').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;let data=JSON.parse(await fileDataText(file));if(data.format!=='card-studio'||!Array.isArray(data.cards))throw new Error('Not a Card Studio backup');if(!confirm(`Import ${data.cards.length} card(s)? Cards with matching IDs will be replaced. Other saved cards will remain.`))return;reloadSaved();for(let c of data.cards){if(!c||typeof c!=='object'||!c.id||!TYPES[c.type])continue;let i=cards.findIndex(x=>x.id===c.id);if(i>=0)cards[i]=c;else cards.push(c)}const ok=saveStore();renderLibrary();if(ok)say('Imported backup.')}catch(err){say('Import failed: '+err.message)}finally{e.target.value=''}};
window.addEventListener('glep-approvals-synced',()=>renderLibrary());
const cardsChanged=()=>{reloadSaved();renderLibrary()};window.addEventListener('glep-cards-changed',cardsChanged);window.addEventListener('storage',e=>{if(e.key===STORE)cardsChanged()});
async function renderLibrary(){const host=$('libraryGrid');host.replaceChildren();$('count').textContent='('+cards.length+')';$('emptyLib').classList.toggle('hidden',cards.length>0);for(const card of cards){let div=document.createElement('div');div.className='lib-card';let img=document.createElement('img');img.alt='Preview for '+(card.name||'untitled');img.loading='lazy';img.onclick=()=>openCard(card.id);div.append(img);if(window.glepRenderCard)window.glepRenderCard(card).then(url=>{if(img.isConnected)img.src=url}).catch(()=>{});let title=document.createElement('strong');title.textContent=card.name||'Untitled card';div.append(title);let type=document.createElement('small');type.textContent=(card.type||'attack').toUpperCase();div.append(type);if(card.tags){const tagLine=document.createElement('small');tagLine.textContent='Tags: '+card.tags;div.append(tagLine)}const localStatus=document.createElement('small');localStatus.className='card-status';const state=(()=>{try{return JSON.parse(localStorage.getItem('glep-card-submissions-v1')||'{}')[card.id]}catch{return null}})();localStatus.textContent=state?'Submitted · '+state.status+(state.note?' · '+state.note:''):'Local draft';div.append(localStatus);let row=document.createElement('div');row.className='lib-buttons';let edit=document.createElement('button');edit.className='btn small';edit.textContent='Edit';edit.onclick=()=>openCard(card.id);let save=document.createElement('button');save.className='btn small';save.textContent='PNG';save.onclick=async()=>{let c=await cardToCanvas(card);download(await canvasBlob(c),'card-'+slug(card.name)+'.png')};let del=document.createElement('button');del.className='btn small danger';del.textContent='Delete';del.onclick=()=>{if(!confirm('Delete "'+(card.name||'Untitled')+'"? Export a backup first if needed.'))return;reloadSaved();cards=cards.filter(x=>x.id!==card.id);if(current===card.id)current=null;saveStore();renderLibrary()};row.append(edit,save,del);div.append(row);host.append(div);cardToCanvas(card).then(c=>{if(img.isConnected)img.src=c.toDataURL('image/jpeg',.58)}).catch(()=>{})}}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});getSaved();fillControls();drawPreview();renderLibrary();
})();
