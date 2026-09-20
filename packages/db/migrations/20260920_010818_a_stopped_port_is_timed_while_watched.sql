-- When a stopped port was last looked at. Its ten minutes are minutes of
-- being watched and found gone: a note nobody has looked at for a while
-- starts again at the next look, so a port that came back unseen and went
-- again much later is given its ten minutes and not forgotten on sight.
alter table stopped_ports add column seen_at timestamptz not null default now();
grant update on stopped_ports to app;
