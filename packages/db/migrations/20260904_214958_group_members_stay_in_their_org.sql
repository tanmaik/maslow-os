-- A group's members are members of the group's own org.
alter table group_members drop constraint group_members_group_id_fkey;
alter table group_members add foreign key (org_id, group_id)
  references groups (org_id, id) on delete cascade;
