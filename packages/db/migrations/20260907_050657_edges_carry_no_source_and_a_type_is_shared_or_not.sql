-- A link says what, how strongly and since when; where its writer read it
-- is not kept. A type that is not the reader's own is shared with them or
-- it is not; how it reached them is not kept either.

alter table edges drop column source, drop column source_ref;

-- Whether a type that is not the current member's own reaches them: through
-- a share on the type or on one of its records, to everyone or to them.
drop policy see on types;
drop function type_reach(uuid);
create function type_reaches(of_type uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from types t
    join shares s on s.org_id = t.org_id
      and (s.type_id = t.id or s.record_id in (
        select r.id from records r
        where r.org_id = t.org_id and r.person_id = t.person_id
          and r.type = t.name))
    where t.id = of_type and t.org_id = current_org()
      and (s.subject = 'everyone'
        or s.member_id = current_member()
        or exists (
          select 1 from group_members m
          where m.group_id = s.group_id
            and m.member_id = current_member())))
$$;
revoke all on function type_reaches(uuid) from public;
grant execute on function type_reaches(uuid) to app;
create policy see on types for select
  using (org_id = current_org()
    and (person_id = current_member() or type_reaches(id)));
