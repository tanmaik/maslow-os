-- Writes one line of the log, as the next of its person's changes. The org's
-- log is held until the transaction commits, so changes are numbered in the
-- order they land and something reading past a number never misses one that
-- was still landing; the person's count is held the same way.
create or replace function write_event(
  org uuid, person uuid, subject text, subject_id text, action text,
  actor text, before_row jsonb, after_row jsonb
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  nth bigint;
begin
  if not exists (select 1 from orgs where id = org) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(org::text, 0));
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
