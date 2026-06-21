-- Multiplayer tables: rooms, room membership, match records, per-player results

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  code        char(4) not null,
  host_id     uuid references public.players(id) on delete set null,
  campaign    smallint not null default 0,
  sector      smallint not null default 0,
  seed        bigint not null default 0,
  status      text not null default 'waiting'
                check (status in ('waiting', 'playing', 'done')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes'
);

-- only one active room may use a given code at a time
create unique index if not exists rooms_code_active
  on public.rooms(code) where status = 'waiting';

create table if not exists public.room_players (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  player_id   uuid not null references public.players(id),
  ready       boolean not null default false,
  joined_at   timestamptz not null default now(),
  unique(room_id, player_id)
);

create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid references public.rooms(id),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);

create table if not exists public.match_results (
  id             uuid primary key default gen_random_uuid(),
  match_id       uuid not null references public.matches(id),
  player_id      uuid not null references public.players(id),
  rank           smallint,
  score          int not null default 0,
  kills          int not null default 0,
  waves_cleared  smallint not null default 0,
  survived       boolean not null default false,
  play_time_s    int not null default 0,
  submitted_at   timestamptz not null default now(),
  unique(match_id, player_id)
);

-- Row-level security
alter table public.rooms          enable row level security;
alter table public.room_players   enable row level security;
alter table public.matches        enable row level security;
alter table public.match_results  enable row level security;

create policy "view rooms"         on public.rooms         for select using (true);
create policy "create room"        on public.rooms         for insert to authenticated with check (host_id = auth.uid());
create policy "update own room"    on public.rooms         for update to authenticated using (host_id = auth.uid());
create policy "view room_players"  on public.room_players  for select using (true);
create policy "join room"          on public.room_players  for insert to authenticated with check (player_id = auth.uid());
create policy "update own ready"   on public.room_players  for update to authenticated using (player_id = auth.uid());
create policy "view matches"       on public.matches       for select to authenticated using (true);
create policy "view results"       on public.match_results for select to authenticated using (true);
create policy "insert own result"  on public.match_results for insert to authenticated with check (player_id = auth.uid());

-- Table-level grants
grant select, insert, update on public.rooms          to authenticated;
grant select                 on public.rooms          to anon;
grant select, insert, update on public.room_players   to authenticated;
grant select                 on public.room_players   to anon;
grant select, insert         on public.matches        to authenticated;
grant select, insert, update on public.match_results  to authenticated;

-- Enable Realtime so clients get live lobby updates
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_players;
