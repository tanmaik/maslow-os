-- A conversation the person is done with is settled: it leaves the live
-- list for a shelf below, and comes back when touched. The sidebar also
-- says which conversations finished since the person last looked, so the
-- last look and the last finish are both kept.
alter table agent_sessions
  add column settled_at timestamptz,
  add column seen_at timestamptz,
  add column finished_at timestamptz;
