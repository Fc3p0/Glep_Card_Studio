import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const origin="https://fc3p0.github.io";
const cors={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"authorization,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const api=Deno.env.get("SUPABASE_URL")!,secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const headers={apikey:secret,Authorization:"Bearer "+secret};
async function post(url:string,data:unknown){const r=await fetch(url,{method:"POST",headers:{...headers,"Content-Type":"application/json","Prefer":"return=representation"},body:JSON.stringify(data)});if(!r.ok)throw Error("Database write failed");return await r.json()}
Deno.serve(async(request:Request)=>{
 if(request.method==="OPTIONS")return new Response(null,{headers:cors});
 if(request.method!=="POST")return respond({error:"Method not allowed"},405);
 if(request.headers.get("Origin")!==origin)return respond({error:"Origin not permitted"},403);
 try{
  const raw=await request.text();if(raw.length>7500000)return respond({error:"Submission too large"},413);
  const data=JSON.parse(raw),code=String(data.code||"").trim().toLowerCase();
  if(code.length<6||code.length>100)return respond({error:"Invalid creator code"},403);
  const input=new TextEncoder().encode("glep-v1:"+code);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",input))).map(n=>n.toString(16).padStart(2,"0")).join("");
  const rr=await fetch(api+"/rest/v1/glep_creator_codes?code_hash=eq."+hash+"&active=eq.true&select=creator_name",{headers});
  const people=await rr.json();if(!rr.ok||!Array.isArray(people)||!people.length)return respond({error:"Invalid creator code"},403);
  const creator=people[0].creator_name;
  if(data.action==="statuses"){
    const ids=Array.isArray(data.ids)?data.ids.filter((x:unknown)=>typeof x==="string"&&/^[a-f0-9-]{36}$/i.test(x)).slice(0,200):[];
    if(!ids.length)return respond({statuses:[]});
    const q=api+"/rest/v1/glep_cards?select=id,review_status,review_note&creator_name=eq."+encodeURIComponent(creator)+"&id=in.("+ids.join(",")+")";
    const r=await fetch(q,{headers});
    if(!r.ok)return respond({error:"Status lookup failed"},500);
    return respond({statuses:await r.json()});
  }

  const type=data.kind==="art"?"glep_artworks":data.kind==="card"?"glep_cards":null;
  if(!type)return respond({error:"Invalid submission type"},400);
  const limit=await fetch(api+"/rest/v1/"+type+"?creator_name=eq."+encodeURIComponent(creator)+"&created_at=gte."+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+"&select=id",{headers:{...headers,Prefer:"count=exact"},method:"HEAD"});
  const count=Number((limit.headers.get("content-range")||"0/0").split("/").pop()||0);
  if(count>=20)return respond({error:"Creator limit: 20 submissions per 24 hours"},429);
  const name=String(data.name||"Untitled").trim().slice(0,100)||"Untitled";
  let imagePath=null,imageUrl=null;
  if(data.image){
   const match=String(data.image).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
   if(!match)return respond({error:"Use PNG, JPG, or WebP artwork"},400);
   const bytes=Uint8Array.from(atob(match[2]),x=>x.charCodeAt(0));if(bytes.length>5*1024*1024)return respond({error:"Maximum 5MB per image"},413);
   imagePath="creators/"+crypto.randomUUID()+"."+(match[1]==="jpeg"?"jpg":match[1]);
   const uploaded=await fetch(api+"/storage/v1/object/glep-artwork/"+imagePath,{method:"POST",headers:{...headers,"Content-Type":"image/"+match[1],"x-upsert":"false"},body:bytes});
   if(!uploaded.ok)return respond({error:"Artwork upload failed"},500);
   imageUrl=api+"/storage/v1/object/public/glep-artwork/"+imagePath;
  }
  const rec=type==="glep_cards"?{name,card_type:["attack","modifier","fate"].includes(data.card_type)?data.card_type:"attack",card_data:data.card_data||{},artwork_url:imageUrl,creator_name:creator}:{name,tags:String(data.tags||"").slice(0,200),image_path:imagePath,creator_name:creator};
  if(type==="glep_artworks"&&!imagePath)return respond({error:"Artwork image required"},400);
  const records=await post(api+"/rest/v1/"+type,rec);
  return respond({ok:true,creator_name:creator,id:records[0]?.id});
 }catch(e){return respond({error:"Could not publish submission"},500)}
});