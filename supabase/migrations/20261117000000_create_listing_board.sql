begin;

create table public.board_members (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('streeteasy', 'zillow')),
  source_key text not null check (length(source_key) between 1 and 2048),
  url text not null check (
    length(url) <= 2200 and
    ((source = 'streeteasy' and url ~ '^https://streeteasy[.]com/') or
     (source = 'zillow' and url ~ '^https://www[.]zillow[.]com/'))
  ),
  title text not null default '' check (length(title) <= 160),
  neighborhood text not null default '' check (length(neighborhood) <= 100),
  monthly_rent integer check (monthly_rent between 0 and 1000000),
  bedrooms integer check (bedrooms between 0 and 30),
  notes text not null default '' check (length(notes) <= 4000),
  status text not null default 'interested' check (status in ('interested', 'contacted', 'applied', 'denied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_key)
);

create function public.touch_listing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;

create trigger listings_touch_updated_at
before update on public.listings
for each row execute function public.touch_listing();

revoke all on public.board_members, public.listings from public, anon, authenticated;
revoke all on function public.touch_listing() from public, anon, authenticated;
grant select on public.board_members to authenticated;
grant select, delete on public.listings to authenticated;
grant insert (source, source_key, url, title, neighborhood, monthly_rent, bedrooms, notes, status)
on public.listings to authenticated;
grant update (source, source_key, url, title, neighborhood, monthly_rent, bedrooms, notes, status)
on public.listings to authenticated;

alter table public.board_members enable row level security;
alter table public.listings enable row level security;

create policy "Members can see their own membership"
on public.board_members for select to authenticated
using (user_id = (select auth.uid()));

create policy "Members can use the listing board"
on public.listings for all to authenticated
using (exists (select from public.board_members where user_id = (select auth.uid())))
with check (exists (select from public.board_members where user_id = (select auth.uid())));

commit;
