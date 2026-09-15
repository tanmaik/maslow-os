-- Whether the wish has been written into the person's file, so a delivery
-- tried again never writes it twice, however they edited it.
alter table arrivals add column wrote boolean not null default false;
