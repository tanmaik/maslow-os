-- A signed-in person holds a session in their org. An org admits a new
-- person by invitation, keyed by the email an identity provider will vouch for.

create table sessions (
  id uuid primary key,
  org_id uuid not null references orgs (id),
  user_id uuid not null references users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table invitations (
  id uuid primary key,
  org_id uuid not null references orgs (id),
  email text not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email)
);

alter table sessions enable row level security;
alter table sessions force row level security;
alter table invitations enable row level security;
alter table invitations force row level security;

create policy org_isolation on sessions
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
create policy org_isolation on invitations
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid);

-- Sign-in arrives with an email and no org. A connection that names an email
-- sees that one person and their invitations, and nothing else, until it
-- names their org.
create policy sign_in on users for select
  using (email = nullif(current_setting('app.email', true), ''));
create policy sign_in on invitations for select
  using (email = nullif(current_setting('app.email', true), ''));

grant select, insert, update, delete on sessions, invitations to app;
