-- The agent no longer runs on its own, and no card meets a person on
-- their first desk: the cadence, the card's answers and the mark that
-- it was answered all go.
alter table computers drop column heartbeat_every;
drop table arrivals;
alter table users drop column arrived_at;
