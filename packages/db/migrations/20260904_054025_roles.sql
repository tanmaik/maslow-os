-- An org is owned. Owners manage the org and its members; members manage
-- themselves and may invite. Whoever makes an org owns it.

alter table users add column role text not null default 'member'
  check (role in ('owner', 'member'));

-- Every org so far was made by its first member.
update users u set role = 'owner'
  where id = (select id from users where org_id = u.org_id order by created_at limit 1);
