
BEGIN;
DO $test$
DECLARE a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();r jsonb;v jsonb;v2 jsonb;rr integer;rounds integer:=0;h jsonb;
BEGIN
 INSERT INTO public.glep_beta_sessions(id,token_hash,creator_name) VALUES
 (a,encode(extensions.digest(a::text,'sha256'),'hex'),'Billy'),(b,encode(extensions.digest(b::text,'sha256'),'hex'),'Francesca');
 r:=public.glep_beta_create_room(a,'PLAYA2');
 ASSERT r->'room'->>'code'='PLAYA2';
 ASSERT public.glep_beta_join_room(b,'PLAYA2')='OK';
 ASSERT public.glep_beta_game(a,'game_status')->>'canStart'='true';
 ASSERT public.glep_beta_game(b,'game_status')->>'canStart'='true';
 v:=public.glep_beta_game(b,'game_start','{"target":100}');
 ASSERT v->'game'->>'phase'='select','Second player cannot start';
 ASSERT public.glep_beta_game(a,'game_start','{"target":100}') ? 'error','Concurrent restart accepted';
 v:=public.glep_beta_game(a,'game_status');
 ASSERT v->'game'->>'phase'='select';
 ASSERT jsonb_array_length(v->'game'->'hand'->'attack')=2;
 ASSERT jsonb_array_length(v->'game'->'hand'->'modifier')=2;
 ASSERT NOT ((v->'game'->'players'->1) ? 'hand');
 ASSERT NOT ((v->'game') ? 'attackDeck');
 LOOP
  rr:=(v->'game'->>'round')::integer; rounds:=rounds+1; ASSERT rounds<10,'match never ends';
  h:=v->'game'->'hand';
  v:=public.glep_beta_game(a,'game_play',jsonb_build_object('round',rr,'attack',h->'attack'->0->>'id','modifier',h->'modifier'->0->>'id'));
  ASSERT v->'game'->>'phase'='select';
  v2:=public.glep_beta_game(b,'game_status');
  ASSERT v2->'game'->'players'->0->'play'='null'::jsonb,'opponent selection leaked';
  ASSERT NOT (v2->'game'->'players'->0 ? 'hand'),'opponent hand leaked';
  ASSERT public.glep_beta_game(a,'game_play',jsonb_build_object('round',rr,'attack','fake','modifier','fake')) ? 'error','duplicate submission accepted';
  h:=v2->'game'->'hand';
  v2:=public.glep_beta_game(b,'game_play',jsonb_build_object('round',rr,'attack',h->'attack'->0->>'id','modifier',h->'modifier'->0->>'id'));
  ASSERT v2->'game'->>'phase'='reveal';
  ASSERT v2->'game'->'players'->0->'play'<>'null'::jsonb;
  v:=public.glep_beta_game(a,'game_status');
  v:=public.glep_beta_game(a,'game_adjust',jsonb_build_object('round',rr,'damage',20,'gems',0));
  ASSERT public.glep_beta_game(b,'game_confirm',jsonb_build_object('round',rr,'revision',-1,'confirmed',true)) ? 'error','stale confirmation accepted';
  v:=public.glep_beta_game(a,'game_confirm',jsonb_build_object('round',rr,'revision',v->'game'->>'revision','confirmed',true));
  v2:=public.glep_beta_game(b,'game_confirm',jsonb_build_object('round',rr,'revision',v->'game'->>'revision','confirmed',true));
  ASSERT v2->'game'->>'phase' IN ('result','finished');
  ASSERT (v2->'game'->'players'->0->>'gems')::integer>0;
  EXIT WHEN v2->'game'->>'phase'='finished';
  v:=public.glep_beta_game(a,'game_next',jsonb_build_object('round',rr));
  ASSERT v->'game'->>'phase'='result';
  v2:=public.glep_beta_game(b,'game_next',jsonb_build_object('round',rr));
  v:=public.glep_beta_game(a,'game_status');
  ASSERT (v->'game'->>'round')::integer=rr+1;
 END LOOP;
 ASSERT v2->'game'->>'reason'='Deck exhausted';
 ASSERT v2->'game'->>'winner'='Billy';
 ASSERT NOT has_function_privilege('anon','public.glep_beta_game(uuid,text,jsonb)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.glep_beta_game(uuid,text,jsonb)','EXECUTE');
END $test$;
ROLLBACK;