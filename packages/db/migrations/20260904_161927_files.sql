-- A person's files: what they put in their filesystem, held in the bucket
-- (which is also its backup) and pulled onto the volume by the machine when
-- it has one. Rows outlive their bytes, so what was stored and for how long
-- can be metered.
create table files (
  id uuid primary key,
  org_id uuid not null default current_org() references orgs (id),
  user_id uuid not null,
  name text not null check (name <> ''),
  size bigint not null check (size >= 0),
  content_type text not null,
  key text not null unique,
  -- uploading | ready
  state text not null default 'uploading',
  upload_id text,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  deleted_at timestamptz,
  foreign key (org_id, user_id) references users (org_id, id)
);
create index files_by_owner on files (org_id, user_id, created_at);

alter table files enable row level security;
alter table files force row level security;
-- A person's files are theirs alone, like the rest of their filesystem.
create policy own on files
  using (org_id = current_org() and user_id = current_member());
grant select, insert, update, delete on files to app;
