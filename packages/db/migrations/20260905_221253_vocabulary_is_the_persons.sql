-- The vocabulary is the person's. A kind, a verb and a field belong to the
-- member who defined them, like a record; two members may each have a kind
-- named note. A kind is shared the way a record is, through a grant, and a
-- grant on a kind reaches every record of it.

-- The org-wide keys go first; the person's come back below.
alter table records drop constraint records_org_id_kind_fkey;
alter table edges drop constraint edges_org_id_verb_fkey;
alter table kind_properties drop constraint kind_properties_org_id_kind_fkey;
alter table record_kinds drop constraint record_kinds_org_id_name_key;
alter table edge_verbs drop constraint edge_verbs_org_id_name_key;
alter table kind_properties drop constraint kind_properties_org_id_kind_name_key;

alter table record_kinds add column person_id uuid;
alter table edge_verbs add column person_id uuid;
alter table kind_properties add column person_id uuid;

-- What exists goes to the member who defined it, when the author names one
-- still on the books, else to the org's principal.
create function vocabulary_owner(org uuid, author text) returns uuid
  language sql stable as $$
  select coalesce(
    (select u.id from users u
     where u.org_id = org
       and u.id = case when author ~ '^person:[0-9a-f-]{36}$'
         then substr(author, 8)::uuid end),
    (select principal_id from orgs where id = org))
$$;
update record_kinds set person_id = vocabulary_owner(org_id, author);
update edge_verbs set person_id = vocabulary_owner(org_id, author);
update kind_properties p set person_id = k.person_id
  from record_kinds k where k.org_id = p.org_id and k.name = p.kind;
drop function vocabulary_owner(uuid, text);

-- A record is of its owner's kind and an edge carries its maker's verb, so
-- every other member who wrote one gets the definition too, as it stood.
insert into record_kinds
  (org_id, person_id, name, description, author, created_at)
select distinct r.org_id, r.person_id, k.name, k.description, k.author,
  k.created_at
from records r
join record_kinds k on k.org_id = r.org_id and k.name = r.kind
where k.person_id <> r.person_id;
insert into kind_properties
  (org_id, person_id, kind, name, type, description, required, options,
   author, created_at)
select k.org_id, k.person_id, p.kind, p.name, p.type, p.description,
  p.required, p.options, p.author, p.created_at
from kind_properties p
join record_kinds k
  on k.org_id = p.org_id and k.name = p.kind and k.person_id <> p.person_id;
insert into edge_verbs
  (org_id, person_id, name, description, author, created_at)
select distinct e.org_id, e.person_id, v.name, v.description, v.author,
  v.created_at
from edges e
join edge_verbs v on v.org_id = e.org_id and v.name = e.verb
where v.person_id <> e.person_id;

-- What the log said about a kind, a verb or a field is its owner's too.
update events e set person_id = k.person_id from record_kinds k
  where e.subject = 'kind' and e.subject_id = k.id and e.person_id is null;
update events e set person_id = v.person_id from edge_verbs v
  where e.subject = 'verb' and e.subject_id = v.id and e.person_id is null;
update events e set person_id = p.person_id from kind_properties p
  where e.subject = 'property' and e.subject_id = p.id
    and e.person_id is null;

alter table record_kinds
  alter column person_id set default current_member(),
  alter column person_id set not null,
  add foreign key (org_id, person_id) references users (org_id, id),
  add unique (org_id, person_id, name),
  add unique (org_id, id);
alter table edge_verbs
  alter column person_id set default current_member(),
  alter column person_id set not null,
  add foreign key (org_id, person_id) references users (org_id, id),
  add unique (org_id, person_id, name);
alter table kind_properties
  alter column person_id set default current_member(),
  alter column person_id set not null,
  add foreign key (org_id, person_id) references users (org_id, id),
  add unique (org_id, person_id, kind, name),
  add foreign key (org_id, person_id, kind)
    references record_kinds (org_id, person_id, name)
    on update cascade on delete cascade;
alter table records
  add foreign key (org_id, person_id, kind)
    references record_kinds (org_id, person_id, name) on update cascade;
alter table edges
  add foreign key (org_id, person_id, verb)
    references edge_verbs (org_id, person_id, name) on update cascade;

