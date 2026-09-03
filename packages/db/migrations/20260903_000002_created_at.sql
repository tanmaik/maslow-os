alter table orgs add column created_at timestamptz not null default now();
alter table users add column created_at timestamptz not null default now();
