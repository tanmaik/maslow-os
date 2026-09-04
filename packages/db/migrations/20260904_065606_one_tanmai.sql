-- The founder signed in with three emails before invitations were used and
-- got two orgs of the same name. Fold them into one org, "Maslow", in which
-- each of those people is an owner, and drop the empty one. One email is one
-- person; nothing here merges identities. A fresh database has none of these
-- rows, so this is a no-op there.

do $$
declare
  keep uuid := (select id from orgs where id = '6c25ac62-38ed-48ce-85b8-497c47aaf779');
  gone uuid := (select id from orgs where id = '5d37e55f-5fc1-493f-9ed1-758367984324');
begin
  if keep is null or gone is null then return; end if;

  -- A membership in the empty org moves into the kept one unless that person
  -- is already there; either way they end up an owner.
  delete from users u
    where u.org_id = gone
      and exists (select 1 from users k where k.org_id = keep and k.person_id = u.person_id);
  update users set org_id = keep where org_id = gone;
  update users set role = 'owner' where org_id = keep;

  update orgs set name = 'Maslow', slug = 'maslow' where id = keep;

  -- Nothing cascades from orgs; brain rows in the empty org would fail the
  -- foreign key here, which is the right outcome.
  delete from sessions where org_id = gone;
  delete from invitations where org_id = gone;
  delete from orgs where id = gone;
end $$;
