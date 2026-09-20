-- A port made public is open to anyone with its address and given to
-- nobody, so its app's name and face are its owner's alone to see unless
-- the port also reaches the reader by name, by a group or to everyone.
drop policy see on published_apps;
create policy see on published_apps for select
  using (org_id = current_org()
    and (computer_id in
          (select c.id from computers c where c.user_id = current_member())
      or exists (select 1 from port_shares s
                 where s.computer_id = published_apps.computer_id
                   and s.port = published_apps.port
                   and (s.subject = 'everyone'
                     or s.member_id = current_member()
                     or exists (select 1 from group_members m
                                where m.group_id = s.group_id
                                  and m.member_id = current_member())))));
