-- Fly's own record of a machine's starts and stops is read by every sweep;
-- each moment is written once, whichever sweep gets there first.
create unique index computer_events_once on computer_events (computer_id, kind, at);
