-- Glep card catalog: the spreadsheet in Card Master -> Catalog.
-- Paste this whole file into Supabase dashboard -> SQL Editor -> New query -> Run. Safe to run twice.
--
-- What it makes:
--   glep_catalog_settings  one row holding the column list (built-in + the columns you add)
--   glep_catalog_rows      one row per catalog line. A line linked to a Deck card (card_id) shows that
--                          card's name/type/damage/stars live; a line without card_id is an idea or printed-only card.
-- Nobody can read or write these tables with the public site key. The site goes through the four
-- glep_catalog_* functions below, and each one checks the Card Master admin code first.
-- Deleting a column in the site only hides it; the cell values stay in the table.

create table if not exists public.glep_catalog_settings (
  id         integer primary key default 1 check (id = 1),
  columns    jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.glep_catalog_rows (
  id         uuid primary key default gen_random_uuid(),
  card_id    uuid unique,
  data       jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 60000),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.glep_catalog_settings enable row level security;
alter table public.glep_catalog_rows enable row level security;
revoke all on public.glep_catalog_settings, public.glep_catalog_rows from anon, authenticated;

-- Same check as the Card Master edge function: sha256("glep-v1:" + code) of an active admin code.
create or replace function public.glep_catalog_admin_ok(p_code text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select char_length(btrim(coalesce(p_code, ''))) between 6 and 100 and exists (
    select 1 from public.glep_creator_codes
    where code_hash = encode(sha256(convert_to('glep-v1:' || lower(btrim(p_code)), 'UTF8')), 'hex')
      and active = true and is_admin = true)
$$;
revoke all on function public.glep_catalog_admin_ok(text) from public, anon, authenticated;

create or replace function public.glep_catalog_load(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.glep_catalog_admin_ok(p_code) then raise exception 'Invalid admin password' using errcode = '28000'; end if;
  return jsonb_build_object(
    'columns', (select columns from public.glep_catalog_settings where id = 1),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'card_id', card_id, 'data', data, 'position', position, 'updated_at', updated_at) order by position, created_at)
                      from public.glep_catalog_rows), '[]'::jsonb));
end $$;

