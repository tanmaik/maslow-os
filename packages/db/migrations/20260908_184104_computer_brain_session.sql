-- The computer holds a session of its owner's, so Claude Code on it reaches
-- the brain; ending the session leaves the computer without one.
alter table computers
  add column session_id uuid references sessions (id) on delete set null;
