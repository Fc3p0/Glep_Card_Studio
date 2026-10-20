-- Beta-only migration. Apply ONLY to an isolated development Supabase project.
-- All browser access denied. The Edge Function uses its service role after validating session tokens.
create extension if not exists pgcrypto;
create table if not exists public.glep_beta_rooms (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
 host_session uuid not null,
 status text not null default 'waiting' check (status in ('waiting','ready','closed')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '12 hours')
);
create table if not exists public.glep_beta_sessions (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique,
 creator_name text not null check (creator_name in ('Billy','Francesca')),
 room_id uuid references public.glep_beta_rooms(id) on delete set null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '12 hours')
);
create index if not exists glep_beta_sessions_room_idx on public.glep_beta_sessions(room_id);
create index if not exists glep_beta_rooms_expires_idx on public.glep_beta_rooms(expires_at);
alter table public.glep_beta_rooms enable row level security;
alter table public.glep_beta_sessions enable row level security;
revoke all on public.glep_beta_rooms from anon,authenticated;
revoke all on public.glep_beta_sessions from anon,authenticated;
-- No policies: service-role backend only. No production project migrations.