-- Set one cell. p_row_id = the catalog line; or p_card_id for a Deck card that has no line yet (it is created);
-- or both null to add a new idea line. Returns the saved line.
create or replace function public.glep_catalog_set_cell(p_code text, p_row_id uuid, p_card_id uuid, p_key text, p_value text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r public.glep_catalog_rows;
        patch jsonb;
begin
  if not public.glep_catalog_admin_ok(p_code) then raise exception 'Invalid admin password' using errcode = '28000'; end if;
  if p_key is null or p_key !~ '^[a-z0-9_]{1,40}$' then raise exception 'Bad column key'; end if;
  if char_length(coalesce(p_value, '')) > 5000 then raise exception 'Cell is too long (5000 characters max)'; end if;
  patch := jsonb_build_object(p_key, coalesce(p_value, ''));
  if p_row_id is not null then
    update public.glep_catalog_rows set data = data || patch, updated_at = now() where id = p_row_id returning * into r;
    if not found then raise exception 'Catalog line not found'; end if;
  elsif p_card_id is not null then
    insert into public.glep_catalog_rows (card_id, data) values (p_card_id, patch)
    on conflict (card_id) do update set data = glep_catalog_rows.data || excluded.data, updated_at = now()
    returning * into r;
  else
    insert into public.glep_catalog_rows (data, position)
    values (patch, coalesce((select max(position) + 1 from public.glep_catalog_rows), 0)) returning * into r;
  end if;
  return jsonb_build_object('id', r.id, 'card_id', r.card_id, 'data', r.data, 'position', r.position, 'updated_at', r.updated_at);
end $$;

create or replace function public.glep_catalog_delete_row(p_code text, p_row_id uuid) returns boolean
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not public.glep_catalog_admin_ok(p_code) then raise exception 'Invalid admin password' using errcode = '28000'; end if;
  delete from public.glep_catalog_rows where id = p_row_id and card_id is null;  -- Deck-card lines are never deleted here
  return found;
end $$;

-- Replace the column list: [{"key":"c_behavior","label":"Behavior"}, ...]. Built-in columns are always kept.
create or replace function public.glep_catalog_save_columns(p_code text, p_columns jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c jsonb;
begin
  if not public.glep_catalog_admin_ok(p_code) then raise exception 'Invalid admin password' using errcode = '28000'; end if;
  if jsonb_typeof(p_columns) <> 'array' or jsonb_array_length(p_columns) > 60 then raise exception 'Bad column list'; end if;
  for c in select * from jsonb_array_elements(p_columns) loop
    if jsonb_typeof(c) <> 'object' or coalesce(c->>'key', '') !~ '^[a-z0-9_]{1,40}$'
       or char_length(btrim(coalesce(c->>'label', ''))) not between 1 and 60 then raise exception 'Bad column: %', c; end if;
  end loop;
  insert into public.glep_catalog_settings (id, columns, updated_at) values (1, p_columns, now())
  on conflict (id) do update set columns = excluded.columns, updated_at = now();
  return p_columns;
end $$;

revoke all on function public.glep_catalog_load(text), public.glep_catalog_set_cell(text, uuid, uuid, text, text),
  public.glep_catalog_delete_row(text, uuid), public.glep_catalog_save_columns(text, jsonb) from public;
grant execute on function public.glep_catalog_load(text), public.glep_catalog_set_cell(text, uuid, uuid, text, text),
  public.glep_catalog_delete_row(text, uuid), public.glep_catalog_save_columns(text, jsonb) to anon, authenticated;

-- Starting columns (only if none saved yet). Built-ins come from the two PDFs; Behavior and Notes are yours to edit.
insert into public.glep_catalog_settings (id, columns) values (1, '[
  {"key":"name","label":"Card","builtin":true},
  {"key":"type","label":"Type","builtin":true},
  {"key":"damage","label":"Dmg","builtin":true},
  {"key":"stars","label":"Stars","builtin":true},
  {"key":"elements","label":"Elements","builtin":true},
  {"key":"effect","label":"Effect / flavor text","builtin":true},
  {"key":"art","label":"Art","builtin":true},
  {"key":"status","label":"Status","builtin":true},
  {"key":"source","label":"Source","builtin":true},
  {"key":"c_behavior","label":"Behavior"},
  {"key":"c_notes","label":"Notes"}
]'::jsonb) on conflict (id) do nothing;

-- Starting lines (only if the catalog is empty): the physical catalog (Oct 13) and New Cards list 2.
-- A line whose name matches an approved Deck card (same type preferred) is linked to it (only Art, Source and Notes are stored;
-- the rest shows live from the card). Unmatched lines are added as Printed / Idea.
do $$
begin
  if exists (select 1 from public.glep_catalog_rows) then return; end if;
  with seed(ord, name, ctype, linked, unlinked) as (values
  (1, 'A Single Grain of Rice', 'attack', '{"art": "One tiny grain with sparkle lines", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "A Single Grain of Rice", "type": "attack", "damage": "1", "stars": "1", "elements": "Earth, Water", "effect": "Is this good?", "art": "One tiny grain with sparkle lines", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (2, '3 Leg Greg', 'attack', '{"art": "Round-faced creature with three legs", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "3 Leg Greg", "type": "attack", "damage": "4", "stars": "1", "elements": "Air", "effect": "He has 3 legs", "art": "Round-faced creature with three legs", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (3, 'Saqqara Bird', 'attack', '{"art": "Duck-like bird", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Saqqara Bird", "type": "attack", "damage": "5", "stars": "1", "elements": "Air", "effect": "Just like an airplane...", "art": "Duck-like bird", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (4, 'Boat of Sand', 'attack', '{"art": "Reed boat with a sand pile", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Boat of Sand", "type": "attack", "damage": "2", "stars": "4", "elements": "Earth, Water", "effect": "Why is it always sand!", "art": "Reed boat with a sand pile", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (5, 'Royal Moth', 'attack', '{"art": "Moth wearing a crown", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Royal Moth", "type": "attack", "damage": "4", "stars": "4", "elements": "Air", "effect": "May she rest in peace", "art": "Moth wearing a crown", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (6, 'Blind Mouse', 'attack', '{"art": "Mouse", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Blind Mouse", "type": "attack", "damage": "3", "stars": "3", "elements": "Water, Air", "effect": "Play all 3 and win the game", "art": "Mouse", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (7, 'Teleconnect Worm', 'attack', '{"art": "Computer with a worm on screen", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Teleconnect Worm", "type": "attack", "damage": "2", "stars": "1", "elements": "Earth", "effect": "...dam autocorrect", "art": "Computer with a worm on screen", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (8, 'Left Hand', 'attack', '{"art": "Sketched hand", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Left Hand", "type": "attack", "damage": "1", "stars": "4", "effect": "I did this with my left hand", "art": "Sketched hand", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (9, 'Bubble', 'attack', '{"art": "Plain circle bubble", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Bubble", "type": "attack", "damage": "1", "stars": "0", "elements": "Water", "effect": "It''s a bubble", "art": "Plain circle bubble", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (10, 'The Hive Mind', 'attack', '{"art": "Apple logo", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "The Hive Mind", "type": "attack", "damage": "3", "stars": "2", "elements": "Water", "effect": "Like sheep in a herd", "art": "Apple logo", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (11, 'Mountain King', 'attack', '{"art": "Giant bear-like beast", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Mountain King", "type": "attack", "damage": "10", "stars": "0", "elements": "Earth", "effect": "Does not understand tent''s", "art": "Giant bear-like beast", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (12, 'Money Tree', 'attack', '{"art": "Potted tree with two branches", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Money Tree", "type": "attack", "damage": "5", "stars": "2", "elements": "Water", "effect": "Money tree is the perfect place for shade and that''s just how I feel", "art": "Potted tree with two branches", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (13, 'Terracotta Soldier', 'attack', '{"art": "Row of soldier silhouettes", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Terracotta Soldier", "type": "attack", "damage": "8", "stars": "0", "elements": "Earth", "effect": "8,000 soldier''s ready to fight", "art": "Row of soldier silhouettes", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (14, 'Nile Croc', 'attack', '{"art": "Croc shoe labeled NILE", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Nile Croc", "type": "attack", "damage": "7", "stars": "0", "elements": "Water", "effect": "It does bite...", "art": "Croc shoe labeled NILE", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (15, 'Battle Toad', 'attack', '{"art": "Toad with a rocket on its back", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Battle Toad", "type": "attack", "damage": "7", "stars": "0", "elements": "Fire", "effect": "Are you ready for war?", "art": "Toad with a rocket on its back", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (16, 'Salman Strike', 'attack', '{"art": "Bearded man in a suit", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Salman Strike", "type": "attack", "damage": "8", "stars": "2", "elements": "Fire", "effect": "Swagat nahi karoge aap hamara?", "art": "Bearded man in a suit", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (17, 'Little Carrot', 'attack', '{"art": "Orange carrot with a face", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Little Carrot", "type": "attack", "damage": "4", "stars": "1", "elements": "Earth", "effect": "Good for the eye is in more than 1 way", "art": "Orange carrot with a face", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (18, 'Space King', 'attack', '{"art": "Armored figure, yellow", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Space King", "type": "attack", "damage": "10", "stars": "10", "elements": "Fire, Fire", "effect": "10 damage and stars. The king of space", "art": "Armored figure, yellow", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (19, 'Rickshaw Joust', 'attack', '{"art": "Rickshaw with a jousting lance", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Rickshaw Joust", "type": "attack", "damage": "7", "stars": "0", "elements": "Fire", "effect": "Running is pointless...", "art": "Rickshaw with a jousting lance", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (20, 'Bottom Feeder', 'attack', '{"art": "Bottom-feeding fish", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Bottom Feeder", "type": "attack", "damage": "3", "stars": "4", "elements": "Water", "effect": "No scrap is safe from the bottom feeder", "art": "Bottom-feeding fish", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (21, 'No Gnome', 'attack', '{"art": "Blank art box", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "No Gnome", "type": "attack", "damage": "0", "stars": "0", "elements": "Fire, Air", "effect": "There is no gnome :(", "art": "Blank art box", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (22, 'Meatball', 'attack', '{"art": "Meatball on noodles", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Meatball", "type": "attack", "damage": "3", "stars": "6", "elements": "Fire", "effect": "Does it have 3 legs???", "art": "Meatball on noodles", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (23, '⋏⎍⋔⏚⟒⍀ ⏁⍙⍜ ⋔⟒⏃⌰', 'attack', '{"art": "Multi-eyed fanged tentacle monster", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "⋏⎍⋔⏚⟒⍀ ⏁⍙⍜ ⋔⟒⏃⌰", "type": "attack", "damage": "6", "stars": "1", "elements": "Earth, Fire", "effect": "(alien symbols, unreadable)", "art": "Multi-eyed fanged tentacle monster", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (24, 'Silk Worm.exe', 'attack', '{"art": "Silkworm with binary code", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Silk Worm.exe", "type": "attack", "damage": "4", "stars": "3", "elements": "Air", "effect": "(binary code only)", "art": "Silkworm with binary code", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (25, 'Cairo-practor', 'attack', '{"art": "Scribbled outline with a figure on a table", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Cairo-practor", "type": "attack", "damage": "4", "stars": "2", "elements": "Fire", "effect": "It''s a dumb joke...", "art": "Scribbled outline with a figure on a table", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (26, 'Rogue Sniper', 'modifier', '{"art": "Fluffy creature with sunglasses and a rifle", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Rogue Sniper", "type": "modifier", "damage": "2", "stars": "0", "elements": "Fire", "effect": "Choose one card (not played) from the hand of the person to your right to discard.", "art": "Fluffy creature with sunglasses and a rifle", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (27, 'All Roads Lead to Gnomes', 'modifier', '{"art": "Orange gnome hat beside a road", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "All Roads Lead to Gnomes", "type": "modifier", "damage": "2", "stars": "3", "elements": "Fire", "effect": "You can gift this card to another mid-round, leaving you with only the attack card.", "art": "Orange gnome hat beside a road", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (28, 'Dhow Leek', 'modifier', '{"art": "Sailing ship", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Dhow Leek", "type": "modifier", "damage": "-3", "stars": "0", "elements": "Water", "effect": "-3 damage, +10 stars if you play a card with food art.", "art": "Sailing ship", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (29, 'Invasive Love', 'modifier', '{"art": "Starling", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Invasive Love", "type": "modifier", "damage": "5", "stars": "0", "elements": "Air", "effect": "Doubles the attack card''s damage.", "art": "Starling", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (30, 'Ka-Chow', 'modifier', '{"art": "\"I AM SPEED\" with a lightning 95", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Ka-Chow", "type": "modifier", "damage": "1", "stars": "0", "elements": "Air, Fire", "effect": "Be the first to place a card and say \"Ka-Chow\" for +6 damage.", "art": "\"I AM SPEED\" with a lightning 95", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (31, 'Red Thread', 'modifier', '{"art": "Red curving line with an arrow", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Red Thread", "type": "modifier", "damage": "0", "stars": "5", "effect": "Choose one: reroll the round''s gem pool, or exchange fate card with another player.", "art": "Red curving line with an arrow", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (32, 'Magic Mirror', 'modifier', '{"art": "Ornate mirror", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Magic Mirror", "type": "modifier", "damage": "-1", "stars": "-2", "effect": "Copy your attack card.", "art": "Ornate mirror", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (33, 'Curry Cure', 'modifier', '{"art": "Steaming bowl of curry", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Curry Cure", "type": "modifier", "damage": "-3", "stars": "7", "effect": "Any negative damage you have becomes positive damage if you play a Fire type card.", "art": "Steaming bowl of curry", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (34, 'The Eye', 'modifier', '{"art": "Detailed blue eye", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "The Eye", "type": "modifier", "damage": "0", "stars": "6", "elements": "Water", "effect": "\"Protection from Fate\": invulnerable from negative effects besides fate cards.", "art": "Detailed blue eye", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (35, 'Cardception', 'modifier', '{"art": "Card pack", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Cardception", "type": "modifier", "damage": "4", "stars": "4", "elements": "Fire, Water", "effect": "Wait! I can use both!?", "art": "Card pack", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (36, 'Data Center', 'modifier', '{"art": "Server-room diagram", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Data Center", "type": "modifier", "damage": "1", "stars": "6", "elements": "Air, Fire", "effect": "-3 damage if your attack card is Water or Earth. +3 damage if it is Wind or Fire.", "art": "Server-room diagram", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (37, 'Army of Two', 'modifier', '{"art": "Split mask face", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Army of Two", "type": "modifier", "damage": "0", "stars": "0", "elements": "Fire, Water", "effect": "You can''t draw a fate card but you can play 2 attack cards.", "art": "Split mask face", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (38, 'Infinite Sandcastles', 'modifier', '{"art": "Sandcastle", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Infinite Sandcastles", "type": "modifier", "damage": "0", "stars": "5", "elements": "Earth", "effect": "+5 stars per additional Earth type played.", "art": "Sandcastle", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (39, 'Telekinetic Worm', 'modifier', '{"art": "Worm with motion marks", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Telekinetic Worm", "type": "modifier", "damage": "0", "stars": "0", "effect": "Play the last discarded card.", "art": "Worm with motion marks", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (40, 'Nose of the Sphinx', 'modifier', '{"art": "Sphinx nose rock", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Nose of the Sphinx", "type": "modifier", "damage": "-6", "stars": "2", "elements": "Air", "effect": "Given to an opponent: -6 damage to them, but they keep the stars.", "art": "Sphinx nose rock", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (41, 'Double-Edged Sword', 'modifier', '{"art": "Sword", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Double-Edged Sword", "type": "modifier", "damage": "4", "stars": "1", "elements": "Fire", "effect": "Swap this with another player''s modifier card.", "art": "Sword", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (42, 'Gluttony', 'modifier', '{"art": "Big-eared dog face", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Gluttony", "type": "modifier", "damage": "0", "stars": "10", "effect": "I hunger", "art": "Big-eared dog face", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (43, 'A Fork in the Road', 'modifier', '{"art": "Road with a fork on it", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "A Fork in the Road", "type": "modifier", "damage": "0", "stars": "8", "elements": "Earth", "effect": "Before you pull a fate card, declare if you will keep it or give it to another.", "art": "Road with a fork on it", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (44, 'A Load of Barnacles', 'modifier', '{"art": "Crate of barnacles", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "A Load of Barnacles", "type": "modifier", "damage": "0", "stars": "0", "elements": "Water, Earth", "effect": "You and the person to your left deal your choice (same for both): -5 damage or -5 stars.", "art": "Crate of barnacles", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (45, 'White Bat', 'modifier', '{"art": "Bat", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "White Bat", "type": "modifier", "damage": "3", "stars": "3", "elements": "Air", "effect": "+3 damage to Air attack cards.", "art": "Bat", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (46, 'Blind Mouse', 'modifier', '{"art": "Mouse", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Blind Mouse", "type": "modifier", "damage": "3", "stars": "3", "elements": "Fire, Water", "effect": "Play all 3 and win the game.", "art": "Mouse", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (47, 'Mercury River', 'modifier', '{"art": "Wavy river lines", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Mercury River", "type": "modifier", "damage": "4", "stars": "0", "effect": "+4 damage for Earth type. -10 damage if you play a card with any other type.", "art": "Wavy river lines", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (48, 'Rent Is Due', 'modifier', '{"art": "Money bag with a $", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Rent Is Due", "type": "modifier", "damage": "-6", "stars": "0", "effect": "\"You have 2 pay.\" -6 damage.", "art": "Money bag with a $", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (49, 'Reverse Water Fall', 'modifier', '{"art": "Blue waterfall", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Reverse Water Fall", "type": "modifier", "damage": "0", "stars": "5", "elements": "Water", "effect": "Flip your attack card''s damage into stars.", "art": "Blue waterfall", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (50, 'Scarab', 'modifier', '{"art": "Tiny scarab beetle", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Scarab", "type": "modifier", "damage": "1", "stars": "1", "elements": "Fire", "effect": "+2 damage and stars for every card played.", "art": "Tiny scarab beetle", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (51, 'Homesick', 'fate', '{"art": "Blue-striped flag with stars", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Homesick", "type": "fate", "damage": "0", "effect": "+3 damage per card discarded from hand this round, max +12.", "art": "Blue-striped flag with stars", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (52, 'The Living Dead', 'fate', '{"art": "Zombie", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "The Living Dead", "type": "fate", "damage": "0", "effect": "Retrieves the last card put into the discard pile and lets the player use it.", "art": "Zombie", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (53, 'Give', 'fate', '{"art": "Samoyed", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Give", "type": "fate", "damage": "0", "effect": "Take possession of any single card already played on the field and use it as your own.", "art": "Samoyed", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (54, 'Wire Fraud', 'fate', '{"art": "Cable with orange FAKE NEWS banner", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Wire Fraud", "type": "fate", "damage": "0", "elements": "Air", "effect": "All Air type cards in play (everyone) deal 0 damage.", "art": "Cable with orange FAKE NEWS banner", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (55, 'Sneaky Thief', 'fate', '{"art": "Hand holding a crystal", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Sneaky Thief", "type": "fate", "damage": "0", "effect": "Steals 1 gem from the round''s prize pool when drawn.", "art": "Hand holding a crystal", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (56, 'Street Food', 'fate', '{"art": "Food cart", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Street Food", "type": "fate", "damage": "0", "effect": "Every player discards food cards that have been played.", "art": "Food cart", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (57, 'Carey', 'fate', '{"art": "Turtle shell", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Carey", "type": "fate", "damage": "0", "elements": "Water", "effect": "+3 damage to Water type cards you play. +9 if all have animal art.", "art": "Turtle shell", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (58, 'The Test', 'fate', '{"art": "Multicolor dot circle", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "The Test", "type": "fate", "damage": "0", "effect": "Multiply by the hidden number \"the damage\".", "art": "Multicolor dot circle", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (59, 'The Slab', 'fate', '{"art": "Skull in a slab", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "The Slab", "type": "fate", "damage": "0", "elements": "Earth", "effect": "\"It must be returned.\" Drawer discards their whole hand and draws a new one.", "art": "Skull in a slab", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (60, 'Ultimate Industry', 'fate', '{"art": "Small stars", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Ultimate Industry", "type": "fate", "damage": "0", "effect": "Play all cards in hand at once.", "art": "Small stars", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (61, 'Monkey''s Paw', 'fate', '{"art": "Hand or paw", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Monkey''s Paw", "type": "fate", "damage": "3", "effect": "Win the round and lose 3 gems. Lose the round and gain 3 gems.", "art": "Hand or paw", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (62, 'Blind Mouse', 'fate', '{"art": "Mouse", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Blind Mouse", "type": "fate", "damage": "3", "elements": "Air, Fire", "effect": "Play all 3 and win the game.", "art": "Mouse", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (63, 'Finch Fire', 'fate', '{"art": "Bird in flames", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Finch Fire", "type": "fate", "damage": "0", "elements": "Fire", "effect": "All Fire type attack cards in play (for every person) gain +4 damage.", "art": "Bird in flames", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (64, 'Stomp', 'fate', '{"art": "Elephant foot", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Stomp", "type": "fate", "damage": "0", "effect": "Crushes the round''s gems, making this round''s pool 0.", "art": "Elephant foot", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (65, 'Perfect Mango', 'fate', '{"art": "Mango", "source": "Physical catalog (Oct 13)"}'::jsonb, '{"name": "Perfect Mango", "type": "fate", "damage": "0", "effect": "You win this round.", "art": "Mango", "status": "Printed", "source": "Physical catalog (Oct 13)"}'::jsonb),
  (66, 'Brain Sick', 'modifier', '{"source": "New cards list 2", "c_notes": "Its effect sets your attack card''s damage and stars to 0; you may instead give the card to another player. Damage and stars shown on the face."}'::jsonb, '{"name": "Brain Sick", "type": "modifier", "damage": "10", "stars": "10", "effect": "Its effect sets your attack card''s damage and stars to 0; you may instead give the card to another player.", "status": "Idea", "source": "New cards list 2", "c_notes": "Damage and stars shown on the face."}'::jsonb),
  (67, 'Pea Starch', 'attack', '{"source": "New cards list 2", "c_notes": "No special effect. Flavor text: \"nobody liked this choice.\""}'::jsonb, '{"name": "Pea Starch", "type": "attack", "damage": "-2", "effect": "No special effect. Flavor text: \"nobody liked this choice.\"", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (68, 'Mothman', 'fate', '{"source": "New cards list 2", "c_notes": "Global: converts every player''s stars into damage for the round. Players can still summon fate cards off their star totals."}'::jsonb, '{"name": "Mothman", "type": "fate", "effect": "Global: converts every player''s stars into damage for the round. Players can still summon fate cards off their star totals.", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (69, 'Arithmetic Sequence', 'fate', '{"source": "New cards list 2", "c_notes": "Drawer gets +10 damage, the player to their left +8, the next +6, decreasing by 2 around the table."}'::jsonb, '{"name": "Arithmetic Sequence", "type": "fate", "effect": "Drawer gets +10 damage, the player to their left +8, the next +6, decreasing by 2 around the table.", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (70, 'Wanderer', 'attack', '{"art": "An alien spacecraft", "source": "New cards list 2"}'::jsonb, '{"name": "Wanderer", "type": "attack", "art": "An alien spacecraft", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (71, 'Foolish Hand', '', '{"art": "One of Billy''s own hand drawings", "source": "New cards list 2"}'::jsonb, '{"name": "Foolish Hand", "art": "One of Billy''s own hand drawings", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (72, 'Substitution', 'modifier', '{"art": "A log with a knife sticking out of it", "source": "New cards list 2", "c_notes": "Nullifies all negative damage taken by the player who placed it."}'::jsonb, '{"name": "Substitution", "type": "modifier", "effect": "Nullifies all negative damage taken by the player who placed it.", "art": "A log with a knife sticking out of it", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (73, 'Crow Knight', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Crow Knight", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (74, 'Ritual of the Nightmare King', '', '{"art": "A summoning circle", "source": "New cards list 2", "c_notes": "Placed face down, start a 5 minute timer; if it hits zero and the round isn''t over, the card gets +99 damage. Work in progress."}'::jsonb, '{"name": "Ritual of the Nightmare King", "effect": "Placed face down, start a 5 minute timer; if it hits zero and the round isn''t over, the card gets +99 damage.", "art": "A summoning circle", "status": "Idea", "source": "New cards list 2", "c_notes": "Work in progress."}'::jsonb),
  (75, 'Finger of the Nightmare King', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Finger of the Nightmare King", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (76, 'Chalice of the Nightmare King', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Chalice of the Nightmare King", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (77, 'Dagger of the Nightmare King', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Dagger of the Nightmare King", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (78, 'Claw of the Nightmare King', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Claw of the Nightmare King", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (79, 'Blood of the Nightmare King', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Blood of the Nightmare King", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (80, 'Steamed Ham', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Steamed Ham", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (81, 'Playing Possum', '', '{"source": "New cards list 2", "c_notes": "If you have more than -6 damage, you pull a second fate card."}'::jsonb, '{"name": "Playing Possum", "effect": "If you have more than -6 damage, you pull a second fate card.", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (82, 'Marshawn the Cat', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Marshawn the Cat", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (83, 'Moon Dust', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Moon Dust", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (84, 'TI-83', 'modifier', '{"source": "New cards list 2", "c_notes": "Multiplies the prize-pool die roll by 2; the result is added as damage or stars, your choice."}'::jsonb, '{"name": "TI-83", "type": "modifier", "effect": "Multiplies the prize-pool die roll by 2; the result is added as damage or stars, your choice.", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (85, 'Army Ant', '', '{"source": "New cards list 2", "c_notes": "If the gem pool is 1, deal 10 damage; otherwise deal 1 damage."}'::jsonb, '{"name": "Army Ant", "effect": "If the gem pool is 1, deal 10 damage; otherwise deal 1 damage.", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (86, 'Played Like a Fish', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Played Like a Fish", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (87, 'Puppet Girl', '', '{"source": "New cards list 2", "c_notes": "Name only. A character from one of Billy''s stories."}'::jsonb, '{"name": "Puppet Girl", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only. A character from one of Billy''s stories."}'::jsonb),
  (88, 'Nines', 'attack', '{"source": "New cards list 2", "c_notes": "Ninth name of the ninth generation of clones, made by some corporation (corporation not set). Name may change."}'::jsonb, '{"name": "Nines", "type": "attack", "effect": "Ninth name of the ninth generation of clones, made by some corporation (corporation not set).", "status": "Idea", "source": "New cards list 2", "c_notes": "Name may change."}'::jsonb),
  (89, 'Cytomorphic Fabricator', '', '{"source": "New cards list 2", "c_notes": "Sci-fi machine from one of his stories: breaks harvested monster flesh into a slurry of intact cells, then rearranges the cells Lego-style into a shape; how clones were made."}'::jsonb, '{"name": "Cytomorphic Fabricator", "effect": "Sci-fi machine from one of his stories: breaks harvested monster flesh into a slurry of intact cells, then rearranges the cells Lego-style into a shape; how clones were made.", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (90, 'Tiny Pink Elephant', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Tiny Pink Elephant", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (91, 'Fairy Tale', '', '{"art": "A thick fairy tale book", "source": "New cards list 2", "c_notes": "Something like \"that will ever happen\" (wording rough)."}'::jsonb, '{"name": "Fairy Tale", "effect": "Something like \"that will ever happen\" (wording rough).", "art": "A thick fairy tale book", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (92, 'Mug', '', '{"source": "New cards list 2", "c_notes": "\"the Brady''s house\" (as heard; may be a transcription error)."}'::jsonb, '{"name": "Mug", "effect": "\"the Brady''s house\" (as heard; may be a transcription error).", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (93, 'Chicken Nuke', 'modifier', '{"source": "New cards list 2", "c_notes": "If someone makes you discard this card from your hand before you play it, they take -25 damage (wording rough). Name for now."}'::jsonb, '{"name": "Chicken Nuke", "type": "modifier", "damage": "1", "stars": "6", "effect": "If someone makes you discard this card from your hand before you play it, they take -25 damage (wording rough).", "status": "Idea", "source": "New cards list 2", "c_notes": "Name for now."}'::jsonb),
  (94, 'Demon Heart Fruit', 'modifier', '{"source": "New cards list 2", "c_notes": "If paired with any living creature, an additional +5 damage and +5 stars."}'::jsonb, '{"name": "Demon Heart Fruit", "type": "modifier", "damage": "2", "stars": "4", "effect": "If paired with any living creature, an additional +5 damage and +5 stars.", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (95, 'Soup Day', '', '{"source": "New cards list 2", "c_notes": "\"my disappointment is immeasurable, my day is ruined\" (wording rough)."}'::jsonb, '{"name": "Soup Day", "damage": "-10", "stars": "-10", "effect": "\"my disappointment is immeasurable, my day is ruined\" (wording rough).", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (96, 'Hexed Revolver', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Hexed Revolver", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (97, 'Silver-Toothed Werewolf', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Silver-Toothed Werewolf", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (98, 'Cerebral Preservation Unit (CPU)', '', '{"source": "New cards list 2", "c_notes": "Last-resort machine from a sci-fi story: clamps onto a dying person''s head, extracts a honeycomb-like chunk of brain holding their memories, and places it in a robot they then control. Permanent and risky to remove: alive but not."}'::jsonb, '{"name": "Cerebral Preservation Unit (CPU)", "effect": "Last-resort machine from a sci-fi story: clamps onto a dying person''s head, extracts a honeycomb-like chunk of brain holding their memories, and places it in a robot they then control. Permanent and risky to remove: alive but not.", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (99, 'Heal Plant', '', '{"source": "New cards list 2", "c_notes": "Heal up to 5 damage on anyone; each heal nets you 2 stars, max 10. The fifth heal point is a free extra heal with no bonus. Placeholder name."}'::jsonb, '{"name": "Heal Plant", "damage": "4", "stars": "2", "effect": "Heal up to 5 damage on anyone; each heal nets you 2 stars, max 10. The fifth heal point is a free extra heal with no bonus.", "status": "Idea", "source": "New cards list 2", "c_notes": "Placeholder name."}'::jsonb),
  (100, 'Soul Nail', '', '{"art": "A twisted railroad spike shimmering with a bleak purple light", "source": "New cards list 2"}'::jsonb, '{"name": "Soul Nail", "art": "A twisted railroad spike shimmering with a bleak purple light", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (101, 'The Marrow', '', '{"art": "A butcher stall selling body parts", "source": "New cards list 2", "c_notes": "Name of a district in the Flesh Harvest story, a market selling grown custom limbs."}'::jsonb, '{"name": "The Marrow", "effect": "Name of a district in the Flesh Harvest story, a market selling grown custom limbs.", "art": "A butcher stall selling body parts", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (102, 'Ash Glass Dagger', '', '{"source": "New cards list 2", "c_notes": "Name only. Ash glass is the material."}'::jsonb, '{"name": "Ash Glass Dagger", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only. Ash glass is the material."}'::jsonb),
  (103, 'Ash Glass Arrow', '', '{"source": "New cards list 2", "c_notes": "Name only. Ash glass is the material."}'::jsonb, '{"name": "Ash Glass Arrow", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only. Ash glass is the material."}'::jsonb),
  (104, 'X9', '', '{"art": "A data shard", "source": "New cards list 2", "c_notes": "Something like \"new life imprinted\" (wording rough)."}'::jsonb, '{"name": "X9", "effect": "Something like \"new life imprinted\" (wording rough).", "art": "A data shard", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (105, 'Jettison', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Jettison", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (106, 'Funk Frog', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Funk Frog", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (107, 'Liquid Frog', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Liquid Frog", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (108, 'Doctor Frog', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Doctor Frog", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (109, 'Corn Frog', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Corn Frog", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (110, 'Claxco', '', '{"art": "A corporate building or something like that", "source": "New cards list 2"}'::jsonb, '{"name": "Claxco", "art": "A corporate building or something like that", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (111, 'Sand Shield', '', '{"source": "New cards list 2", "c_notes": "From a story: a desert cliff city gets airflow that causes sandstorms, so a giant train on a track around the city moves to whichever side the wind hits and blows air to form a barrier."}'::jsonb, '{"name": "Sand Shield", "effect": "From a story: a desert cliff city gets airflow that causes sandstorms, so a giant train on a track around the city moves to whichever side the wind hits and blows air to form a barrier.", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (112, 'Walking Treehouse', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Walking Treehouse", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (113, 'Sun Kissed', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Sun Kissed", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (114, 'Wolpertinger', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Wolpertinger", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (115, 'Jackalope', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Jackalope", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (116, 'Angel Feather Quill', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Angel Feather Quill", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (117, 'Milestone', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Milestone", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (118, 'Mehrunes'' Razor', 'modifier', '{"source": "New cards list 2", "c_notes": "If your attack card does 1 damage, gain an additional 10 damage."}'::jsonb, '{"name": "Mehrunes'' Razor", "type": "modifier", "effect": "If your attack card does 1 damage, gain an additional 10 damage.", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (119, 'Looks Like Seeds Are Back on the Menu, Boys', '', '{"art": "A bunch of juncos eating grass seeds", "source": "New cards list 2"}'::jsonb, '{"name": "Looks Like Seeds Are Back on the Menu, Boys", "art": "A bunch of juncos eating grass seeds", "status": "Idea", "source": "New cards list 2"}'::jsonb),
  (120, 'Well-Fed Finch', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Well-Fed Finch", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb),
  (121, 'Ghost Blood', '', '{"source": "New cards list 2", "c_notes": "Name only."}'::jsonb, '{"name": "Ghost Blood", "status": "Idea", "source": "New cards list 2", "c_notes": "Name only."}'::jsonb)
  ), norm as (
    select s.*, lower(regexp_replace(s.name, '[^a-zA-Z0-9]', '', 'g')) as k from seed s
  ), matched as (
    select n.*, (select c.id from public.glep_cards c
                 where c.review_status = 'approved'
                   and ((n.k <> '' and lower(regexp_replace(c.name, '[^a-zA-Z0-9]', '', 'g')) = n.k) or lower(btrim(c.name)) = lower(n.name))
                 order by (c.card_type = n.ctype) desc, c.created_at limit 1) as card_id
    from norm n
  ), picked as (
    select distinct on (coalesce(card_id::text, 'seed' || ord)) * from matched order by coalesce(card_id::text, 'seed' || ord), ord
  )
  insert into public.glep_catalog_rows (card_id, data, position)
  select card_id, case when card_id is null then unlinked else linked end, ord from picked;
end $$;

-- Tell the site's API about the new functions.
notify pgrst, 'reload schema';

-- Check: should show the column list and about 121 lines (fewer if two lines matched the same card).
select (select jsonb_array_length(columns) from public.glep_catalog_settings) as columns,
       (select count(*) from public.glep_catalog_rows) as lines,
       (select count(*) from public.glep_catalog_rows where card_id is not null) as linked_to_deck;
