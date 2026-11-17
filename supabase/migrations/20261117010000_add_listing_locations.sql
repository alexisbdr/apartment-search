begin;

alter table public.listings
  add column street_address text not null default '' check (length(street_address) <= 200),
  add column latitude double precision,
  add column longitude double precision,
  add constraint listings_coordinates_pair check (
    (latitude is null and longitude is null) or
    (latitude is not null and longitude is not null and
      latitude between 40.55 and 40.75 and longitude between -74.1 and -73.8)
  );

grant insert (street_address, latitude, longitude) on public.listings to authenticated;
grant update (street_address, latitude, longitude) on public.listings to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and
    not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'listings'
    )
  then
    alter publication supabase_realtime add table public.listings;
  end if;
end;
$$;

commit;
