-- The agent's conversations lived in the interface; the interface is gone,
-- and Claude Code on the computer keeps its own transcripts at home. The
-- gateway's record of every model call stays. A call the app lost track of
-- before its answer ended is settled by the sweep as it stood and marked,
-- so nothing bought goes uncounted.
drop table agent_events;
drop table agent_sessions;
alter table model_calls drop column session_id;
alter table model_calls add column lost boolean not null default false;
create policy meter_settles on model_calls for update
  using (org_id = current_org() and current_setting('app.meter', true) = 'sweep')
  with check (org_id = current_org() and current_setting('app.meter', true) = 'sweep');
