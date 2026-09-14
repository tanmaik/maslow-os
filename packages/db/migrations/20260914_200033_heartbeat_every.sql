-- How often the person's agent runs on its own on their computer, in
-- minutes; zero is off.
alter table computers add column heartbeat_every int not null default 0;
