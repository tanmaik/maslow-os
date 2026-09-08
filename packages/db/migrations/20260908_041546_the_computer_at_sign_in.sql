-- A computer is a Fly machine on a disk, one per membership, made at the
-- first sign-in. The row is claimed before anything is made and each Fly
-- id is written the moment Fly hands it back, so nothing that costs money
-- is unrecorded for longer than one request.
create table computers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  user_id uuid not null,
  region text not null,
  cpus int not null,
  memory_mb int not null,
  disk_gb int not null,
  -- Opens VS Code on the machine until a ticket from our sign-in does.
  secret text not null,
  volume_id text unique,
  machine_id text unique,
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, user_id),
  foreign key (org_id, user_id) references users (org_id, id) on delete cascade
);
alter table computers enable row level security;
alter table computers force row level security;
create policy org_isolation on computers using (org_id = current_org());
grant select, insert, update, delete on computers to app;

-- The ledger: every resource event, whose, what, how much, and why. It
-- records what happened to resources, never what is in files or
-- conversations, and nothing shows it to the person.
create table ledger (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  org_id uuid not null,
  user_id uuid,
  -- machine | disk
  resource text not null,
  -- made | started | stopped | destroyed
  event text not null,
  -- The vendor's own id for it.
  ref text,
  detail jsonb not null default '{}',
  why text not null
);
create index ledger_by_org on ledger (org_id, at);
alter table ledger enable row level security;
alter table ledger force row level security;
create policy org_isolation on ledger using (org_id = current_org());
grant select, insert on ledger to app;

-- A purged member's computer is owed to Fly before its row goes; the
-- sweep destroys the machine and the disk. The computer is held first, so
-- a make in flight finishes writing its ids before they are read.
alter table orphans drop constraint orphans_kind_check,
  add constraint orphans_kind_check check (kind in ('accounts', 'picture', 'computer'));
create or replace function purge_member(member uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  perform 1 from users
    where id = member and org_id = current_org() and removed_at is not null;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtext('computer:' || id::text))
    from computers where org_id = current_org() and user_id = member;
  insert into orphans (org_id, kind, ref)
    select org_id, 'computer', coalesce(machine_id, '') || ':' || coalesce(volume_id, '')
    from computers where org_id = current_org() and user_id = member;
  delete from computers where org_id = current_org() and user_id = member;
  delete from edges where org_id = current_org() and person_id = member;
  delete from records where org_id = current_org() and person_id = member;
  delete from types where org_id = current_org() and person_id = member;
  delete from events where org_id = current_org() and person_id = member;
  delete from users where id = member and org_id = current_org();
  return true;
end
$$;
