-- A port is given only to a group of the same org, the way it is given
-- only to a member of it: the key names the org as well as the group.
alter table port_shares
  drop constraint port_shares_group_id_fkey,
  add foreign key (org_id, group_id) references groups (org_id, id) on delete cascade;
