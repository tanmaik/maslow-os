-- A record or an edge is named by ten characters, not a uuid: short enough
-- to read aloud and cheap for an agent to carry, with fifty random bits
-- behind it. The alphabet has no i, l, o or u, so nothing reads two ways.
create function short_id() returns text language sql volatile as $$
  select string_agg(
    substr('0123456789abcdefghjkmnpqrstvwxyz',
      get_byte(b, case when i < 6 then i else i + 3 end) % 32 + 1, 1),
    '' order by i)
  from uuid_send(gen_random_uuid()) as b, generate_series(0, 9) as i
$$;

-- Every row that names a record or an edge changes type together, so the
-- policies and functions that read those columns step aside first and come
-- back below, unchanged but for the type.
drop policy see on records;
drop policy own on records;
drop policy change on records;
drop policy see on edges;
drop policy link on edges;
drop policy change on edges;
drop policy unlink on edges;
drop policy see on grants;
drop policy give on grants;
drop policy change on grants;
drop policy take on grants;
drop policy see on events;
drop function may_grant(uuid, uuid);
drop function access_level(uuid);
drop function grant_level(uuid);
drop function same_record(uuid);
alter table records
  drop constraint records_org_id_person_id_merged_into_fkey;
alter table edges
  drop constraint edges_org_id_from_id_fkey,
  drop constraint edges_org_id_to_id_fkey;
alter table grants drop constraint grants_org_id_record_id_fkey;

-- Existing rows are renamed, not rewritten: no version moves and nothing is
-- logged.
alter table records disable trigger user;
alter table edges disable trigger user;

create temp table renamed (
  old text primary key,
  new text not null unique default short_id()
);
insert into renamed (old) select id::text from records;
insert into renamed (old) select id::text from edges;
-- Rows the log remembers but the tables no longer hold are renamed too, so
-- history reads in one alphabet.
insert into renamed (old)
  select distinct named from events e, unnest(array[
      e.subject_id::text,
      e.before ->> 'merged_into', e.after ->> 'merged_into',
      e.before ->> 'from_id', e.after ->> 'from_id',
      e.before ->> 'to_id', e.after ->> 'to_id']) as named
  where e.subject in ('record', 'edge') and named is not null
  on conflict do nothing;

alter table records
  alter column id type text using id::text,
  alter column merged_into type text using merged_into::text;
alter table edges
  alter column id type text using id::text,
  alter column from_id type text using from_id::text,
  alter column to_id type text using to_id::text;
alter table grants alter column record_id type text using record_id::text;
alter table events alter column subject_id type text using subject_id::text;

update records r set id = m.new from renamed m where m.old = r.id;
update records r set merged_into = m.new
  from renamed m where m.old = r.merged_into;
update edges e set id = m.new from renamed m where m.old = e.id;
update edges e set from_id = m.new from renamed m where m.old = e.from_id;
update edges e set to_id = m.new from renamed m where m.old = e.to_id;
update grants g set record_id = m.new from renamed m where m.old = g.record_id;
update events e set subject_id = m.new
  from renamed m where m.old = e.subject_id;

-- The log's copies of each row carry the old names too.
create function rename_in(row_ jsonb, key text) returns jsonb
  language sql stable as $$
  select case
    when row_ ? key and exists (select 1 from renamed where old = row_ ->> key)
      then jsonb_set(row_, array[key],
        to_jsonb((select new from renamed where old = row_ ->> key)))
    else row_ end
$$;
update events set
  before = rename_in(rename_in(before, 'id'), 'merged_into'),
  after = rename_in(rename_in(after, 'id'), 'merged_into')
  where subject = 'record';
update events set
  before = rename_in(rename_in(rename_in(before, 'id'), 'from_id'), 'to_id'),
  after = rename_in(rename_in(rename_in(after, 'id'), 'from_id'), 'to_id')
  where subject = 'edge';
drop function rename_in(jsonb, text);
drop table renamed;

alter table records alter column id set default short_id();
alter table edges alter column id set default short_id();
alter table records
  add foreign key (org_id, person_id, merged_into)
  references records (org_id, person_id, id);
alter table edges
  add foreign key (org_id, from_id) references records (org_id, id),
  add foreign key (org_id, to_id) references records (org_id, id);
alter table grants
  add foreign key (org_id, record_id) references records (org_id, id)
  on delete cascade;

alter table records enable trigger user;
alter table edges enable trigger user;

create function same_record(root text) returns setof text
  language sql stable as $$
  with recursive same as (
    select root as id
    union
    select r.id from records r join same on r.merged_into = same.id
  )
  select id from same
$$;

