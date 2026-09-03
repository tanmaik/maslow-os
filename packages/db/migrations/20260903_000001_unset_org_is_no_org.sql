-- Through a connection pooler a once-set app.org_id comes back as '' rather
-- than missing, and ''::uuid is an error. Empty means no org: see nothing.

drop policy org_isolation on orgs;
drop policy org_isolation on users;

create policy org_isolation on orgs
  using (id = nullif(current_setting('app.org_id', true), '')::uuid);
create policy org_isolation on users
  using (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
