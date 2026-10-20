
CREATE TABLE IF NOT EXISTS public.glep_beta_matches(
 room_id uuid PRIMARY KEY REFERENCES public.glep_beta_rooms(id) ON DELETE CASCADE,
 state jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.glep_beta_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.glep_beta_matches FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.glep_beta_matches TO service_role;

CREATE OR REPLACE FUNCTION public.glep_beta_game(p_session uuid,p_action text DEFAULT 'game_status',p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $game$
DECLARE
 actor public.glep_beta_sessions%rowtype;
 room public.glep_beta_rooms%rowtype;
 st jsonb; ps jsonb; pl jsonb; opp jsonb; deck_a jsonb; deck_m jsonb; deck_f jsonb;
 hands jsonb; hands_a jsonb; hands_m jsonb; plays jsonb; results jsonb; card_a jsonb; card_m jsonb; fate jsonb;
 ids uuid[]; names text[]; host uuid; me integer; other integer; i integer; j integer; n integer;
 target integer; pool integer; round_no integer; dmg integer; stars integer; delta integer; gem_delta integer;
 scores integer[]; totals integer[]; winner integer; ended boolean; ready_count integer;
 attack_id text; modifier_id text; reason text; choosing boolean;
BEGIN
 SELECT * INTO actor FROM public.glep_beta_sessions WHERE id=p_session AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','Session expired. Sign in again.'); END IF;
 IF actor.room_id IS NULL THEN RETURN jsonb_build_object('game',NULL); END IF;
 SELECT * INTO room FROM public.glep_beta_rooms WHERE id=actor.room_id AND status<>'closed' AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('game',NULL); END IF;
 SELECT array_agg(id ORDER BY created_at,id),array_agg(creator_name ORDER BY created_at,id)
 INTO ids,names FROM public.glep_beta_sessions WHERE room_id=room.id AND expires_at>now();
 host:=CASE WHEN room.host_session=ANY(ids) THEN room.host_session ELSE ids[1] END;
 SELECT state INTO st FROM public.glep_beta_matches WHERE room_id=room.id FOR UPDATE;

 IF p_action='game_start' THEN
  IF coalesce(array_length(ids,1),0)<>2 THEN RETURN jsonb_build_object('error','Two players must be in the room.'); END IF;
  IF st IS NOT NULL AND st->>'phase' NOT IN ('finished','abandoned') THEN RETURN jsonb_build_object('error','A match is already in progress.'); END IF;
  IF coalesce(p_payload->>'target','')!~'^[0-9]{1,3}$' THEN RETURN jsonb_build_object('error','Choose a gem target from 1 to 100.'); END IF;
  target:=(p_payload->>'target')::integer;
  IF target<1 OR target>100 THEN RETURN jsonb_build_object('error','Choose a gem target from 1 to 100.'); END IF;
  SELECT
   coalesce(jsonb_agg(card ORDER BY random()) FILTER(WHERE kind='attack'),'[]'::jsonb),
   coalesce(jsonb_agg(card ORDER BY random()) FILTER(WHERE kind='modifier'),'[]'::jsonb),
   coalesce(jsonb_agg(card ORDER BY random()) FILTER(WHERE kind='fate'),'[]'::jsonb)
  INTO deck_a,deck_m,deck_f FROM (
   SELECT card_type kind,jsonb_build_object('id',id,'name',name,'type',card_type,
    'damage',coalesce((card_data->>'damage')::integer,0),
    'stars',CASE WHEN card_type='fate' THEN 0 ELSE coalesce((card_data->>'stars')::integer,0) END,
    'effect',coalesce(card_data->>'effect',''),'art',artwork_url,
    'element1',card_data->>'element1','element2',card_data->>'element2') card
   FROM public.glep_cards WHERE review_status='approved' AND card_type IN ('attack','modifier','fate')
  ) cards;
  IF jsonb_array_length(deck_a)<4 OR jsonb_array_length(deck_m)<4 THEN
   RETURN jsonb_build_object('error','The approved deck needs at least four attacks and four modifiers for two players.');
  END IF;
  ps:='[]'::jsonb;
  FOR i IN 1..2 LOOP
   hands_a:=jsonb_build_array(deck_a->0,deck_a->1); deck_a:=(deck_a-0)-0;
   hands_m:=jsonb_build_array(deck_m->0,deck_m->1); deck_m:=(deck_m-0)-0;
   ps:=ps||jsonb_build_array(jsonb_build_object('session',ids[i],'name',names[i],'gems',0,
    'hand',jsonb_build_object('attack',hands_a,'modifier',hands_m),'play',NULL,'next',false));
  END LOOP;
  pool:=floor(random()*6)::integer+1;
  st:=jsonb_build_object('revision',0,'phase','select','round',1,'target',target,'pool',pool,'carry',0,
   'players',ps,'attackDeck',deck_a,'modifierDeck',deck_m,'fateDeck',deck_f,'results','[]'::jsonb,'winner',NULL);
  INSERT INTO public.glep_beta_matches(room_id,state) VALUES(room.id,st)
  ON CONFLICT(room_id) DO UPDATE SET state=excluded.state,updated_at=now();
 END IF;

 IF st IS NULL THEN RETURN jsonb_build_object('game',NULL,'canStart',p_session=ANY(ids)); END IF;
 ps:=st->'players'; me:=NULL;
 FOR i IN 0..1 LOOP
  IF ps->i->>'session'=p_session::text THEN me:=i; END IF;
 END LOOP;
 IF me IS NULL THEN
  IF p_action<>'game_status' THEN RETURN jsonb_build_object('error','This match belongs to the previous room participants.'); END IF;
  IF st->>'phase' NOT IN ('finished','abandoned') THEN
   st:=jsonb_set(st,'{phase}','"abandoned"'::jsonb);
   UPDATE public.glep_beta_matches SET state=st,updated_at=now() WHERE room_id=room.id;
  END IF;
  RETURN jsonb_build_object('game',NULL,'canStart',p_session=ANY(ids));
 END IF;
 other:=1-me;
 IF st->>'phase' NOT IN ('finished','abandoned') AND
  (NOT ((ps->0->>'session')::uuid=ANY(ids)) OR NOT ((ps->1->>'session')::uuid=ANY(ids))) THEN
   st:=jsonb_set(st,'{phase}','"abandoned"'::jsonb);
 END IF;

 IF p_action='game_play' THEN
  IF st->>'phase'<>'select' THEN RETURN jsonb_build_object('error','This round is no longer accepting cards.'); END IF;
  IF coalesce(p_payload->>'round','')<>st->>'round' THEN RETURN jsonb_build_object('error','The round changed. Refresh your hand.'); END IF;
  IF ps->me->'play'<>'null'::jsonb THEN RETURN jsonb_build_object('error','Your cards are already locked in.'); END IF;
  attack_id:=p_payload->>'attack'; modifier_id:=p_payload->>'modifier';
  SELECT value INTO card_a FROM jsonb_array_elements(ps->me->'hand'->'attack') WHERE value->>'id'=attack_id;
  SELECT value INTO card_m FROM jsonb_array_elements(ps->me->'hand'->'modifier') WHERE value->>'id'=modifier_id;
  IF card_a IS NULL OR card_m IS NULL THEN RETURN jsonb_build_object('error','Select one attack and one modifier from your hand.'); END IF;
  pl:=jsonb_build_object('attack',card_a,'modifier',card_m,'damage',(card_a->>'damage')::integer+(card_m->>'damage')::integer,
   'stars',(card_a->>'stars')::integer+(card_m->>'stars')::integer,'damageAdjustment',0,'gemAdjustment',0,'confirmed',false,'fateChosen',false,'fate',NULL);
  ps:=jsonb_set(ps,ARRAY[me::text,'play'],pl);
  SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO hands_a FROM jsonb_array_elements(ps->me->'hand'->'attack') WHERE value->>'id'<>attack_id;
  SELECT coalesce(jsonb_agg(value),'[]'::jsonb) INTO hands_m FROM jsonb_array_elements(ps->me->'hand'->'modifier') WHERE value->>'id'<>modifier_id;
  ps:=jsonb_set(ps,ARRAY[me::text,'hand'],jsonb_build_object('attack',hands_a,'modifier',hands_m));
  IF ps->0->'play'<>'null'::jsonb AND ps->1->'play'<>'null'::jsonb THEN
   st:=jsonb_set(st,'{phase}','"reveal"'::jsonb);
   deck_f:=st->'fateDeck';
   IF ps->0->'play'->>'damage'=ps->1->'play'->>'damage' THEN
    FOR i IN 0..1 LOOP
     fate:=CASE WHEN jsonb_array_length(deck_f)>0 THEN deck_f->0 ELSE 'null'::jsonb END;
     IF fate<>'null'::jsonb THEN deck_f:=deck_f-0; END IF;
     ps:=jsonb_set(ps,ARRAY[i::text,'play','fate'],fate);
     ps:=jsonb_set(ps,ARRAY[i::text,'play','fateChosen'],'true'::jsonb);
    END LOOP;
   END IF;
   st:=jsonb_set(st,'{fateDeck}',deck_f);
  END IF;
  st:=jsonb_set(st,'{players}',ps);
 ELSIF p_action='game_fate' THEN
  IF st->>'phase'<>'reveal' OR coalesce(p_payload->>'round','')<>st->>'round' THEN RETURN jsonb_build_object('error','Fate is only available during this round reveal.'); END IF;
  pl:=ps->me->'play';
  IF (pl->>'stars')::integer<10 OR (pl->>'fateChosen')::boolean THEN RETURN jsonb_build_object('error','Fate is unavailable or already drawn.'); END IF;
  IF (ps->0->'play'->>'confirmed')::boolean OR (ps->1->'play'->>'confirmed')::boolean THEN RETURN jsonb_build_object('error','Undo confirmation before drawing Fate.'); END IF;
  deck_f:=st->'fateDeck';
  IF jsonb_array_length(deck_f)=0 THEN RETURN jsonb_build_object('error','The Fate deck is empty.'); END IF;
  pl:=jsonb_set(pl,'{fate}',deck_f->0);
  pl:=jsonb_set(pl,'{fateChosen}','true'::jsonb);
  ps:=jsonb_set(ps,ARRAY[me::text,'play'],pl);
  st:=jsonb_set(jsonb_set(st,'{players}',ps),'{fateDeck}',deck_f-0);
  st:=jsonb_set(st,'{revision}',to_jsonb((st->>'revision')::integer+1));
 ELSIF p_action='game_adjust' THEN
  IF st->>'phase'<>'reveal' OR coalesce(p_payload->>'round','')<>st->>'round' THEN RETURN jsonb_build_object('error','Adjustments are only available during this round reveal.'); END IF;
  IF coalesce(p_payload->>'damage','')!~'^-?[0-9]{1,3}$' OR coalesce(p_payload->>'gems','')!~'^-?[0-9]{1,3}$' THEN RETURN jsonb_build_object('error','Enter whole-number adjustments.'); END IF;
  delta:=(p_payload->>'damage')::integer; gem_delta:=(p_payload->>'gems')::integer;
  IF abs(delta)>100 OR abs(gem_delta)>100 THEN RETURN jsonb_build_object('error','Adjustments must be between -100 and 100.'); END IF;
  ps:=jsonb_set(ps,ARRAY[me::text,'play','damageAdjustment'],to_jsonb(delta));
  ps:=jsonb_set(ps,ARRAY[me::text,'play','gemAdjustment'],to_jsonb(gem_delta));
  FOR i IN 0..1 LOOP ps:=jsonb_set(ps,ARRAY[i::text,'play','confirmed'],'false'::jsonb); END LOOP;
  st:=jsonb_set(st,'{players}',ps);
  st:=jsonb_set(st,'{revision}',to_jsonb((st->>'revision')::integer+1));
 ELSIF p_action='game_confirm' THEN
  IF st->>'phase'<>'reveal' OR coalesce(p_payload->>'round','')<>st->>'round' THEN RETURN jsonb_build_object('error','This round is no longer awaiting confirmation.'); END IF;
  IF coalesce(p_payload->>'revision','')<>st->>'revision' THEN RETURN jsonb_build_object('error','Effects changed. Review the updated totals before confirming.'); END IF;
  ps:=jsonb_set(ps,ARRAY[me::text,'play','confirmed'],to_jsonb(coalesce((p_payload->>'confirmed')::boolean,true)));
  st:=jsonb_set(st,'{players}',ps);
  IF (ps->0->'play'->>'confirmed')::boolean AND (ps->1->'play'->>'confirmed')::boolean THEN
   totals:=ARRAY[
    (ps->0->'play'->>'damage')::integer+(ps->0->'play'->>'damageAdjustment')::integer,
    (ps->1->'play'->>'damage')::integer+(ps->1->'play'->>'damageAdjustment')::integer];
   pool:=(st->>'pool')::integer;
   winner:=CASE WHEN totals[1]>totals[2] THEN 0 WHEN totals[2]>totals[1] THEN 1 ELSE NULL END;
   FOR i IN 0..1 LOOP
    dmg:=greatest(0,(ps->i->>'gems')::integer+(ps->i->'play'->>'gemAdjustment')::integer+CASE WHEN winner=i THEN pool ELSE 0 END);
    ps:=jsonb_set(ps,ARRAY[i::text,'gems'],to_jsonb(dmg));
   END LOOP;
   st:=jsonb_set(st,'{carry}',to_jsonb(CASE WHEN winner IS NULL THEN pool ELSE 0 END));
   results:=st->'results'||jsonb_build_array(jsonb_build_object('round',(st->>'round')::integer,'pool',pool,'winner',CASE WHEN winner IS NULL THEN NULL ELSE ps->winner->>'name' END,'plays',
    jsonb_build_array(jsonb_build_object('name',ps->0->>'name','cards',ps->0->'play'),jsonb_build_object('name',ps->1->>'name','cards',ps->1->'play'))));
   st:=jsonb_set(st,'{results}',results);
   ended:=(ps->0->>'gems')::integer>=(st->>'target')::integer OR (ps->1->>'gems')::integer>=(st->>'target')::integer;
   reason:=CASE WHEN ended THEN 'Gem target reached' ELSE NULL END;
   IF NOT ended THEN
    deck_a:=st->'attackDeck'; deck_m:=st->'modifierDeck';
    FOR i IN 0..1 LOOP
     hands_a:=ps->i->'hand'->'attack'; hands_m:=ps->i->'hand'->'modifier';
     IF jsonb_array_length(deck_a)>0 THEN hands_a:=hands_a||jsonb_build_array(deck_a->0); deck_a:=deck_a-0; END IF;
     IF jsonb_array_length(deck_m)>0 THEN hands_m:=hands_m||jsonb_build_array(deck_m->0); deck_m:=deck_m-0; END IF;
     ps:=jsonb_set(ps,ARRAY[i::text,'hand'],jsonb_build_object('attack',hands_a,'modifier',hands_m));
     IF jsonb_array_length(hands_a)=0 OR jsonb_array_length(hands_m)=0 THEN ended:=true;reason:='Deck exhausted'; END IF;
    END LOOP;
    st:=jsonb_set(jsonb_set(st,'{attackDeck}',deck_a),'{modifierDeck}',deck_m);
   END IF;
   st:=jsonb_set(st,'{players}',ps);
   st:=jsonb_set(st,'{phase}',to_jsonb(CASE WHEN ended THEN 'finished' ELSE 'result' END));
   IF ended THEN
    winner:=CASE WHEN (ps->0->>'gems')::integer>(ps->1->>'gems')::integer THEN 0 WHEN (ps->1->>'gems')::integer>(ps->0->>'gems')::integer THEN 1 ELSE NULL END;
    st:=jsonb_set(st,'{winner}',coalesce(to_jsonb(ps->winner->>'name'),'null'::jsonb));
    st:=jsonb_set(st,'{reason}',to_jsonb(reason));
   END IF;
  END IF;
 ELSIF p_action='game_next' THEN
  IF st->>'phase'<>'result' OR coalesce(p_payload->>'round','')<>st->>'round' THEN RETURN jsonb_build_object('error','Wait for the current round to finish.'); END IF;
  ps:=jsonb_set(ps,ARRAY[me::text,'next'],'true'::jsonb);
  IF (ps->0->>'next')::boolean AND (ps->1->>'next')::boolean THEN
   FOR i IN 0..1 LOOP
    ps:=jsonb_set(ps,ARRAY[i::text,'play'],'null'::jsonb);
    ps:=jsonb_set(ps,ARRAY[i::text,'next'],'false'::jsonb);
   END LOOP;
   st:=jsonb_set(st,'{phase}','"select"'::jsonb);
   st:=jsonb_set(st,'{round}',to_jsonb((st->>'round')::integer+1));
   st:=jsonb_set(st,'{pool}',to_jsonb(floor(random()*6)::integer+1+(st->>'carry')::integer));
  END IF;
  st:=jsonb_set(st,'{players}',ps);
 ELSIF p_action NOT IN ('game_status','game_start') THEN
  RETURN jsonb_build_object('error','Unknown game action.');
 END IF;
 UPDATE public.glep_beta_matches SET state=st,updated_at=now() WHERE room_id=room.id;
 ps:=st->'players'; results:='[]'::jsonb;
 FOR i IN 0..1 LOOP
  pl:=ps->i;
  results:=results||jsonb_build_array(jsonb_build_object('name',pl->>'name','gems',(pl->>'gems')::integer,
   'you',i=me,'locked',pl->'play'<>'null'::jsonb,'next',(pl->>'next')::boolean,
   'play',CASE WHEN st->>'phase' IN ('select','abandoned') THEN 'null'::jsonb ELSE pl->'play' END));
 END LOOP;
 RETURN jsonb_build_object('canStart',p_session=ANY(ids),'game',jsonb_build_object(
  'revision',(st->>'revision')::integer,'phase',st->>'phase','round',(st->>'round')::integer,'pool',(st->>'pool')::integer,'target',(st->>'target')::integer,
  'players',results,'hand',CASE WHEN st->>'phase'='select' THEN ps->me->'hand' ELSE 'null'::jsonb END,
  'remaining',jsonb_build_object('attack',jsonb_array_length(st->'attackDeck'),'modifier',jsonb_array_length(st->'modifierDeck'),'fate',jsonb_array_length(st->'fateDeck')),
  'history',st->'results','winner',st->'winner','reason',st->'reason'));
END $game$;
REVOKE ALL ON FUNCTION public.glep_beta_game(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.glep_beta_game(uuid,text,jsonb) TO service_role;
