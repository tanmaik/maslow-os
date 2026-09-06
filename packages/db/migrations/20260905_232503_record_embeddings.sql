-- What a record means, as a vector, so a question finds it by meaning and
-- not only by its words. One row per record, beside it and gone with it,
-- made from the record as of one change or not yet; seen and written by
-- whoever sees the record, since the vector says nothing the record does
-- not.
create table record_embeddings (
  record_id text primary key references records (id) on delete cascade,
  org_id uuid not null default current_org()
    references orgs (id) on delete cascade,
  model text not null,
  embedding real[] not null,
  as_of timestamptz not null
);

alter table record_embeddings enable row level security;
alter table record_embeddings force row level security;
create policy sees on record_embeddings for all
  using (org_id = current_org()
    and exists (select 1 from records r where r.id = record_id))
  with check (org_id = current_org()
    and exists (select 1 from records r where r.id = record_id));

grant select, insert, update, delete on record_embeddings to app;
