-- What the machine last said it had and needed: its memory and how much
-- of it was free at each of the last few reports, what was killed for want
-- of it, its load. The size it is made at next is chosen from this.
alter table computers add column need jsonb;
