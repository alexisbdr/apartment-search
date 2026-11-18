begin;

alter table public.listings
  add column availability_status text not null default 'unknown'
    check (availability_status in ('unknown', 'active', 'removed')),
  add column availability_reason text not null default '' check (length(availability_reason) <= 200),
  add column availability_checked_at timestamptz;

grant update (availability_status, availability_reason, availability_checked_at) on public.listings to authenticated;
grant update (trashed_at, availability_status, availability_reason, availability_checked_at) on public.listings to service_role;

commit;
