-- What the agent asked to put in front of the person: an address of ours,
-- already read and found openable, and the name to show for it. It waits
-- for the person's page to take it, once, and is the person's alone.
create table open_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  person_id uuid not null default current_member(),
  href text not null check (href like '/%' and length(href) <= 2048),
  title text not null check (title <> '' and length(title) <= 200),
  asked_at timestamptz not null default now(),
  foreign key (org_id, person_id) references users (org_id, id) on delete cascade
);
alter table open_requests enable row level security;
alter table open_requests force row level security;
create policy own on open_requests
  using (org_id = current_org() and person_id = current_member())
  with check (org_id = current_org() and person_id = current_member());
grant select, insert, delete on open_requests to app;
