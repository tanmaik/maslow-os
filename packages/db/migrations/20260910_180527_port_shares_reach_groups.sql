-- A port is given the way a record is: to a person, to a group, or to
-- everyone in the org. Everyone is every current member and is not a row,
-- so it is a subject and not a group id.
alter table port_shares
  add column subject text not null default 'member'
    check (subject in ('everyone', 'group', 'member')),
  add column group_id uuid references groups (id) on delete cascade,
  alter column member_id drop not null,
  add constraint port_share_names_its_subject check (
    case subject
      when 'member' then member_id is not null and group_id is null
      when 'group' then group_id is not null and member_id is null
      else member_id is null and group_id is null
    end);
alter table port_shares alter column subject drop default;

-- One row per port and whoever it reaches, however it reaches them.
alter table port_shares
  drop constraint port_shares_computer_id_port_member_id_key;
create unique index port_shares_one_per_subject on port_shares
  (computer_id, port, subject, coalesce(member_id, group_id, computer_id));

-- The computer's owner sees every share on it; everyone else sees only what
-- reaches them, so nobody learns what ports another person has open.
drop policy see on port_shares;
create policy see on port_shares for select
  using (org_id = current_org()
    and (computer_id in
          (select c.id from computers c where c.user_id = current_member())
      or subject = 'everyone'
      or member_id = current_member()
      or exists (select 1 from group_members m
                 where m.group_id = port_shares.group_id
                   and m.member_id = current_member())));
