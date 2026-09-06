-- The log covers shares and memberships, counts each person's changes from
-- one, and a link is hidden rather than erased, so every change a person
-- made can be walked back.

-- A link leaves the brain the way a record does.
alter table edges add column deleted_at timestamptz;

alter table events drop constraint events_subject_check;
alter table events add check (subject in
  ('record', 'edge', 'kind', 'verb', 'property', 'share', 'member'));

-- Each person's changes are numbered from one, so their history reads
-- without gaps; what colleagues changed shows between under its own count.
alter table events add column n bigint;
update events e set n = x.n
  from (select seq, row_number() over
          (partition by org_id, person_id order by seq) as n
        from events) x
  where x.seq = e.seq;
alter table events alter column n set not null;
create unique index events_by_person_n on events (org_id, person_id, n);

create table event_counts (
  org_id uuid not null,
  person_id uuid not null,
  last bigint not null,
  primary key (org_id, person_id)
);
insert into event_counts
  select org_id, coalesce(person_id, org_id), max(n) from events
  group by org_id, coalesce(person_id, org_id);

-- Writes one line of the log, as the next of its person's changes. The
-- person's count is held until the transaction commits, so two changes of
-- theirs at once are numbered one after the other.
create function write_event(
  org uuid, person uuid, subject text, subject_id text, action text,
  actor text, before_row jsonb, after_row jsonb
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  nth bigint;
begin
  if not exists (select 1 from orgs where id = org) then return; end if;
  insert into event_counts (org_id, person_id, last)
    values (org, coalesce(person, org), 1)
    on conflict (org_id, person_id)
    do update set last = event_counts.last + 1
    returning last into nth;
  insert into events
    (org_id, person_id, n, subject, subject_id, action, author, before, after)
  values
    (org, person, nth, subject, subject_id, action, actor, before_row, after_row);
end
$$;

create or replace function log_event() returns trigger
  language plpgsql security definer as $$
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
  actor text := coalesce(
    nullif(current_setting('app.author', true), ''),
    coalesce(after_row, before_row) ->> 'author');
begin
  perform write_event(
    (coalesce(after_row, before_row) ->> 'org_id')::uuid,
    (coalesce(after_row, before_row) ->> 'person_id')::uuid,
    tg_argv[0],
    coalesce(after_row, before_row) ->> 'id',
    action, actor, before_row, after_row);
  return null;
end
$$;

-- Who did what in the org, as the log names them: the door's author when
-- one is set, else the member on the connection, else the system.
create function actor_now(fallback text) returns text
  language sql stable as $$
  select coalesce(
    nullif(current_setting('app.author', true), ''),
    fallback,
    'person:' || current_member()::text,
    'system')
$$;

-- A share as the log keeps it: what was shared, by name, with whom, at
-- what level. Logged as a change of the owner's, so the owner's history
-- holds every share they gave, and whoever can see the share sees it too.
create function share_row(g grants) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', g.id, 'org_id', g.org_id,
    'record_id', g.record_id,
    'record', (select title from records where id = g.record_id),
    'kind', (select name from record_kinds where id = g.kind_id),
    'subject', g.subject, 'member_id', g.member_id,
    'group', (select name from groups where id = g.group_id),
    'level', g.level, 'author', g.author)
$$;

create function log_share() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  g grants;
  owner uuid;
begin
  if tg_op = 'DELETE' then g := old; else g := new; end if;
  owner := coalesce(
    (select person_id from records where id = g.record_id),
    (select person_id from record_kinds where id = g.kind_id));
  perform write_event(g.org_id, owner, 'share', g.id::text,
    case tg_op when 'INSERT' then 'created' when 'DELETE' then 'deleted'
      else 'updated' end,
    actor_now(g.author),
    case when tg_op = 'INSERT' then null else share_row(old) end,
    case when tg_op = 'DELETE' then null else share_row(new) end);
  return null;
end
$$;
create trigger grants_events after insert or update or delete on grants
  for each row execute function log_share();

-- A membership as the log keeps it: who, their role, and whether they are
-- still here. Joining, leaving, coming back, a change of role and a purge
-- are logged; a name or a picture is not. A purge is the org's line, not
-- the purged member's, whose log went with them.
create function member_row(u users) returns jsonb
  language sql stable as $$
  select jsonb_build_object(
    'id', u.id, 'org_id', u.org_id, 'name', u.name, 'role', u.role,
    'removed_at', u.removed_at)
$$;

create function log_member() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  u users;
begin
  if tg_op = 'DELETE' then u := old; else u := new; end if;
  perform write_event(u.org_id,
    case when tg_op = 'DELETE' then null else u.id end,
    'member', u.id::text,
    case
      when tg_op = 'INSERT' then 'created'
      when tg_op = 'DELETE' then 'deleted'
      when new.removed_at is not null and old.removed_at is null
        then 'deleted'
      else 'updated' end,
    actor_now(null),
    case when tg_op = 'INSERT' then null else member_row(old) end,
    case when tg_op = 'DELETE' then null else member_row(new) end);
  return null;
end
$$;
create trigger users_events
  after insert or delete or update of role, removed_at on users
  for each row execute function log_member();

-- A change is seen by whoever can see what changed; a share by whoever
-- can see the share; a membership by every member.
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
          exists (select 1 from record_kinds k where k.id::text = subject_id)
        when 'property' then
          exists (select 1 from kind_properties p
            where p.id::text = subject_id)
        when 'share' then
          exists (select 1 from grants g where g.id::text = subject_id)
        when 'member' then true
        else false end));

-- A maker can always hide their own link, even from a record they can no
-- longer see, as they could always remove it.
drop policy change on edges;
create policy change on edges for update
  using (org_id = current_org()
    and (person_id = current_member()
      or exists (select 1 from records r
        where r.id = from_id
          and (r.person_id = current_member() or grant_level(r.id) >= 3))))
  with check (org_id = current_org()
    and ((person_id = current_member() and deleted_at is not null)
      or (exists (select 1 from records r
            where r.id = from_id
              and (r.person_id = current_member() or grant_level(r.id) >= 2))
          and exists (select 1 from records r where r.id = to_id))));
