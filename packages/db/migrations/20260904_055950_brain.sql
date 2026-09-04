-- The brain: what an org knows, as records and the links between them, with a
-- log of every change. Kinds and verbs are the org's own vocabulary, so a
-- person or the agent can add one at any time.

-- Every brain row lands in the org and with the person the transaction names;
-- nothing threads either id by hand.
create function current_org() returns uuid language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid
$$;
create function current_person() returns uuid language sql stable as $$
  select nullif(current_setting('app.person_id', true), '')::uuid
$$;

-- A person is named together with their org, so a row can never claim a
-- person from another org.
alter table users add unique (org_id, id);

create table record_kinds (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id),
  name text not null check (name <> ''),
  description text not null check (description <> ''),
  author text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table edge_verbs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id),
  name text not null check (name <> ''),
  description text not null check (description <> ''),
  author text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

-- A source record is what an app returned, written by code and keyed by the
-- app's own id. A derived record is what the agent concluded: it carries a
-- confidence and rests on source records through edges. Every record belongs
-- to one person; the org's vocabulary is shared, its records are not.
create table records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id),
  person_id uuid not null default current_person(),
  kind text not null,
  layer text not null check (layer in ('source', 'derived')),
  source text not null check (source <> ''),
  source_ref text not null check (source_ref <> ''),
  title text not null default '',
  body text not null default '',
  props jsonb not null default '{}',
  occurred_at timestamptz,
  confidence real check (confidence between 0 and 1),
  author text not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search tsvector generated always as
    (to_tsvector('english', title || ' ' || body)) stored,
  check (layer = 'derived' or confidence is null),
  unique (org_id, person_id, id),
  unique (org_id, person_id, source, source_ref),
  foreign key (org_id, person_id) references users (org_id, id),
  foreign key (org_id, kind) references record_kinds (org_id, name)
    on update cascade
);

create index records_by_kind
  on records (org_id, person_id, kind, occurred_at desc);
create index records_by_time
  on records (org_id, person_id, occurred_at desc);
create index records_search on records using gin (search);

-- An edge joins two of one person's records.
create table edges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id),
  person_id uuid not null default current_person(),
  from_id uuid not null,
  verb text not null,
  to_id uuid not null,
  source text not null check (source <> ''),
  source_ref text,
  author text not null,
  created_at timestamptz not null default now(),
  unique (org_id, from_id, verb, to_id),
  foreign key (org_id, person_id) references users (org_id, id),
  foreign key (org_id, person_id, from_id)
    references records (org_id, person_id, id),
  foreign key (org_id, person_id, to_id)
    references records (org_id, person_id, id),
  foreign key (org_id, verb) references edge_verbs (org_id, name)
    on update cascade
);

create index edges_from on edges (from_id);
create index edges_to on edges (to_id);

-- Every change, in order, written by the database itself. The app reads
-- events and cannot write them.
create table events (
  seq bigint generated always as identity primary key,
  org_id uuid not null references orgs (id),
  person_id uuid,
  at timestamptz not null default now(),
  subject text not null check (subject in ('record', 'edge', 'kind', 'verb')),
  subject_id uuid not null,
  action text not null check (action in ('created', 'updated', 'deleted')),
  author text not null,
  before jsonb,
  after jsonb
);

create index events_by_org on events (org_id, person_id, seq);

-- Bumps the version and timestamp of any record that changes.
create function touch_record() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end
$$;

create trigger records_touch before update on records
  for each row execute function touch_record();

-- Writes one event for the row that changed. A record that gains deleted_at
-- is a deletion, whatever the SQL was.
create function log_event() returns trigger
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
begin
  insert into events
    (org_id, person_id, subject, subject_id, action, author, before, after)
  values (
    (coalesce(after_row, before_row) ->> 'org_id')::uuid,
    (coalesce(after_row, before_row) ->> 'person_id')::uuid,
    tg_argv[0],
    (coalesce(after_row, before_row) ->> 'id')::uuid,
    action,
    coalesce(after_row, before_row) ->> 'author',
    before_row,
    after_row
  );
  return null;
end
$$;

create trigger records_events after insert or update or delete on records
  for each row execute function log_event('record');
create trigger edges_events after insert or update or delete on edges
  for each row execute function log_event('edge');
create trigger record_kinds_events
  after insert or update or delete on record_kinds
  for each row execute function log_event('kind');
create trigger edge_verbs_events
  after insert or update or delete on edge_verbs
  for each row execute function log_event('verb');

alter table record_kinds enable row level security;
alter table record_kinds force row level security;
alter table edge_verbs enable row level security;
alter table edge_verbs force row level security;
alter table records enable row level security;
alter table records force row level security;
alter table edges enable row level security;
alter table edges force row level security;
alter table events enable row level security;
alter table events force row level security;

-- The vocabulary is the org's. Records, edges and their events are the
-- person's, and a colleague in the same org sees none of them until sharing
-- says otherwise.
create policy org_isolation on record_kinds using (org_id = current_org());
create policy org_isolation on edge_verbs using (org_id = current_org());
create policy person_isolation on records
  using (org_id = current_org() and person_id = current_person());
create policy person_isolation on edges
  using (org_id = current_org() and person_id = current_person());
create policy person_isolation on events
  using (org_id = current_org()
    and (person_id is null or person_id = current_person()));

grant select, insert, update, delete
  on record_kinds, edge_verbs, records, edges to app;
grant select on events to app;
