-- A model call is written before it is made and settled when the answer
-- ends, so no token is bought without a row. A call is its person's to read.
alter table model_calls add column settled_at timestamptz;

drop policy org_isolation on model_calls;
drop policy reporting on model_calls;
create policy own on model_calls for select
  using (org_id = current_org() and user_id = current_member());
create policy meter on model_calls for select
  using (current_setting('app.meter', true) = 'sweep');
-- A machine writes, settles and drops the calls of its own person.
create policy reporting on model_calls
  using (computer_id in (select computer_id from computer_secrets
                          where secret = nullif(current_setting('app.machine_secret', true), '')))
  with check (computer_id in (select computer_id from computer_secrets
                              where secret = nullif(current_setting('app.machine_secret', true), '')));
grant update, delete on model_calls to app;
