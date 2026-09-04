-- Sharing inside an org. A group is a set of members. A grant lets a member,
-- a group, or everyone in the org see, edit or own one record. The most any
-- path gives a member is what they may do.

-- A record is named by its org and id alone, since a grant or an edge may
-- come from another member.
alter table records add unique (org_id, id);

create table groups (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org()
    references orgs (id) on delete cascade,
  name text not null check (name <> ''),
  description text not null default '',
  author text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name),
  unique (org_id, id)
);

create table group_members (
  group_id uuid not null references groups (id) on delete cascade,
  org_id uuid not null default current_org(),
  member_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (group_id, member_id),
  foreign key (org_id, member_id) references users (org_id, id)
    on delete cascade
);

-- A grant: one member, one group, or everyone in the org may do this much
-- with one record.
create table grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org()
    references orgs (id) on delete cascade,
  record_id uuid not null,
  subject text not null check (subject in ('member', 'group', 'everyone')),
  member_id uuid,
  group_id uuid,
  level text not null check (level in ('view', 'edit', 'owner')),
  author text not null,
  created_at timestamptz not null default now(),
  check (case subject
    when 'member' then member_id is not null and group_id is null
    when 'group' then group_id is not null and member_id is null
    else member_id is null and group_id is null end),
  check (subject <> 'everyone' or level = 'view'),
  foreign key (org_id, record_id) references records (org_id, id)
    on delete cascade,
  foreign key (org_id, member_id) references users (org_id, id)
    on delete cascade,
  foreign key (org_id, group_id) references groups (org_id, id)
    on delete cascade,
  unique nulls not distinct (org_id, record_id, subject, member_id, group_id)
);

create index grants_by_record on grants (record_id);
create index grants_by_member on grants (org_id, member_id);
create index grants_by_group on grants (org_id, group_id);

-- The highest level any grant gives the current member on a record: 0 none,
-- 1 view, 2 edit, 3 owner.
create function grant_level(record uuid) returns integer
  language sql stable security definer set search_path = public as $$
  select coalesce(
    max(case g.level when 'owner' then 3 when 'edit' then 2 else 1 end), 0)
  from grants g
  where g.record_id = record and g.org_id = current_org()
    and (g.subject = 'everyone'
      or g.member_id = current_member()
      or exists (
        select 1 from group_members m
        where m.group_id = g.group_id
          and m.member_id = current_member()))
$$;
revoke all on function grant_level(uuid) from public;
grant execute on function grant_level(uuid) to app;

-- What the current member may do with a record: owner if they wrote it,
-- else the most any grant gives them, else nothing.
create function access_level(record uuid) returns text
  language sql stable as $$
  select case greatest(
      case when exists (
        select 1 from records r
        where r.id = record and r.person_id = current_member()) then 3
        else 0 end,
      grant_level(record))
    when 3 then 'owner' when 2 then 'edit' when 1 then 'view' end
$$;

-- Whether the current member is an owner of the org.
create function is_org_owner() returns boolean language sql stable as $$
  select exists (
    select 1 from users u
    where u.id = current_member() and u.org_id = current_org()
      and u.role = 'owner' and u.removed_at is null)
$$;

alter table groups enable row level security;
alter table groups force row level security;
alter table group_members enable row level security;
alter table group_members force row level security;
alter table grants enable row level security;

create policy see on groups for select using (org_id = current_org());
create policy manage on groups for all
  using (org_id = current_org() and is_org_owner())
  with check (org_id = current_org() and is_org_owner());
create policy see on group_members for select
  using (org_id = current_org());
create policy manage on group_members for all
  using (org_id = current_org() and is_org_owner())
  with check (org_id = current_org() and is_org_owner());

create policy see on grants for select
  using (org_id = current_org()
    and exists (select 1 from records r where r.id = record_id));
create policy give on grants for insert
  with check (org_id = current_org()
    and exists (select 1 from records r
      where r.id = record_id and access_level(r.id) = 'owner'));
create policy change on grants for update
  using (org_id = current_org()
    and exists (select 1 from records r
      where r.id = record_id and access_level(r.id) = 'owner'));
create policy take on grants for delete
  using (org_id = current_org()
    and exists (select 1 from records r
      where r.id = record_id and access_level(r.id) = 'owner'));

-- A record is seen by its owner and whoever holds a grant on it, changed
-- by its owner and editors, and written only by its owner.
drop policy person_isolation on records;
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

-- An edge is seen when both its ends are, made by an editor of its from-end
-- who can see its to-end, and changed by whoever made it or owns its from-end.
drop policy person_isolation on edges;
alter table edges drop constraint edges_org_id_person_id_from_id_fkey;
alter table edges drop constraint edges_org_id_person_id_to_id_fkey;
alter table edges add foreign key (org_id, from_id) references records (org_id, id);
alter table edges add foreign key (org_id, to_id) references records (org_id, id);
create policy see on edges for select
  using (org_id = current_org()
    and exists (select 1 from records r where r.id = from_id)
    and exists (select 1 from records r where r.id = to_id));
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
          and (r.person_id = current_member() or grant_level(r.id) >= 3))))
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
          and (r.person_id = current_member() or grant_level(r.id) >= 3))));

-- A change is seen by whoever can see what changed.
drop policy person_isolation on events;
create policy see on events for select
  using (org_id = current_org()
    and (person_id is null
      or person_id = current_member()
      or exists (select 1 from records r where r.id = subject_id)
      or exists (select 1 from edges e where e.id = subject_id)));

grant select, insert, update, delete on groups, group_members, grants to app;
