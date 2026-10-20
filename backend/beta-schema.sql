-- Production beta schema snapshot, 2026-10-19 America/Los_Angeles.
-- Restore into a clean Supabase project. Do not run against production to reset data.
SET search_path=public,pg_catalog;
CREATE SEQUENCE IF NOT EXISTS public.glep_beta_login_attempts_id_seq;

CREATE TABLE IF NOT EXISTS public.glep_beta_rooms (id uuid NOT NULL DEFAULT gen_random_uuid(), code text NOT NULL, host_session uuid NOT NULL, status text NOT NULL DEFAULT 'waiting'::text, created_at timestamp with time zone NOT NULL DEFAULT now(), expires_at timestamp with time zone NOT NULL DEFAULT (now() + '12:00:00'::interval));
CREATE TABLE IF NOT EXISTS public.glep_beta_sessions (id uuid NOT NULL DEFAULT gen_random_uuid(), token_hash text NOT NULL, creator_name text NOT NULL, room_id uuid, created_at timestamp with time zone NOT NULL DEFAULT now(), expires_at timestamp with time zone NOT NULL DEFAULT (now() + '12:00:00'::interval));
CREATE TABLE IF NOT EXISTS public.glep_beta_login_attempts (id bigint NOT NULL DEFAULT nextval('glep_beta_login_attempts_id_seq'::regclass), attempt_key text NOT NULL, attempted_at timestamp with time zone NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.glep_beta_matches (room_id uuid NOT NULL, state jsonb NOT NULL, updated_at timestamp with time zone NOT NULL DEFAULT now());

ALTER TABLE public.glep_beta_login_attempts ADD CONSTRAINT "glep_beta_login_attempts_pkey" PRIMARY KEY (id);
ALTER TABLE public.glep_beta_matches ADD CONSTRAINT "glep_beta_matches_pkey" PRIMARY KEY (room_id);
ALTER TABLE public.glep_beta_rooms ADD CONSTRAINT "glep_beta_rooms_pkey" PRIMARY KEY (id);
ALTER TABLE public.glep_beta_sessions ADD CONSTRAINT "glep_beta_sessions_pkey" PRIMARY KEY (id);
ALTER TABLE public.glep_beta_rooms ADD CONSTRAINT "glep_beta_rooms_code_key" UNIQUE (code);
ALTER TABLE public.glep_beta_sessions ADD CONSTRAINT "glep_beta_sessions_token_hash_key" UNIQUE (token_hash);
ALTER TABLE public.glep_beta_rooms ADD CONSTRAINT "glep_beta_rooms_code_check" CHECK ((code ~ '^[A-Z2-9]{6}$'::text));
ALTER TABLE public.glep_beta_rooms ADD CONSTRAINT "glep_beta_rooms_status_check" CHECK ((status = ANY (ARRAY['waiting'::text, 'ready'::text, 'closed'::text])));
ALTER TABLE public.glep_beta_sessions ADD CONSTRAINT "glep_beta_sessions_creator_name_check" CHECK ((creator_name = ANY (ARRAY['Billy'::text, 'Francesca'::text])));
ALTER TABLE public.glep_beta_matches ADD CONSTRAINT "glep_beta_matches_room_id_fkey" FOREIGN KEY (room_id) REFERENCES glep_beta_rooms(id) ON DELETE CASCADE;
ALTER TABLE public.glep_beta_sessions ADD CONSTRAINT "glep_beta_sessions_room_id_fkey" FOREIGN KEY (room_id) REFERENCES glep_beta_rooms(id) ON DELETE SET NULL;

CREATE INDEX glep_beta_rooms_expires_idx ON public.glep_beta_rooms USING btree (expires_at);
CREATE INDEX glep_beta_sessions_room_idx ON public.glep_beta_sessions USING btree (room_id);
CREATE INDEX glep_beta_login_attempts_idx ON public.glep_beta_login_attempts USING btree (attempt_key, attempted_at);

ALTER TABLE public.glep_beta_rooms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.glep_beta_rooms FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.glep_beta_rooms TO service_role;
ALTER TABLE public.glep_beta_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.glep_beta_sessions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.glep_beta_sessions TO service_role;
ALTER TABLE public.glep_beta_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.glep_beta_login_attempts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.glep_beta_login_attempts TO service_role;
ALTER TABLE public.glep_beta_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.glep_beta_matches FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.glep_beta_matches TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.glep_beta_login_attempts_id_seq TO service_role;
