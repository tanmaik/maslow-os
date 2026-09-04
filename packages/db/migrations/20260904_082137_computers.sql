-- A computer is a Fly machine with a volume, one per membership. The row is
-- reserved before anything is made, and each id is written the moment Fly
-- returns it, so nothing that costs money is unrecorded for longer than one
-- request. Every change of state is an event, so what is consumed is
-- measured from the first day whether or not it is charged yet.
create table computers (
  id uuid primary key,
  org_id uuid not null default current_org() references orgs (id),
  user_id uuid not null,
  region text not null,
  size text not null,
  disk_gb int not null,
  -- What the machine's daemon expects from us, and nobody else.
  secret text not null,
  volume_id text unique,
  machine_id text unique,
  -- building | failed | or a state as Fly reports it
  state text not null default 'building',
  -- Held by the one request making the next Fly call, for two minutes at
  -- most, so looks that race make one volume and one machine.
  busy_until timestamptz,
  -- What the machine last reported of itself, and when.
  seen_at timestamptz,
  disk_used bigint,
  disk_total bigint,
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  foreign key (org_id, user_id) references users (org_id, id)
);
create table computer_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id),
  computer_id uuid not null references computers (id),
  -- created | start | stop | or a state as Fly reports it
  kind text not null,
  size text not null,
  disk_gb int not null,
  at timestamptz not null default now()
);
create index computer_events_by_computer on computer_events (computer_id, at);

alter table computers enable row level security;
alter table computers force row level security;
alter table computer_events enable row level security;
alter table computer_events force row level security;
create policy org_isolation on computers using (org_id = current_org());
-- A machine reports on itself with its id and its secret, and sees nothing
-- else.
create policy reporting on computers
  using (machine_id = nullif(current_setting('app.machine_id', true), '')
    and secret = nullif(current_setting('app.machine_secret', true), ''));
create policy org_isolation on computer_events using (org_id = current_org());
grant select, insert, update, delete on computers to app;
grant select, insert, delete on computer_events to app;

-- Until billing exists no org but the house one may have computers: a
-- machine costs money, and nothing that costs money exists without a
-- payment method behind it.
alter table orgs add column computers boolean not null default false;
update orgs set computers = true where id = '6c25ac62-38ed-48ce-85b8-497c47aaf779';
