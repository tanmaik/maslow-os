-- The proving schema: enough to show row-level isolation between orgs.
-- Replaced by the real model once the product's shape is decided.

create table orgs (
  id uuid primary key,
  slug text not null unique,
  name text not null
);

create table users (
  id uuid primary key,
  org_id uuid not null references orgs (id),
  email text not null unique,
  name text not null
);

alter table orgs enable row level security;
alter table orgs force row level security;
alter table users enable row level security;
alter table users force row level security;

-- A connection sees exactly the org named in app.org_id, and nothing when it
-- is unset.
create policy org_isolation on orgs
  using (id = current_setting('app.org_id', true)::uuid);
create policy org_isolation on users
  using (org_id = current_setting('app.org_id', true)::uuid);

grant select, insert, update, delete on orgs, users to app;
