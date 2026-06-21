-- Friends / social: send/accept/decline requests, look up friends by call sign

create table if not exists public.friendships (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.players(id) on delete cascade,
  addressee_id uuid not null references public.players(id) on delete cascade,
  status       text not null default 'pending'
                 check (status in ('pending', 'accepted', 'declined')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique(requester_id, addressee_id)
);

alter table public.friendships enable row level security;

create policy "view own friendships"
  on public.friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "send friend request"
  on public.friendships for insert to authenticated
  with check (requester_id = auth.uid());

create policy "update addressee response"
  on public.friendships for update to authenticated
  using (addressee_id = auth.uid());

create policy "delete own friendship"
  on public.friendships for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

grant select, insert, update, delete on public.friendships to authenticated;

-- Enable realtime so friend-request notifications arrive without polling
alter publication supabase_realtime add table public.friendships;
