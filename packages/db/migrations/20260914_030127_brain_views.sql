-- How one person looks at one list of their brain: which view they left it
-- on, what they filtered and sorted it by, and which columns they kept. The
-- subject is the list itself -- "" for everything, else "<owner>:<type>" --
-- and the state is the same thing the address carries, so a remembered view
-- and a linked one are one shape. A type declares a name and its fields and
-- nothing else, so none of this sits on the type. It is the person's alone.
create table brain_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  member_id uuid not null default current_member(),
  subject text not null,
  state text not null,
  updated_at timestamptz not null default now(),
  unique (org_id, member_id, subject),
  foreign key (org_id, member_id) references users (org_id, id) on delete cascade
);
alter table brain_views enable row level security;
alter table brain_views force row level security;

create policy own on brain_views
  using (org_id = current_org() and member_id = current_member())
  with check (org_id = current_org() and member_id = current_member());

grant select, insert, update, delete on brain_views to app;
