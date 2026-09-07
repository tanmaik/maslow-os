-- The brain holds what the product reads and nothing kept for the record;
-- the log has that. A verb is the word on an edge and no longer a row. A
-- type and its fields have a name and a shape, no description. No row says
-- who wrote it or when: every change is a line in the log, with its author.
-- Kinds are types and grants are shares.

-- Who made a change is the transaction's to say and the log's to keep.
create or replace function log_event() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  before_row jsonb := case when tg_op = 'INSERT' then null
    else to_jsonb(old) - 'search' end;
  after_row jsonb := case when tg_op = 'DELETE' then null
    else to_jsonb(new) - 'search' end;
  action text := case
    when tg_op = 'INSERT' then 'created'
    when tg_op = 'DELETE' then 'deleted'
    when after_row ->> 'deleted_at' is not null
      and before_row ->> 'deleted_at' is null then 'deleted'
    else 'updated' end;
begin
  perform write_event(
    (coalesce(after_row, before_row) ->> 'org_id')::uuid,
    (coalesce(after_row, before_row) ->> 'person_id')::uuid,
    tg_argv[0],
    coalesce(after_row, before_row) ->> 'id',
    action, actor_now(null), before_row, after_row);
  return null;
end
$$;

-- A verb is the word on an edge.
alter table edges drop constraint edges_org_id_person_id_verb_fkey;
drop table edge_verbs;

-- A type: a name, and the fields it declares.
alter table record_kinds rename to types;
alter table types
  drop column description,
  drop column author,
  drop column created_at;
drop trigger record_kinds_events on types;
create trigger types_events after insert or update or delete on types
  for each row execute function log_event('type');

alter table kind_properties rename to type_properties;
alter table type_properties rename column type to datatype;
alter table type_properties rename column kind to type;
alter table type_properties
  drop column description,
  drop column author,
  drop column created_at;
alter trigger kind_properties_events on type_properties
  rename to type_properties_events;

-- A record: its type, what it says, when it happened and how sure. Whether
-- it is a conclusion is whether it carries a confidence.
alter table records rename column kind to type;
alter table records
  drop column layer,
  drop column author,
  drop column version;
alter index records_by_kind rename to records_by_type;
create or replace function touch_record() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end
$$;

alter table edges drop column author;

-- A share: who may do what with one record or one type.
alter table grants rename to shares;
alter table shares rename column kind_id to type_id;
alter table shares
  drop column author,
  drop column created_at;
alter index grants_by_record rename to shares_by_record;
alter index grants_by_member rename to shares_by_member;
alter index grants_by_group rename to shares_by_group;
alter index grants_by_kind rename to shares_by_type;
drop trigger grants_events on shares;

-- The log's lines about kinds are about types, and its copies of each row
-- use the new names. Lines about verbs stay as they were written.
alter table events drop constraint events_subject_check;
update events set subject = 'type' where subject = 'kind';
alter table events add check (subject in
  ('record', 'edge', 'type', 'verb', 'property', 'share', 'member'));
create function renamed_key(row_ jsonb, old text, new text) returns jsonb
  language sql immutable as $$
  select case when row_ ? old
    then (row_ - old) || jsonb_build_object(new, row_ -> old)
    else row_ end
$$;
update events set
  before = renamed_key(before, 'kind', 'type'),
  after = renamed_key(after, 'kind', 'type')
  where subject in ('record', 'share')
    and (before ? 'kind' or after ? 'kind');
update events set
  before = renamed_key(renamed_key(before, 'type', 'datatype'), 'kind', 'type'),
  after = renamed_key(renamed_key(after, 'type', 'datatype'), 'kind', 'type')
  where subject = 'property';
drop function renamed_key(jsonb, text, text);

-- The highest level any share gives the current member on a record, on the
-- record itself or on its type: 0 none, 1 view, 2 edit, 3 owner.
alter function grant_level(text) rename to share_level;
create or replace function share_level(record text) returns integer
  language sql stable security definer set search_path = public as $$
  select coalesce(
    max(case s.level when 'owner' then 3 when 'edit' then 2 else 1 end), 0)
  from records r
  join shares s on s.org_id = r.org_id
    and (s.record_id = r.id or s.type_id = (
      select t.id from types t
      where t.org_id = r.org_id and t.person_id = r.person_id
        and t.name = r.type))
  where r.id = record and r.org_id = current_org()
    and (s.subject = 'everyone'
      or s.member_id = current_member()
      or exists (
        select 1 from group_members m
        where m.group_id = s.group_id
          and m.member_id = current_member()))
