import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const origin="https://fc3p0.github.io";
const cors={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Headers":"content-type,apikey,authorization","Access-Control-Allow-Methods":"POST,OPTIONS"};
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store, no-cache, must-revalidate"}});
const url=Deno.env.get("SUPABASE_URL")!,key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const hdr={apikey:key,Authorization:"Bearer "+key};
async function sha(t:string){return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t)))).map(v=>v.toString(16).padStart(2,"0")).join("")}
async function call(path:string,method="GET",body?:unknown){const r=await fetch(url+"/rest/v1/"+path,{method,headers:{...hdr,"Content-Type":"application/json",Prefer:"return=representation"},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error("Database operation failed");return await r.json()}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{headers:cors});
 if(req.method!=="POST")return response({error:"Method not allowed"},405);
 if(req.headers.get("Origin")!==origin)return response({error:"Origin not permitted"},403);
 try{
  const raw=await req.text();if(raw.length>7500000)return response({error:"Request too large"},413);
  const data=JSON.parse(raw);
  const code=String(data.password||"").trim().toLowerCase();
  if(code.length<6||code.length>100)return response({error:"Invalid admin password"},403);
  const hash=await sha("glep-v1:"+code);
  const who=await call("glep_creator_codes?code_hash=eq."+hash+"&active=eq.true&select=creator_name,is_admin");
  if(who?.[0]?.is_admin!==true)return response({error:"Invalid admin password"},403);
  switch(data.action){
   case "list":{
     const [cards,codes,artworks]=await Promise.all([call("glep_cards?select=id,name,card_type,card_data,creator_name,review_status,review_note,created_at,artwork_url&order=created_at.desc&limit=300"),call("glep_creator_codes?select=id,creator_name,active,is_admin,created_at&order=created_at.asc"),call("glep_artworks?select=id,name,tags,image_path,creator_name,created_at&order=created_at.desc&limit=300")]);
     return response({cards,codes,artworks});
   }
   case "review":{
     const id=String(data.id||"");if(!/^[a-f0-9-]{36}$/i.test(id))return response({error:"Bad ID"},400);
     const status=String(data.status||"");if(!["approved","denied","pending"].includes(status))return response({error:"Invalid status"},400);
     const current=await call("glep_cards?id=eq."+id+"&select=id,card_data,name,card_type");
     if(current.length!==1)return response({error:"Card not found"},404);
     const c=current[0],patch:any={review_status:status,reviewed_at:new Date().toISOString(),review_note:String(data.note||"").slice(0,500)};
     if(data.artworkImage){
       const match=String(data.artworkImage).match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
       if(!match)return response({error:"Use PNG, JPG or WebP card artwork"},400);
       const bytes=Uint8Array.from(atob(match[2]),x=>x.charCodeAt(0));
       if(bytes.length>5*1024*1024)return response({error:"Card artwork must be under 5MB"},413);
       const path="creators/"+crypto.randomUUID()+"."+(match[1]==="jpeg"?"jpg":match[1]);
       const uploaded=await fetch(url+"/storage/v1/object/glep-artwork/"+path,{method:"POST",headers:{...hdr,"Content-Type":"image/"+match[1],"x-upsert":"false"},body:bytes});
       if(!uploaded.ok)return response({error:"Card artwork upload failed"},500);
       patch.artwork_url=url+"/storage/v1/object/public/glep-artwork/"+path;
       patch.card_data={...c.card_data,image:"",strokes:[]};
     }
     if(data.name!==undefined)patch.name=String(data.name).trim().slice(0,100)||c.name;
     if(data.card_type!==undefined){if(!["attack","modifier","fate"].includes(data.card_type))return response({error:"Invalid card type"},400);patch.card_type=data.card_type}
     if(data.card_data!==undefined){const d=data.card_data;if(!d||typeof d!=="object"||Array.isArray(d))return response({error:"Invalid card data"},400);patch.card_data=d}
     const updated=await call("glep_cards?id=eq."+id,"PATCH",patch);if(!updated?.length||updated[0].review_status!==status)return response({error:"Approval did not persist"},500);return response({ok:true,card:updated[0]});
   }
   case "edit_artwork":{
     const id=String(data.id||"");
     if(!/^[a-f0-9-]{36}$/i.test(id))return response({error:"Invalid artwork ID"},400);
     const changes:any={};
     if(data.name!==undefined)changes.name=String(data.name||"").trim().slice(0,100);
     if(data.tags!==undefined)changes.tags=String(data.tags||"").trim().slice(0,200);
     if(!Object.keys(changes).length||data.name!==undefined&&!changes.name)return response({error:"Valid title or tags required"},400);
     const result=await call("glep_artworks?id=eq."+id,"PATCH",changes);
     return response({ok:!!result.length});
   }
   case "replace_artwork":{
     const id=String(data.id||"");
     if(!/^[a-f0-9-]{36}$/i.test(id))return response({error:"Invalid artwork ID"},400);
     const current=await call("glep_artworks?id=eq."+id+"&select=id,image_path");
     if(current.length!==1)return response({error:"Artwork not found"},404);
     const match=String(data.image||"").match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
     if(!match)return response({error:"Use PNG, JPG or WebP"},400);
     const bytes=Uint8Array.from(atob(match[2]),x=>x.charCodeAt(0));
     if(bytes.length>5*1024*1024)return response({error:"Image must be 5 MB or less"},413);
     const path="creators/"+crypto.randomUUID()+"."+(match[1]==="jpeg"?"jpg":match[1]);
     const storage=await fetch(url+"/storage/v1/object/glep-artwork/"+path,{method:"POST",headers:{...hdr,"Content-Type":"image/"+match[1],"x-upsert":"false"},body:bytes});
     if(!storage.ok)return response({error:"Image storage failed"},500);
     await call("glep_artworks?id=eq."+id,"PATCH",{image_path:path});
     return response({ok:true,path});
   }
   case "delete_artwork":{
     const id=String(data.id||"");
     if(!/^[a-f0-9-]{36}$/i.test(id))return response({error:"Invalid artwork ID"},400);
     // Remove metadata; storage objects are retained for cards that might reference them.
     const deleted=await call("glep_artworks?id=eq."+id,"DELETE");
     return response({ok:true,removed:deleted.length});
   }
   case "add_creator":{
     const name=String(data.name||"").trim().slice(0,60),newCode=String(data.code||"").trim().toLowerCase();
     if(name.length<2||!/[a-z0-9]/.test(name)||! /^[a-z0-9_-]{6,64}$/.test(newCode))return response({error:"Name must be 2+ chars; code 6–64 letters, numbers, _ or -"},400);
     const code_hash=await sha("glep-v1:"+newCode);
     const found=await call("glep_creator_codes?code_hash=eq."+code_hash+"&select=creator_name");
     if(found.length)return response({error:"That code already exists"},409);
     const inserted=await call("glep_creator_codes","POST",{code_hash,creator_name:name,active:true});const verified=await call("glep_creator_codes?code_hash=eq."+code_hash+"&select=id,creator_name,active");if(!inserted?.length||verified.length!==1||verified[0].creator_name!==name)return response({error:"Creator could not be verified after saving"},500);return response({ok:true,id:verified[0].id,creator_name:name});
   }
   case "edit_creator":{
     const id=String(data.id||"");
     if(!/^[a-f0-9-]{36}$/i.test(id))return response({error:"Invalid creator ID"},400);
     const original=await call("glep_creator_codes?id=eq."+id+"&select=id,creator_name,is_admin,code_hash");
     if(original.length!==1)return response({error:"Creator not found"},404);
     const old=original[0];
     const name=String(data.name||"").trim().slice(0,60);
     const newCode=String(data.code||"").trim().toLowerCase();
     if(name.length<2)return response({error:"Creator name must have at least two characters"},400);
     if(newCode && !/^[a-z0-9_-]{6,64}$/.test(newCode))return response({error:"New code must have 6–64 letters, numbers, underscores or hyphens"},400);
     if(old.is_admin && newCode)return response({error:"Billy's admin code cannot be rotated here"},400);
     const patch:any={creator_name:name};
     if(newCode){
       const newHash=await sha("glep-v1:"+newCode);
       const conflict=await call("glep_creator_codes?code_hash=eq."+newHash+"&select=id");
       if(conflict.some((c:any)=>c.id!==id))return response({error:"That creator code is already assigned"},409);
       patch.code_hash=newHash;
     }
     await call("glep_creator_codes?id=eq."+id,"PATCH",patch);
     return response({ok:true,creator_name:name,rotated:!!newCode});
   }
   case "set_creator":{
     const id=String(data.id||"");
     if(!/^[a-f0-9-]{36}$/i.test(id))return response({error:"Creator ID required"},400);
     const updated=await call("glep_creator_codes?id=eq."+id,"PATCH",{active:!!data.active});
     return response({ok:true,updated:updated.length});
   }
   default:return response({error:"Unknown action"},400);
  }
 }catch(e){return response({error:"Admin request failed"},500)}
});