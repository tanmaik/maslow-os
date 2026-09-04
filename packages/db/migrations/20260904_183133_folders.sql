-- A person's filesystem has folders, so it can be walked like one. A file
-- lives in a folder by path; an empty folder is a row of its own. The root
-- is "/", every other path is "/a/b" with no trailing slash.
alter table files add column path text not null default '/';
create index files_by_folder on files (org_id, user_id, path);

create table folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id),
  user_id uuid not null,
  path text not null check (path ~ '^(/[^/]+)+$'),
  created_at timestamptz not null default now(),
  unique (org_id, user_id, path),
  foreign key (org_id, user_id) references users (org_id, id)
);
alter table folders enable row level security;
alter table folders force row level security;
create policy own on folders
  using (org_id = current_org() and user_id = current_member());
create policy meter on folders for select
  using (org_id = current_org() and current_setting('app.meter', true) = 'sweep');
grant select, insert, update, delete on folders to app;