-- A grant is on one record or on one kind.
alter table grants
  alter column record_id drop not null,
  add column kind_id uuid,
  add foreign key (org_id, kind_id) references record_kinds (org_id, id)
    on delete cascade,
  add check ((record_id is null) <> (kind_id is null)),
  drop constraint grants_org_id_record_id_subject_member_id_group_id_key,
  add unique nulls not distinct
    (org_id, record_id, kind_id, subject, member_id, group_id);
create index grants_by_kind on grants (kind_id);

-- The highest level any grant gives the current member on a record, on the
-- record itself or on its kind: 0 none, 1 view, 2 edit, 3 owner.
create or replace function grant_level(record uuid) returns integer
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

-- How a kind reaches the current member when it is not their own: through
-- a grant on the kind itself or on one of its records, to everyone or to
-- them. One of kind:everyone, kind:you, record:everyone, record:you, the
-- whole kind and the wider audience first; null when it does not reach.
create function kind_reach(kind uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when g.kind_id is not null then 'kind' else 'record' end
    || ':' || case when g.subject = 'everyone' then 'everyone' else 'you' end
  from record_kinds k
  join grants g on g.org_id = k.org_id
    and (g.kind_id = k.id or g.record_id in (
      select r.id from records r
      where r.org_id = k.org_id and r.person_id = k.person_id
        and r.kind = k.name))
  where k.id = kind and k.org_id = current_org()
    and (g.subject = 'everyone'
      or g.member_id = current_member()
      or exists (
        select 1 from group_members m
        where m.group_id = g.group_id
          and m.member_id = current_member()))
  order by g.kind_id is null, g.subject <> 'everyone'
  limit 1
$$;
revoke all on function kind_reach(uuid) from public;
grant execute on function kind_reach(uuid) to app;

-- A kind is seen by its owner and by whoever it reaches, and written by its
-- owner alone. Its fields go with it. A verb is its owner's.
drop policy org_isolation on record_kinds;
create policy see on record_kinds for select
  using (org_id = current_org()
    and (person_id = current_member() or kind_reach(id) is not null));
create policy own on record_kinds for all
  using (org_id = current_org() and person_id = current_member())
  with check (org_id = current_org() and person_id = current_member());

drop policy org_isolation on kind_properties;
create policy see on kind_properties for select
  using (org_id = current_org()
    and (person_id = current_member()
      or exists (select 1 from record_kinds k
        where k.org_id = kind_properties.org_id
          and k.person_id = kind_properties.person_id
          and k.name = kind_properties.kind)));
create policy own on kind_properties for all
  using (org_id = current_org() and person_id = current_member())
  with check (org_id = current_org() and person_id = current_member());

drop policy org_isolation on edge_verbs;
create policy own on edge_verbs
  using (org_id = current_org() and person_id = current_member())
  with check (org_id = current_org() and person_id = current_member());

-- A grant is seen by whoever can see what it is on, and given, changed and
-- taken by a record's owner or the kind's.
drop policy see on grants;
drop policy give on grants;
drop policy change on grants;
drop policy take on grants;
create function may_grant(record uuid, kind uuid) returns boolean
  language sql stable as $$
  select case
    when record is not null then access_level(record) = 'owner'
    else exists (select 1 from record_kinds k
      where k.id = kind and k.person_id = current_member()) end
$$;
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
        when 'kind' then
          exists (select 1 from record_kinds k where k.id = subject_id)
        when 'property' then
          exists (select 1 from kind_properties p where p.id = subject_id)
        else false end));

-- Purging a past member takes their vocabulary with everything else.
create or replace function purge_member(member uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  perform 1 from users
    where id = member and org_id = current_org() and removed_at is not null;
  if not found then return false; end if;
  delete from edges where org_id = current_org() and person_id = member;
  delete from records where org_id = current_org() and person_id = member;
  delete from record_kinds
    where org_id = current_org() and person_id = member;
  delete from edge_verbs where org_id = current_org() and person_id = member;
  delete from events where org_id = current_org() and person_id = member;
  delete from users where id = member and org_id = current_org();
  return true;
end
$$;
