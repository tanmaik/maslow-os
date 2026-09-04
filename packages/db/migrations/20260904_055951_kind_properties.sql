-- The fields a kind declares. A kind with none accepts any props; a kind with
-- some is a form the write door checks and the read door can filter and sort
-- by. Values stay in records.props; nothing here changes a table's shape.

create table kind_properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id),
  kind text not null,
  name text not null check (name ~ '^[a-z][a-z0-9_]*$'),
  type text not null check
    (type in ('text', 'number', 'boolean', 'date', 'datetime', 'enum', 'list')),
  description text not null check (description <> ''),
  required boolean not null default false,
  options text[] check ((type = 'enum') = (options is not null)),
  author text not null,
  created_at timestamptz not null default now(),
  unique (org_id, kind, name),
  foreign key (org_id, kind) references record_kinds (org_id, name)
    on update cascade on delete cascade
);

alter table events drop constraint events_subject_check;
alter table events add check
  (subject in ('record', 'edge', 'kind', 'verb', 'property'));

create trigger kind_properties_events
  after insert or update or delete on kind_properties
  for each row execute function log_event('property');

alter table kind_properties enable row level security;
alter table kind_properties force row level security;
create policy org_isolation on kind_properties using (org_id = current_org());

grant select, insert, update, delete on kind_properties to app;
