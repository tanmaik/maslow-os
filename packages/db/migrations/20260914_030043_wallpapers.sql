-- The wallpapers a person put in the bucket themselves, and the one their
-- desk wears: a built-in's name, "plain" for the bare ground, or
-- "own:<key>" for one of theirs. A wallpaper is the person's alone.
create table wallpapers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  member_id uuid not null default current_member(),
  -- The object's key in the bucket, and what it weighs, for the meter.
  key text not null,
  bytes bigint not null check (bytes >= 0),
  created_at timestamptz not null default now(),
  foreign key (org_id, member_id) references users (org_id, id) on delete cascade
);
alter table wallpapers enable row level security;
alter table wallpapers force row level security;

create policy own on wallpapers
  using (org_id = current_org() and member_id = current_member())
  with check (org_id = current_org() and member_id = current_member());

grant select, insert, delete on wallpapers to app;

alter table users add column wallpaper text;

-- A wallpaper in the bucket is a picture like any other: it stays until
-- the last row to show it lets it go.
create or replace function picture_in_use(picture text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where avatar_key = picture)
      or exists (select 1 from users where avatar_key = picture)
      or exists (select 1 from orgs where logo_key = picture)
      or exists (select 1 from wallpapers where key = picture)
$$;
