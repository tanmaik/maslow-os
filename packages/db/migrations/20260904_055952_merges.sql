-- A record merged into another stays as an alias: hidden, pointing at the
-- record that now stands for it. Nothing is rewritten, so a merge reverses.

alter table records add column merged_into uuid;
alter table records add foreign key (org_id, person_id, merged_into)
  references records (org_id, person_id, id);
alter table records add check (merged_into is null or deleted_at is not null);
alter table records add check (merged_into is null or merged_into <> id);

create index records_aliases on records (merged_into)
  where merged_into is not null;
