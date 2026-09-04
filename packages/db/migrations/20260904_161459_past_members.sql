-- A membership that ends is a past member: kept with everything it wrote,
-- seen by nobody, until an owner brings it back or purges it. One membership
-- per person per org, ever, so bringing one back is the same row.
drop index users_one_live_membership;
alter table users add unique (org_id, person_id);

-- Postgres holds an update's new row to the select policies too, so the
-- transaction that removes, lists, brings back or purges past members asks
-- to see them, within its org.
drop policy removing on users;
create policy past_members on users
  using (org_id = current_org() and removed_at is not null
    and current_setting('app.past_members', true) = 'on');
