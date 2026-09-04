-- A record's or an edge's owner, like its org, is set when it is written and
-- never changes after.
create function keep_owner() returns trigger language plpgsql as $$
begin
  if new.org_id is distinct from old.org_id
    or new.person_id is distinct from old.person_id then
    raise exception 'the owner of a % does not change', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;
create trigger records_keep_owner before update on records
  for each row execute function keep_owner();
create trigger edges_keep_owner before update on edges
  for each row execute function keep_owner();

-- An edge is unlinked by whoever made it or by an editor of its from-end.
drop policy unlink on edges;
create policy unlink on edges for delete
  using (org_id = current_org()
    and (person_id = current_member()
      or exists (select 1 from records r
        where r.id = from_id
          and (r.person_id = current_member() or grant_level(r.id) >= 2))));

-- A person always sees the links they made, even when the far end is no
-- longer shared with them; the far record itself stays out of sight.
drop policy see on edges;
create policy see on edges for select
  using (org_id = current_org()
    and (person_id = current_member()
      or (exists (select 1 from records r where r.id = from_id)
        and exists (select 1 from records r where r.id = to_id))));
