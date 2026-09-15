-- How many times the desk has been kept, so a save resting on an older
-- arrangement is refused rather than written over what landed since.
alter table desktops add column rev int not null default 0;