$$;
create or replace function access_level(record text) returns text
  language sql stable as $$
  select case greatest(
      case when exists (
        select 1 from records r
        where r.id = record and r.person_id = current_member()) then 3
        else 0 end,
      share_level(record))
    when 3 then 'owner' when 2 then 'edit' when 1 then 'view' end
$$;

-- How a type reaches the current member when it is not their own: through
-- a share on the type itself or on one of its records, to everyone or to
-- them. One of type:everyone, type:you, record:everyone, record:you, the
-- whole type and the wider audience first; null when it does not reach.
drop policy see on types;
drop function kind_reach(uuid);
create function type_reach(of_type uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when s.type_id is not null then 'type' else 'record' end
    || ':' || case when s.subject = 'everyone' then 'everyone' else 'you' end
  from types t
  join shares s on s.org_id = t.org_id
    and (s.type_id = t.id or s.record_id in (
      select r.id from records r
      where r.org_id = t.org_id and r.person_id = t.person_id
        and r.type = t.name))
  where t.id = of_type and t.org_id = current_org()
    and (s.subject = 'everyone'
      or s.member_id = current_member()
      or exists (
        select 1 from group_members m
        where m.group_id = s.group_id
          and m.member_id = current_member()))
  order by s.type_id is null, s.subject <> 'everyone'
  limit 1
$$;
revoke all on function type_reach(uuid) from public;
grant execute on function type_reach(uuid) to app;
create policy see on types for select
  using (org_id = current_org()
    and (person_id = current_member() or type_reach(id) is not null));

-- A share is given, changed and taken by a record's owner or the type's.
drop policy give on shares;
drop policy change on shares;
drop policy take on shares;
drop function may_grant(text, uuid);
create function may_share(record text, of_type uuid) returns boolean
  language sql stable as $$
  select case
    when record is not null then access_level(record) = 'owner'
    else exists (select 1 from types t
      where t.id = of_type and t.person_id = current_member()) end
$$;
create policy give on shares for insert
  with check (org_id = current_org() and may_share(record_id, type_id));
create policy change on shares for update
  using (org_id = current_org() and may_share(record_id, type_id));
create policy take on shares for delete
  using (org_id = current_org() and may_share(record_id, type_id));

-- A share as the log keeps it: what was shared, by name, with whom, at
-- what level.
drop function share_row(shares);
create function share_row(s shares) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'org_id', s.org_id,
    'record_id', s.record_id,
    'record', (select title from records where id = s.record_id),
    'type', (select name from types where id = s.type_id),
    'subject', s.subject, 'member_id', s.member_id,
    'group', (select name from groups where id = s.group_id),
    'level', s.level)
$$;
create or replace function log_share() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  s shares;
  owner uuid;
begin
  if tg_op = 'DELETE' then s := old; else s := new; end if;
  owner := coalesce(
    (select person_id from records where id = s.record_id),
    (select person_id from types where id = s.type_id));
  perform write_event(s.org_id, owner, 'share', s.id::text,
    case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted'
      else 'updated' end,
    actor_now(null),
    case when tg_op = 'INSERT' then null else share_row(old) end,
    case when tg_op = 'DELETE' then null else share_row(new) end);
  return null;
end
$$;
create trigger shares_events after insert or update or delete on shares
  for each row execute function log_share();

-- A change is seen by whoever can see what changed.
drop policy see on events;
create policy see on events for select
  using (org_id = current_org()
    and (person_id is null
      or person_id = current_member()
      or case subject
        when 'record' then
          exists (select 1 from records r where r.id = subject_id)
        when 'edge' then
          exists (select 1 from edges e where e.id = subject_id)
        when 'type' then
          exists (select 1 from types t where t.id::text = subject_id)
        when 'property' then
          exists (select 1 from type_properties p
            where p.id::text = subject_id)
        when 'share' then
          exists (select 1 from shares s where s.id::text = subject_id)
        when 'member' then true
        else false end));

-- Purging a past member takes their types with everything else.
create or replace function purge_member(member uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  perform 1 from users
    where id = member and org_id = current_org() and removed_at is not null;
  if not found then return false; end if;
  delete from edges where org_id = current_org() and person_id = member;
  delete from records where org_id = current_org() and person_id = member;
  delete from types where org_id = current_org() and person_id = member;
  delete from events where org_id = current_org() and person_id = member;
  delete from users where id = member and org_id = current_org();
  return true;
end
$$;
