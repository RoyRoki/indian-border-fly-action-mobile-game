-- Add max_players cap to rooms so the host can choose 2, 3, or 4 slots
alter table public.rooms
  add column if not exists max_players int not null default 4
    check (max_players between 2 and 4);
