-- A membership that ends is kept, unseen, so the brain rows it wrote stay
-- attributed to it. One live membership per person per org; a person invited
-- back gets a new one.
alter table users add column removed_at timestamptz;
alter table users drop constraint users_org_id_person_id_key;
create unique index users_one_live_membership
  on users (org_id, person_id) where removed_at is null;

alter policy org_isolation on users
  using (org_id = current_org() and removed_at is null)
  with check (org_id = current_org());
alter policy sign_in on users
  using (email = nullif(current_setting('app.email', true), '') and removed_at is null);
alter policy memberships on users
  using (email = nullif(current_setting('app.email', true), '') and removed_at is null);
-- Postgres holds an update's new row to the select policies too, so the row
-- being removed stays in sight, in its own org, for the one transaction
-- that names it.
create policy removing on users for select
  using (org_id = current_org() and removed_at is not null
    and id = nullif(current_setting('app.removing', true), '')::uuid);

-- The brain names the membership that wrote a row, which is not the person
-- behind it: app.person_id is a people id, app.member_id a users id.
create function current_member() returns uuid language sql stable as $$
  select nullif(current_setting('app.member_id', true), '')::uuid
$$;
alter table records alter column person_id set default current_member();
alter table edges alter column person_id set default current_member();
alter policy person_isolation on records
  using (org_id = current_org() and person_id = current_member());
alter policy person_isolation on edges
  using (org_id = current_org() and person_id = current_member());
alter policy person_isolation on events
  using (org_id = current_org()
    and (person_id is null or person_id = current_member()));
drop function current_person();
