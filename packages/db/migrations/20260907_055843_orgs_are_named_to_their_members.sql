-- A sign-in that names an email sees the name of every org that email has
-- a membership in, so the orgs a person can switch to are read in one
-- query rather than one transaction each.
create policy memberships on orgs for select
  using (exists (select 1 from users u
    where u.org_id = orgs.id and u.removed_at is null
      and u.email = nullif(current_setting('app.email', true), '')));
