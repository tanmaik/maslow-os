-- A move the person asked for, while it is under way: where to, and each
-- id made along the way, so a move cut off anywhere is taken up from where
-- it stopped or rolled back. Null when the computer is not moving.
alter table computers add column move jsonb;
