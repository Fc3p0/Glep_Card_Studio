-- Room lifecycle RPCs, read from deployed production on 2026-10-19.
-- Requires backend/beta-schema.sql; game RPC is in backend/beta-game.sql.

CREATE OR REPLACE FUNCTION public.glep_beta_admit_login(p_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare n integer;
begin
 perform pg_advisory_xact_lock(hashtext(p_key));
 select count(*) into n from public.glep_beta_login_attempts where attempt_key=p_key and attempted_at>now()-interval '15 minutes';
 if n>=8 then return false; end if;
 insert into public.glep_beta_login_attempts(attempt_key) values(p_key);
 return true;
end $function$
;
REVOKE ALL ON FUNCTION public.glep_beta_admit_login(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.glep_beta_admit_login(text) TO service_role;

CREATE OR REPLACE FUNCTION public.glep_beta_create_room(p_session uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE s public.glep_beta_sessions%rowtype; r public.glep_beta_rooms%rowtype;
BEGIN
 SELECT * INTO s FROM public.glep_beta_sessions WHERE id=p_session AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','SESSION_EXPIRED'); END IF;
 IF s.room_id IS NOT NULL THEN
  PERFORM 1 FROM public.glep_beta_rooms WHERE id=s.room_id AND expires_at>now() AND status<>'closed';
  IF FOUND THEN RETURN jsonb_build_object('error','ALREADY_IN_ROOM'); END IF;
 END IF;
 INSERT INTO public.glep_beta_rooms(code,host_session) VALUES(p_code,p_session) RETURNING * INTO r;
 UPDATE public.glep_beta_sessions SET room_id=r.id WHERE id=p_session;
 RETURN jsonb_build_object('room',jsonb_build_object('code',r.code,'status',r.status),'players',jsonb_build_array(s.creator_name));
END $function$
;
REVOKE ALL ON FUNCTION public.glep_beta_create_room(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.glep_beta_create_room(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.glep_beta_join_room(p_session uuid, p_code text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r public.glep_beta_rooms%rowtype; current_room uuid; n integer;
BEGIN
 SELECT room_id INTO current_room FROM public.glep_beta_sessions WHERE id=p_session AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN 'SESSION_EXPIRED'; END IF;
 IF current_room IS NOT NULL THEN
  PERFORM 1 FROM public.glep_beta_rooms WHERE id=current_room AND expires_at>now() AND status<>'closed';
  IF FOUND THEN RETURN 'ALREADY_IN_ROOM'; END IF;
  UPDATE public.glep_beta_sessions SET room_id=NULL WHERE id=p_session;
 END IF;
 SELECT * INTO r FROM public.glep_beta_rooms WHERE code=p_code AND expires_at>now() AND status IN ('waiting','ready') FOR UPDATE;
 IF NOT FOUND THEN RETURN 'ROOM_UNAVAILABLE'; END IF;
 SELECT count(*) INTO n FROM public.glep_beta_sessions WHERE room_id=r.id AND expires_at>now();
 IF n=0 THEN
  UPDATE public.glep_beta_rooms SET status='closed' WHERE id=r.id;
  RETURN 'ROOM_UNAVAILABLE';
 END IF;
 IF n>=2 THEN RETURN 'ROOM_FULL'; END IF;
 UPDATE public.glep_beta_sessions SET room_id=r.id WHERE id=p_session;
 UPDATE public.glep_beta_rooms SET status='ready' WHERE id=r.id;
 RETURN 'OK';
END $function$
;
REVOKE ALL ON FUNCTION public.glep_beta_join_room(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.glep_beta_join_room(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.glep_beta_leave_room(p_session uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_room uuid; v_remaining integer;
begin
 select room_id into v_room from public.glep_beta_sessions where id=p_session for update;
 if not found then return 'SESSION_EXPIRED'; end if;
 if v_room is null then return 'OK'; end if;
 perform 1 from public.glep_beta_rooms where id=v_room for update;
 update public.glep_beta_sessions set room_id=null where id=p_session;
 select count(*) into v_remaining from public.glep_beta_sessions where room_id=v_room and expires_at>now();
 update public.glep_beta_rooms set status=case when v_remaining=0 then 'closed' else 'waiting' end where id=v_room;
 return 'OK';
end $function$
;
REVOKE ALL ON FUNCTION public.glep_beta_leave_room(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.glep_beta_leave_room(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.glep_beta_logout(p_session uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
 PERFORM public.glep_beta_leave_room(p_session);
 UPDATE public.glep_beta_sessions SET expires_at=now() WHERE id=p_session;
 RETURN 'OK';
END $function$
;
REVOKE ALL ON FUNCTION public.glep_beta_logout(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.glep_beta_logout(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.glep_beta_room_status(p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE s public.glep_beta_sessions%rowtype; r public.glep_beta_rooms%rowtype; players jsonb; n integer;
BEGIN
 SELECT * INTO s FROM public.glep_beta_sessions WHERE id=p_session AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','SESSION_EXPIRED'); END IF;
 IF s.room_id IS NOT NULL THEN
  SELECT * INTO r FROM public.glep_beta_rooms WHERE id=s.room_id FOR UPDATE;
  IF NOT FOUND OR r.expires_at<=now() OR r.status='closed' THEN
   UPDATE public.glep_beta_sessions SET room_id=NULL WHERE id=p_session;
  ELSE
   SELECT jsonb_agg(creator_name ORDER BY created_at,id),count(*) INTO players,n
   FROM public.glep_beta_sessions WHERE room_id=r.id AND expires_at>now();
   r.status:=CASE WHEN n>=2 THEN 'ready' ELSE 'waiting' END;
   UPDATE public.glep_beta_rooms SET status=r.status WHERE id=r.id;
   RETURN jsonb_build_object('room',jsonb_build_object('code',r.code,'status',r.status),'players',coalesce(players,'[]'::jsonb));
  END IF;
 END IF;
 RETURN jsonb_build_object('room',NULL,'players','[]'::jsonb);
END $function$
;
REVOKE ALL ON FUNCTION public.glep_beta_room_status(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.glep_beta_room_status(uuid) TO service_role;
