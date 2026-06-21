-- Explicit grants so authenticated/anon roles can actually reach the tables
-- (RLS policies alone are not enough without table-level GRANT)
grant usage on schema public to anon, authenticated;
grant select on public.players to anon;
grant all    on public.players to authenticated;
grant select on public.scores  to anon, authenticated;
grant insert on public.scores  to authenticated;
