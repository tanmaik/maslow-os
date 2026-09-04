-- A person is one row per email. A users row is that person's membership in
-- one org, and a person may hold several. Everything the brain keys on
-- (org_id, users.id) is unchanged.

create table people (
  id uuid primary key,
  email text not null unique,
  name text not null,
  avatar_key text,
  created_at timestamptz not null default now()
);

alter table users add column person_id uuid references people (id);

-- Every existing user becomes a person, one per email.
insert into people (id, email, name, avatar_key, created_at)
  select distinct on (email) id, email, name, avatar_key, created_at
  from users order by email, created_at;
update users u set person_id = p.id from people p where p.email = u.email;
alter table users alter column person_id set not null;

-- One membership per person per org, and an email may now recur across orgs.
alter table users drop constraint users_email_key;
alter table users add unique (org_id, person_id);

-- A person sees and edits their own row, named by the session; a sign-in sees
-- the person behind an email. Neither policy reads another table.
alter table people enable row level security;
alter table people force row level security;
create policy self on people
  using (id = nullif(current_setting('app.person_id', true), '')::uuid);
create policy sign_in on people for select
  using (email = nullif(current_setting('app.email', true), ''));
create policy sign_in_insert on people for insert
  with check (email = nullif(current_setting('app.email', true), ''));

-- A sign-in also sees every membership carrying its email, to choose one.
-- (The org policy from 20260903 still applies; policies are OR-ed.)
create policy memberships on users for select
  using (email = nullif(current_setting('app.email', true), ''));

grant select, insert on people to app;
grant update (name, avatar_key) on people to app;