create function grant_level(record text) returns integer
  language sql stable security definer set search_path = public as $$
  select coalesce(
    max(case g.level when 'owner' then 3 when 'edit' then 2 else 1 end), 0)
  from records r
  join grants g on g.org_id = r.org_id
    and (g.record_id = r.id or g.kind_id = (
      select k.id from record_kinds k
      where k.org_id = r.org_id and k.person_id = r.person_id
        and k.name = r.kind))
  where r.id = record and r.org_id = current_org()
    and (g.subject = 'everyone'
      or g.member_id = current_member()
      or exists (
        select 1 from group_members m
        where m.group_id = g.group_id
          and m.member_id = current_member()))
$$;
revoke all on function grant_level(text) from public;
grant execute on function grant_level(text) to app;

create function access_level(record text) returns text
  language sql stable as $$
  select case greatest(
      case when exists (
        select 1 from records r
        where r.id = record and r.person_id = current_member()) then 3
        else 0 end,
      grant_level(record))
    when 3 then 'owner' when 2 then 'edit' when 1 then 'view' end
$$;

create function may_grant(record text, kind uuid) returns boolean
  language sql stable as $$
  select case
    when record is not null then access_level(record) = 'owner'
    else exists (select 1 from record_kinds k
      where k.id = kind and k.person_id = current_member()) end
$$;

create or replace function log_event() returns trigger
  language plpgsql security definer as $$
declare
  before_row jsonb := case when tg_op = 'INSERT' then null
    else to_jsonb(old) - 'search' end;
  after_row jsonb := case when tg_op = 'DELETE' then null
    else to_jsonb(new) - 'search' end;
  org uuid := (coalesce(after_row, before_row) ->> 'org_id')::uuid;
  action text := case
    when tg_op = 'INSERT' then 'created'
    when tg_op = 'DELETE' then 'deleted'
    when after_row ->> 'deleted_at' is not null
      and before_row ->> 'deleted_at' is null then 'deleted'
    else 'updated' end;
  actor text := case
    when tg_op = 'DELETE' then coalesce(
      nullif(current_setting('app.author', true), ''),
      before_row ->> 'author')
    else after_row ->> 'author' end;
begin
  if not exists (select 1 from orgs where id = org) then return null; end if;
  insert into events
    (org_id, person_id, subject, subject_id, action, author, before, after)
  values (
    org,
    (coalesce(after_row, before_row) ->> 'person_id')::uuid,
    tg_argv[0],
    coalesce(after_row, before_row) ->> 'id',
    action,
    actor,
    before_row,
    after_row
  );
  return null;
end
$$;

create policy see on records for select
  using (org_id = current_org()
    and (person_id = current_member() or grant_level(id) >= 1));
create policy own on records for insert
  with check (org_id = current_org() and person_id = current_member());
create policy change on records for update
  using (org_id = current_org()
    and (person_id = current_member() or grant_level(id) >= 2))
  with check (org_id = current_org()
    and (person_id = current_member() or grant_level(id) >= 2));

create policy see on edges for select
  using (org_id = current_org()
    and (person_id = current_member()
      or (exists (select 1 from records r where r.id = from_id)
        and exists (select 1 from records r where r.id = to_id))));
create policy link on edges for insert
  with check (org_id = current_org() and person_id = current_member()
    and exists (select 1 from records r
      where r.id = from_id
        and (r.person_id = current_member() or grant_level(r.id) >= 2))
    and exists (select 1 from records r where r.id = to_id));
create policy change on edges for update
  using (org_id = current_org()
    and (person_id = current_member()
      or exists (select 1 from records r
        where r.id = from_id
          and (r.person_id = current_member() or grant_level(r.id) >= 2))))
  with check (org_id = current_org()
    and exists (select 1 from records r
      where r.id = from_id
        and (r.person_id = current_member() or grant_level(r.id) >= 2))
    and exists (select 1 from records r where r.id = to_id));
create policy unlink on edges for delete
  using (org_id = current_org()
    and (person_id = current_member()
      or exists (select 1 from records r
        where r.id = from_id
          and (r.person_id = current_member() or grant_level(r.id) >= 2))));

create policy see on grants for select
  using (org_id = current_org()
    and (exists (select 1 from records r where r.id = record_id)
      or exists (select 1 from record_kinds k where k.id = kind_id)));
create policy give on grants for insert
  with check (org_id = current_org() and may_grant(record_id, kind_id));
create policy change on grants for update
  using (org_id = current_org() and may_grant(record_id, kind_id));
create policy take on grants for delete
  using (org_id = current_org() and may_grant(record_id, kind_id));

-- A change is seen by whoever can see what changed, looked up in the table
-- its subject names: records and edges draw ids from separate wells, and a
-- kind's and a field's stay uuids.
create policy see on events for select
  using (org_id = current_org()
    and (person_id is null
      or person_id = current_member()
      or case subject
        when 'record' then
          exists (select 1 from records r where r.id = subject_id)
        when 'edge' then
          exists (select 1 from edges e where e.id = subject_id)
        when 'kind' then
          exists (select 1 from record_kinds k where k.id::text = subject_id)
        when 'property' then
          exists (select 1 from kind_properties p
            where p.id::text = subject_id)
        else false end));
