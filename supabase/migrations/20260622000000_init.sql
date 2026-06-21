-- Players linked to Supabase auth (Google OAuth)
create table public.players (
  id         uuid      primary key references auth.users(id) on delete cascade,
  name       text      not null default 'PILOT',
  city       text      not null default '—',
  wins       smallint  not null default 0,
  dia        smallint  not null default 0,
  created_at timestamptz not null default now()
);

-- Individual score submissions
create table public.scores (
  id         bigserial primary key,
  player_id  uuid      not null references public.players(id) on delete cascade,
  score      int       not null,
  sector     smallint  not null default 0,
  created_at timestamptz not null default now()
);

alter table public.players enable row level security;
alter table public.scores  enable row level security;

-- Each user can only read/write their own player row
create policy "players_own" on public.players
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Scores: anyone reads, owner inserts
create policy "scores_read"   on public.scores for select using (true);
create policy "scores_insert" on public.scores for insert with check (auth.uid() = player_id);
