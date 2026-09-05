-- An outside app connects to the brain through OAuth: the person approves it
-- while signed in, a short-lived code goes back to the app, and the app trades
-- the code for a session of its own. A session says which app holds it; a
-- browser's says nothing.

create table oauth_codes (
  id uuid primary key,
  org_id uuid not null references orgs (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  client text not null,
  redirect_uri text not null,
  code_challenge text not null,
  created_at timestamptz not null default now()
);

alter table oauth_codes enable row level security;
alter table oauth_codes force row level security;
create policy org_isolation on oauth_codes
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
grant select, insert, delete on oauth_codes to app;

alter table sessions add column client text;
