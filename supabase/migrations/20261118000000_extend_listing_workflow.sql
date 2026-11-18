begin;

alter table public.listings
  drop constraint listings_status_check,
  add constraint listings_status_check check (
    status in ('interested', 'contacted', 'visited', 'applied', 'denied', 'suggested')
  ),
  add column trashed_at timestamptz,
  add column bathrooms numeric check (bathrooms between 0 and 30 and mod(bathrooms, 0.5) = 0),
  add column square_feet integer check (square_feet between 0 and 100000),
  add column image_url text not null default '' check (
    length(image_url) <= 2048 and (
      image_url = '' or image_url ~ '^https://(photos[.]zillowstatic[.]com|cdn-img[.]streeteasy[.]com|photos[.]streeteasy[.]com)/'
    )
  );

grant insert (bathrooms, square_feet, image_url) on public.listings to authenticated;
grant update (trashed_at, bathrooms, square_feet, image_url) on public.listings to authenticated;
grant select, insert on public.listings to service_role;

create table public.board_search (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  neighborhoods text[] not null default '{}',
  max_rent integer check (max_rent between 1 and 1000000),
  min_bedrooms integer not null default 0 check (min_bedrooms between 0 and 30),
  check (cardinality(neighborhoods) <= 16),
  check (not enabled or (max_rent is not null and cardinality(neighborhoods) > 0))
);

insert into public.board_search default values;

revoke all on public.board_search from public, anon, authenticated;
grant select, update (enabled, neighborhoods, max_rent, min_bedrooms) on public.board_search to authenticated;
grant select on public.board_search to service_role;
alter table public.board_search enable row level security;

create policy "Members can read search preferences"
on public.board_search for select to authenticated
using (exists (select from public.board_members where user_id = (select auth.uid())));

create policy "Members can edit search preferences"
on public.board_search for update to authenticated
using (exists (select from public.board_members where user_id = (select auth.uid())));

create table public.board_search_runs (
  run_day date primary key
);

revoke all on public.board_search_runs from public, anon, authenticated;
grant select, insert on public.board_search_runs to service_role;
alter table public.board_search_runs enable row level security;

create table public.listing_lookup_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lookup_day date not null,
  calls integer not null
);

revoke all on public.listing_lookup_usage from public, anon, authenticated;
alter table public.listing_lookup_usage enable row level security;

create function public.claim_listing_lookup()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  member uuid := auth.uid();
  today date := (now() at time zone 'UTC')::date;
begin
  if not exists (select from public.board_members where user_id = member) then
    return false;
  end if;

  insert into public.listing_lookup_usage as daily (user_id, lookup_day, calls)
  values (member, today, 1)
  on conflict (user_id) do update
    set lookup_day = today,
        calls = case when daily.lookup_day = today then daily.calls + 1 else 1 end
    where daily.lookup_day <> today or daily.calls < 25;
  return found;
end;
$$;

revoke all on function public.claim_listing_lookup() from public, anon, authenticated;
grant execute on function public.claim_listing_lookup() to authenticated;

commit;
