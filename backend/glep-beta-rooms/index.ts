// Supabase Edge Function: glep-beta-rooms. Beta rooms API; isolated tables, existing creator-code verification.
// This API issues opaque short-lived session tokens and never trusts frontend-only unlock state.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const ALLOWED_ORIGIN=Deno.env.get("GLEP_BETA_ALLOWED_ORIGIN")??"https://fc3p0.github.io";
const headers={"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Access-Control-Allow-Headers":"content-type,authorization,apikey","Access-Control-Allow-Methods":"POST,OPTIONS"};
const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
const bytes=(n:number)=>crypto.getRandomValues(new Uint8Array(n));
const hex=(a:Uint8Array)=>Array.from(a).map(x=>x.toString(16).padStart(2,"0")).join("");
const hash=async(s:string)=>hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))));
const roomCode=()=>{const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";return Array.from(bytes(6),v=>chars[v%chars.length]).join("")};
async function session(req:Request) {
 const token=req.headers.get("Authorization")?.replace(/^Bearer /i,"")??"";
 if(!/^[a-f0-9]{64}$/.test(token))return null;
 const digest=await hash(token);
 const {data,error}=await db.from("glep_beta_sessions").select("id,creator_name,room_id,expires_at").eq("token_hash",digest).gt("expires_at",new Date().toISOString()).maybeSingle();
 return error?null:data;
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers});
 if(req.method!=="POST")return respond({error:"Method not allowed"},405);
 if(!ALLOWED_ORIGIN||req.headers.get("Origin")!==ALLOWED_ORIGIN)return respond({error:"Origin not permitted"},403);
 let input:any;try{const raw=await req.text();if(raw.length>2048)return respond({error:"Request too large"},413);input=JSON.parse(raw)}catch{return respond({error:"Invalid JSON"},400)}
 const action=input?.action;
 if(action==="login"){
  if(typeof input.code!=="string"||input.code.length<6||input.code.length>100)return respond({error:"Invalid credentials"},403);
  const digest=await hash("glep-v1:"+input.code.trim().toLowerCase());
  const {data:admitted,error:limitError}=await db.rpc("glep_beta_admit_login",{p_key:digest});
  if(limitError)return respond({error:"Login temporarily unavailable"},503);
  if(!admitted)return respond({error:"Too many attempts; try again later."},429);
  const {data:creators,error}=await db.from("glep_creator_codes").select("creator_name").eq("code_hash",digest).eq("active",true).limit(1);
  if(error)return respond({error:"Could not verify access"},503);
  const name=creators?.[0]?.creator_name;
  if(name!=="Billy"&&name!=="Francesca")return respond({error:"Invalid credentials"},403);
  const token=hex(bytes(32)),token_hash=await hash(token);
  const {error:saveError}=await db.from("glep_beta_sessions").insert({token_hash,creator_name:name});
  if(saveError)return respond({error:"Unable to start session"},503);
  return respond({ok:true,token,creator:name});
 }
 const actor=await session(req);if(!actor)return respond({error:"Session expired. Sign in again."},401);
 if(typeof action==="string"&&["game_status","game_start","game_play","game_fate","game_adjust","game_confirm","game_next"].includes(action)){
  const {data:result,error}=await db.rpc("glep_beta_game",{p_session:actor.id,p_action:action,p_payload:input});
  if(error){console.error("Game action failed",action,error.code,error.message);return respond({error:"Unable to update the match. Try again."},503);}
  if(result?.error)return respond({error:result.error},409);
  return respond({ok:true,...result});
 }
 if(action==="create"){
  for(let attempt=0;attempt<5;attempt++){
   const {data:result,error}=await db.rpc("glep_beta_create_room",{p_session:actor.id,p_code:roomCode()});
   if(error){if(error.code==="23505")continue;return respond({error:"Unable to create room"},503)}
   if(result?.error)return respond({error:result.error==="SESSION_EXPIRED"?"Session expired. Sign in again.":"Leave your current room first."},result.error==="SESSION_EXPIRED"?401:409);
   return respond({ok:true,...result});
  }
  return respond({error:"Unable to allocate room code"},503);
 }
 if(action==="join"){
  const code=String(input.code??"").trim().toUpperCase();
  if(!/^[A-Z2-9]{6}$/.test(code))return respond({error:"Enter a valid six-character room code"},400);
  const {data:result,error}=await db.rpc("glep_beta_join_room",{p_session:actor.id,p_code:code});
  if(error)return respond({error:"Unable to join room"},503);
  if(result!=="OK")return respond({error:result==="ROOM_FULL"?"Room is full":result==="ALREADY_IN_ROOM"?"Leave your current room first.":"Room not found or not accepting players"},409);
  return respond({ok:true});
 }
 if(action==="status"){
  const {data:result,error}=await db.rpc("glep_beta_room_status",{p_session:actor.id});
  if(error)return respond({error:"Unable to refresh room"},503);
  if(result?.error)return respond({error:"Session expired. Sign in again."},401);
  const {data:game,error:gameError}=await db.rpc("glep_beta_game",{p_session:actor.id,p_action:"game_status",p_payload:{}});
  if(gameError){console.error("Game status failed",gameError.code);return respond({error:"Unable to refresh the match"},503);}
  return respond({ok:true,...result,...game});
 }
 if(action==="logout"){
  const {error}=await db.rpc("glep_beta_logout",{p_session:actor.id});
  if(error)return respond({error:"Unable to sign out"},503);
  return respond({ok:true});
 }
 if(action==="leave"){
  const {data:result,error}=await db.rpc("glep_beta_leave_room",{p_session:actor.id});
  if(error)return respond({error:"Unable to leave room"},503);
  return respond({ok:true,result});
 }
 return respond({error:"Unknown action"},400);
});
