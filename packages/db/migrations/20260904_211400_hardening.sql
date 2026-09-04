-- A machine's secret is the key to its owner's disk and shell: it lives in
-- its own table that only its owner, the machine itself and the sweep can
-- read, never the org at large.
create table computer_secrets (
  computer_id uuid primary key references computers (id) on delete cascade,
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  user_id uuid not null,
  secret text not null
);
insert into computer_secrets (computer_id, org_id, user_id, secret)
  select id, org_id, user_id, secret from computers;
-- The old reporting policy read the column; it goes first, and comes back
-- below reading the secrets table.
drop policy reporting on computers;
alter table computers drop column secret;
alter table computer_secrets enable row level security;
alter table computer_secrets force row level security;
create policy own on computer_secrets
  using (org_id = current_org() and user_id = current_member());
create policy meter on computer_secrets for select
  using (org_id = current_org() and current_setting('app.meter', true) = 'sweep');
-- The secret alone names the row here; the machine id is checked by the
-- computers policy, which looks this way and not back again.
create policy reporting on computer_secrets for select
  using (secret = nullif(current_setting('app.machine_secret', true), ''));
grant select, insert, delete on computer_secrets to app;

-- A machine reports on itself by its id and its secret; the row it may see
-- is the one whose secret matches.
create policy reporting on computers
  using (machine_id = nullif(current_setting('app.machine_id', true), '')
    and id in (select computer_id from computer_secrets
               where secret = nullif(current_setting('app.machine_secret', true), '')));

-- An org goes with everything in it. What the vendors hold for it is owed
-- first, by the app, in the same transaction; the rows then follow the org.
alter table computers drop constraint computers_org_id_fkey,
  add constraint computers_org_id_fkey foreign key (org_id) references orgs (id) on delete cascade;
alter table computer_events drop constraint computer_events_org_id_fkey,
  add constraint computer_events_org_id_fkey foreign key (org_id) references orgs (id) on delete cascade;
alter table computer_events drop constraint computer_events_computer_id_fkey,
  add constraint computer_events_computer_id_fkey foreign key (computer_id) references computers (id) on delete cascade;
alter table files drop constraint files_org_id_fkey,
  add constraint files_org_id_fkey foreign key (org_id) references orgs (id) on delete cascade;
alter table backups drop constraint backups_org_id_fkey,
  add constraint backups_org_id_fkey foreign key (org_id) references orgs (id) on delete cascade;

-- The sweep reads every org's computers to reconcile them against Fly.
create policy meter on computers for select
  using (current_setting('app.meter', true) = 'sweep');
