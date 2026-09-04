-- A merge rewrites nothing: an alias keeps pointing at whatever it was merged
-- into, so a record and all its aliases form a chain. Reads walk it.
create function same_record(root uuid) returns setof uuid
  language sql stable as $$
  with recursive same as (
    select root as id
    union
    select r.id from records r join same on r.merged_into = same.id
  )
  select id from same
$$;

-- Purging a past member takes the membership and everything it wrote, the
-- log of it included. Events are the database's, so the database does it.
create function purge_member(member uuid) returns boolean
  language plpgsql security definer set search_path = public as $$
begin
  perform 1 from users
    where id = member and org_id = current_org() and removed_at is not null;
  if not found then return false; end if;
  delete from edges where org_id = current_org() and person_id = member;
  delete from records where org_id = current_org() and person_id = member;
  delete from events where org_id = current_org() and person_id = member;
  delete from users where id = member and org_id = current_org();
  return true;
end
$$;
revoke all on function purge_member(uuid) from public;
grant execute on function purge_member(uuid) to app;
