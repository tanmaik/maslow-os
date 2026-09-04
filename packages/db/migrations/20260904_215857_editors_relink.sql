-- An edge is changed by whoever made it or by an editor of its from-end.
drop policy change on edges;
create policy change on edges for update
  using (org_id = current_org()
    and (person_id = current_member()
      or exists (select 1 from records r
        where r.id = from_id
          and (r.person_id = current_member() or grant_level(r.id) >= 2))))
  with check (org_id = current_org()
    and exists (select 1 from records r
      where r.id = from_id
        and (r.person_id = current_member() or grant_level(r.id) >= 2))
    and exists (select 1 from records r where r.id = to_id));
