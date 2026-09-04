-- A deleted row has no author column left to say who deleted it, so the
-- door names the deleter on the transaction, in app.author, and the log
-- takes that name for a deletion. Every other change is logged as before.
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
    (coalesce(after_row, before_row) ->> 'id')::uuid,
    action,
    actor,
    before_row,
    after_row
  );
  return null;
end
$$;
