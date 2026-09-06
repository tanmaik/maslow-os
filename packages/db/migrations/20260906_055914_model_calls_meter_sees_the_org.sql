-- The meter reads the model calls of the org it is walking.
drop policy meter on model_calls;
create policy meter on model_calls for select
  using (org_id = current_org() and current_setting('app.meter', true) = 'sweep');
