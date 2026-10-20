import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const origin="https://fc3p0.github.io";
const cors={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"content-type,authorization,apikey","Access-Control-Allow-Methods":"POST,OPTIONS"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 if(req.headers.get("Origin")!==origin)return reply({error:"Origin not permitted"},403);
 try{
  const raw=await req.text();if(raw.length>1024)return reply({error:"Invalid request"},400);
  const input=JSON.parse(raw);
  if(input.action!=="unlock"||typeof input.code!=="string")return reply({error:"Invalid request"},400);
  const code=input.code.trim().toLowerCase();
  if(code.length<6||code.length>100)return reply({error:"Invalid access code"},403);
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("glep-v1:"+code));
  const hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
  const base=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const r=await fetch(base+"/rest/v1/glep_creator_codes?code_hash=eq."+hash+"&active=eq.true&select=creator_name",{headers:{apikey:key,Authorization:"Bearer "+key}});
  if(!r.ok)return reply({error:"Unable to verify access"},503);
  const people=await r.json();
  const name=people?.[0]?.creator_name;
  if(name!=="Billy"&&name!=="Francesca")return reply({error:"Invalid access code"},403);
  return reply({ok:true,creator:name});
 }catch{return reply({error:"Unable to verify access"},500)}
});