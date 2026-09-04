-- A session lasts until the person signs out. Nothing about it ages.
alter table sessions drop column expires_at;
