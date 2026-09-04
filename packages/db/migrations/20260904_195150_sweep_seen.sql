-- The sweep reads when it last ran, across every org, to know if it is due.
create policy meter on usage for select
  using (current_setting('app.meter', true) = 'sweep');
