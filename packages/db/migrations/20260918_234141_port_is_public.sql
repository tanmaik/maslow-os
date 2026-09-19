-- A port may be public: open to anyone on the internet who has its address,
-- with no sign-in, so an app on it can be an API or a site of its own.
-- Public is a subject the way everyone is, not a row of a person or a group.
alter table port_shares drop constraint port_shares_subject_check;
alter table port_shares add constraint port_shares_subject_check
  check (subject in ('everyone', 'group', 'member', 'public'));
alter table port_shares drop constraint port_share_names_its_subject;
alter table port_shares add constraint port_share_names_its_subject check (
  case subject
    when 'member' then member_id is not null and group_id is null
    when 'group' then group_id is not null and member_id is null
    else member_id is null and group_id is null
  end);

-- A public port is listed for every member of the org, as one open to
-- everyone is.
drop policy see on port_shares;
create policy see on port_shares for select
  using (org_id = current_org()
    and (computer_id in
          (select c.id from computers c where c.user_id = current_member())
      or subject in ('everyone', 'public')
      or member_id = current_member()
      or exists (select 1 from group_members m
                 where m.group_id = port_shares.group_id
                   and m.member_id = current_member())));
