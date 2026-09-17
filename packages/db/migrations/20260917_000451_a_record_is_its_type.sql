-- A record's shape is its type's. When a thing happened and how sure the
-- writer was are fields a type declares when it needs them, not columns
-- every record carries; the one universal order is when it was written.
--
-- What the columns held is carried into declared fields first, so no
-- brain loses a date or a confidence: every type with a record that had
-- one gains a `when` (datetime) or a `confidence` (number) field, and each
-- record's value moves into its props. The rows are touched without the
-- log or the clock noticing, as a rename of ids once was, since nothing a
-- person said has changed. A brain whose own `when` or `confidence` field
-- already holds a value beside the column stops the migration here rather
-- than lose either.
do $$
begin
  if exists (
    select 1 from records
    where (occurred_at is not null and props ? 'when')
       or (confidence is not null and props ? 'confidence')
  ) then
    raise exception 'a record holds a column and a field of the same name';
  end if;
end $$;
alter table records disable trigger user;
alter table type_properties disable trigger user;
insert into type_properties
  (org_id, person_id, type, name, datatype, required, options)
select distinct r.org_id, r.person_id, r.type, 'when', 'datetime', false, null::text[]
from records r
where r.occurred_at is not null
on conflict (org_id, person_id, type, name) do nothing;
update records
set props = props || jsonb_build_object(
  'when', to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
where occurred_at is not null;
insert into type_properties
  (org_id, person_id, type, name, datatype, required, options)
select distinct r.org_id, r.person_id, r.type, 'confidence', 'number', false, null::text[]
from records r
where r.confidence is not null
on conflict (org_id, person_id, type, name) do nothing;
update records
set props = props || jsonb_build_object('confidence', confidence)
where confidence is not null;
alter table type_properties enable trigger user;
alter table records enable trigger user;

alter table records drop column occurred_at, drop column confidence;
alter table edges drop column confidence, drop column occurred_at;

-- The search index reads every property's value beside the title and body.
drop index records_search;
alter table records drop column search;
alter table records add column search tsvector generated always as
  (to_tsvector('english', title || ' ' || body || ' ' || coalesce(props::text, ''))) stored;
create index records_search on records using gin (search);
create index records_by_type on records (org_id, person_id, type, created_at desc);
create index records_by_time on records (org_id, person_id, created_at desc);
