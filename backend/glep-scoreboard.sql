-- Glep scoreboard: one row per finished game. Paste this whole file into
-- Supabase dashboard -> SQL Editor -> New query -> Run. Safe to run twice.
-- Anyone with the site can read the board and add a result (same as the public
-- Deck). Nobody can edit or delete from the site; fix mistakes in Table Editor.

create table if not exists public.glep_scoreboard (
  id         uuid primary key default gen_random_uuid(),
  winner     text not null check (char_length(btrim(winner)) between 1 and 36),
  margin     integer not null check (margin between 0 and 999),
  played_on  date not null check (played_on >= date '2026-01-01'),
  created_at timestamptz not null default now()
);
create index if not exists glep_scoreboard_played_on_idx on public.glep_scoreboard (played_on desc, created_at desc);

alter table public.glep_scoreboard enable row level security;

drop policy if exists "scoreboard readable by everyone" on public.glep_scoreboard;
create policy "scoreboard readable by everyone" on public.glep_scoreboard
  for select to anon, authenticated using (true);

drop policy if exists "anyone can log a result" on public.glep_scoreboard;
create policy "anyone can log a result" on public.glep_scoreboard
  for insert to anon, authenticated with check (played_on <= current_date + 1);

revoke all on public.glep_scoreboard from anon, authenticated;
grant select, insert (winner, margin, played_on) on public.glep_scoreboard to anon, authenticated;

-- The first two results (only added if the table is empty).
insert into public.glep_scoreboard (winner, margin, played_on, created_at)
select * from (values
  ('Kim Mom OG', 20, date '2026-11-09', timestamptz '2026-11-09 12:00:00-08'),
  ('Francesca',  25, date '2026-11-09', timestamptz '2026-11-09 19:36:00-08')
) as seed(winner, margin, played_on, created_at)
where not exists (select 1 from public.glep_scoreboard);
