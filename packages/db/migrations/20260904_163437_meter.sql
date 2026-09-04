-- What every person and org costs us, measured from what we record and
-- priced from each vendor's list. A row holds a quantity in the vendor's
-- own unit over a window, and the price it was charged at, so a price
-- change never rewrites history. The sweep appends; nothing edits.
create table usage (
  id uuid primary key default gen_random_uuid(),
  -- No reference to orgs: what an org cost is history, and history stays.
  org_id uuid not null,
  -- The membership it belongs to; a past member's things still cost.
  user_id uuid not null,
  -- compute | disk | bucket | brain
  resource text not null,
  -- second | gb_second | byte_second
  unit text not null,
  quantity numeric not null check (quantity >= 0),
  -- Dollars per unit, and dollars.
  price numeric not null,
  cost numeric not null,
  from_at timestamptz not null,
  to_at timestamptz not null check (to_at > from_at),
  unique (org_id, user_id, resource, from_at)
);
create index usage_by_org_time on usage (org_id, to_at);

alter table usage enable row level security;
alter table usage force row level security;
create policy org_isolation on usage using (org_id = current_org());
grant select, insert on usage to app;

-- What a removal or purge still owes the vendors: a machine to stop or
-- destroy, a volume to destroy, an object or an unfinished upload to delete.
-- Written in the same transaction as the rows that named them, so the rows
-- can go first and nothing is forgotten; settled by the route at once and by
-- the sweep until each is gone.
create table orphans (
  id uuid primary key default gen_random_uuid(),
  -- No reference to orgs: a deleted org's debts are still paid.
  org_id uuid not null,
  kind text not null check (kind in ('stop', 'machine', 'volume', 'object', 'upload')),
  ref text not null,
  extra text,
  tries int not null default 0,
  created_at timestamptz not null default now()
);
alter table orphans enable row level security;
alter table orphans force row level security;
create policy org_isolation on orphans using (org_id = current_org());
create policy meter on orphans for select
  using (current_setting('app.meter', true) = 'sweep');
grant select, insert, update, delete on orphans to app;

-- A machine reporting on itself leaves a mark in its own computer's events.
create policy reporting on computer_events for insert
  with check (computer_id in (select id from computers));
-- The sweep, named, sees every file in the org it is walking.
create policy meter on files for select
  using (org_id = current_org() and current_setting('app.meter', true) = 'sweep');

-- The sweep names itself and sees every org, to walk them one at a time.
create policy meter on orgs for select
  using (current_setting('app.meter', true) = 'sweep');
