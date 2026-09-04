-- A backup is an archive of a person's disk in the bucket, made by their
-- machine on a schedule. The row is opened before the first byte is sent
-- and closed with the size the bucket confirms; the last seven finished
-- ones are kept, and a row whose object is gone stays, marked, for the
-- meter.
create table backups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id),
  user_id uuid not null,
  key text not null unique,
  upload_id text,
  size bigint,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  deleted_at timestamptz,
  foreign key (org_id, user_id) references users (org_id, id)
);
create index backups_by_member on backups (org_id, user_id, started_at);

alter table backups enable row level security;
alter table backups force row level security;
create policy own on backups
  using (org_id = current_org() and user_id = current_member());
create policy meter on backups
  using (org_id = current_org() and current_setting('app.meter', true) = 'sweep');
grant select, insert, update, delete on backups to app;
