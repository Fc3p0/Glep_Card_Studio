import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const origin="https://fc3p0.github.io";
const cors={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"content-type,apikey,authorization","Access-Control-Allow-Methods":"POST,OPTIONS"};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const url=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const auth={apikey:key,Authorization:"Bearer "+key};
async function sha(x:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(x)))).map(n=>n.toString(16).padStart(2,"0")).join("")}
async function db(path:string,method="GET",body?:unknown){const r=await fetch(url+"/rest/v1/"+path,{method,headers:{...auth,"Content-Type":"application/json",Prefer:"return=representation"},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error("Database request failed: "+r.status);return r.json()}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return response({error:"Method not allowed"},405);
 if(req.headers.get("Origin")!==origin)return response({error:"Origin not permitted"},403);
 try{
  const raw=await req.text();if(raw.length>4500000)return response({error:"Screenshot is too large (2 MB maximum)."},413);
  const v=JSON.parse(raw);const code=String(v.code||"").trim().toLowerCase();
  if(!/^[a-z0-9_-]{6,64}$/.test(code))return response({error:"Enter a valid creator code (at least 6 characters)."},400);
  const matched=await db("glep_creator_codes?code_hash=eq."+await sha("glep-v1:"+code)+"&active=eq.true&select=creator_name,is_admin");
  if(matched.length!==1)return response({error:"Creator code not recognized."},403);
  const user=matched[0];
  if(v.action==="submit"){
    const type=String(v.type||""),description=String(v.description||"").trim();
    if(!["bug","feature"].includes(type)||description.length<5||description.length>5000)return response({error:"Choose a type and provide a description (5–5000 characters)."},400);
    let image_url=null;
    if(v.image){
      const mime=String(v.image.mime||"");
      if(!["image/png","image/jpeg","image/webp"].includes(mime))return response({error:"Only PNG, JPG, or WebP screenshots are supported."},400);
      const encoded=String(v.image.base64||"");
      if(encoded.length>2800000||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))return response({error:"Screenshot must be under 2 MB."},400);
      const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
      if(bytes.length>2000000)return response({error:"Screenshot must be under 2 MB."},400);
      const file="feedback/"+crypto.randomUUID()+(mime==="image/png"?".png":mime==="image/webp"?".webp":".jpg");
      const up=await fetch(url+"/storage/v1/object/glep-artwork/"+file,{method:"POST",headers:{...auth,"Content-Type":mime,"x-upsert":"false"},body:bytes});
      if(!up.ok)return response({error:"Screenshot upload failed. Please try again."},500);
      image_url=url+"/storage/v1/object/public/glep-artwork/"+file;
    }
    const saved=await db("glep_feedback","POST",{request_type:type,description,image_url,creator_name:user.creator_name});
    if(saved.length!==1)return response({error:"Report was not stored."},500);
    return response({ok:true,id:saved[0].id,created_at:saved[0].created_at});
  }
  if(v.action==="list"){
    if(user.creator_name!=="Francesca")return response({error:"Only Francesca can review requests. Enter her creator code."},403);
    const items=await db("glep_feedback?select=id,request_type,description,image_url,creator_name,review_status,created_at&order=created_at.desc&limit=500");
    return response({ok:true,items});
  }
  if(v.action==="update"){
    if(user.creator_name!=="Francesca")return response({error:"Only Francesca can review requests. Enter her creator code."},403);
    if(!/^[a-f0-9-]{36}$/i.test(String(v.id||""))||!["new","reviewing","done"].includes(v.status))return response({error:"Invalid report or status."},400);
    const saved=await db("glep_feedback?id=eq."+v.id,"PATCH",{review_status:v.status});
    if(saved.length!==1)return response({error:"Status was not stored."},500);
    return response({ok:true,id:saved[0].id,status:saved[0].review_status});
  }
  return response({error:"Unknown operation"},400);
 }catch(e){return response({error:e instanceof Error?e.message:"Request failed"},500)}
});