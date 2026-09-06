-- A change made in a door's name is logged in that name whatever row it
-- reached: a kind renamed carries its records along, and the log says who
-- renamed it, not who last wrote each record. A door that names nobody
-- leaves the row's own author on the log, as before.
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
  actor text := coalesce(
    nullif(current_setting('app.author', true), ''),
    coalesce(after_row, before_row) ->> 'author');
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
