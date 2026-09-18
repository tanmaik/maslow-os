-- The phones a person carries Maslow on, each by the token Apple's push
-- service gave it, so a notification left for them reaches the phone while
-- the app is closed. A phone is the person's alone; the server reads a
-- person's phones as the org when it sends, and nothing else does.
create table phones (
  token text primary key,
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  person_id uuid not null default current_member(),
  -- Whether the token came from a development build, which Apple's
  -- sandbox serves, or a shipped one.
  sandbox boolean not null,
  seen_at timestamptz not null default now(),
  foreign key (org_id, person_id) references users (org_id, id) on delete cascade
);

create index phones_of on phones (org_id, person_id);

alter table phones enable row level security;
alter table phones force row level security;

create policy own on phones
  using (org_id = current_org() and person_id = current_member())
  with check (org_id = current_org() and person_id = current_member());

-- The server, as the org, reads whose phones to reach and forgets a token
-- Apple says is dead.
create policy sending on phones
  for select using (org_id = current_org());
create policy dead on phones
  for delete using (org_id = current_org());

grant select, insert, update, delete on phones to app;
