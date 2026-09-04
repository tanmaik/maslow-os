-- Every org has one principal: the owner who pays for it and can do what no
-- other owner can, hand the org to another member or delete it. The
-- principal stays until they hand over, so an org is never without one.
alter table orgs add column principal_id uuid;
update orgs o set principal_id = (
  select id from users
  where org_id = o.id and role = 'owner' and removed_at is null
  order by created_at limit 1
);
alter table orgs alter column principal_id set not null;
-- An org and its principal are written together; the reference holds at
-- commit.
alter table orgs add foreign key (id, principal_id)
  references users (org_id, id) deferrable initially deferred;

-- An org's rows die with it.
alter table users
  drop constraint users_org_id_fkey,
  add foreign key (org_id) references orgs (id) on delete cascade;
alter table sessions
  drop constraint sessions_org_id_fkey,
  add foreign key (org_id) references orgs (id) on delete cascade;
alter table invitations
  drop constraint invitations_org_id_fkey,
  add foreign key (org_id) references orgs (id) on delete cascade;
alter table record_kinds
  drop constraint record_kinds_org_id_fkey,
  add foreign key (org_id) references orgs (id) on delete cascade;
alter table edge_verbs
  drop constraint edge_verbs_org_id_fkey,
  add foreign key (org_id) references orgs (id) on delete cascade;
alter table kind_properties
  drop constraint kind_properties_org_id_fkey,
  add foreign key (org_id) references orgs (id) on delete cascade;
alter table records
  drop constraint records_org_id_fkey,
  add foreign key (org_id) references orgs (id) on delete cascade;
alter table edges
  drop constraint edges_org_id_fkey,
  add foreign key (org_id) references orgs (id) on delete cascade;
alter table events
  drop constraint events_org_id_fkey,
  add foreign key (org_id) references orgs (id) on delete cascade;
