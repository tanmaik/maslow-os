-- Why the machine could not land a file, in its own words, until the
-- next landing is asked for; the page and the uploader say it.
alter table files add column said text;
