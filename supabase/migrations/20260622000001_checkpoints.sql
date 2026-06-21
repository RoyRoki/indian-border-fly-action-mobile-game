-- Add per-player checkpoint columns so progress syncs across devices
alter table public.players
  add column if not exists checkpoint_day   smallint not null default 0,
  add column if not exists checkpoint_night smallint not null default 0;
