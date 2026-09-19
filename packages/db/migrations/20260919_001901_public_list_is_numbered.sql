-- Every change to which of a computer's ports are public bumps a number on
-- the computer, told to its door with the list, so the door keeps the
-- newest list whatever order they arrive in.
alter table computers add column public_version int not null default 0;
