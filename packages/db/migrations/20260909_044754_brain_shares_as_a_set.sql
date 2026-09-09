-- The shares a reader holds, read once per query instead of once per row.
-- The rule is unchanged: a record is seen by its owner, or by a share on
-- the record, or by a share on its type, to everyone, to the member, or to
-- a group the member is in. Stated as sets the planner can hash and probe,
-- rather than as a function called with each row's id, which it cannot see
-- into.

-- Every record a share reaches for the current member at or above a level:
-- 1 view, 2 edit, 3 owner.
create function shared_records(at_least integer) returns table (record_id text)
  language sql stable security definer set search_path = public as $$
  select s.record_id from shares s
  where s.org_id = current_org()
    and s.record_id is not null
    and (case s.level when 'owner' then 3 when 'edit' then 2 else 1 end) >= at_least
    and (s.subject = 'everyone'
      or s.member_id = current_member()
      or exists (
        select 1 from group_members m
        where m.group_id = s.group_id
          and m.member_id = current_member()))
$$;
revoke all on function shared_records(integer) from public;
grant execute on function shared_records(integer) to app;

-- Every type a share reaches for the current member at or above a level,
-- as whose it is and what it is called, which is what a record carries.
create function shared_types(at_least integer)
  returns table (person_id uuid, name text)
  language sql stable security definer set search_path = public as $$
  select t.person_id, t.name from shares s
  join types t on t.id = s.type_id
  where s.org_id = current_org()
    and (case s.level when 'owner' then 3 when 'edit' then 2 else 1 end) >= at_least
    and (s.subject = 'everyone'
      or s.member_id = current_member()
      or exists (
        select 1 from group_members m
        where m.group_id = s.group_id
          and m.member_id = current_member()))
$$;
revoke all on function shared_types(integer) from public;
grant execute on function shared_types(integer) to app;

drop policy see on records;
create policy see on records for select
  using (org_id = current_org()
    and (person_id = current_member()
      or id in (select sr.record_id from shared_records(1) sr)
      or (person_id, type) in
        (select st.person_id, st.name from shared_types(1) st)));

drop policy change on records;
create policy change on records for update
  using (org_id = current_org()
    and (person_id = current_member()
      or id in (select sr.record_id from shared_records(2) sr)
      or (person_id, type) in
        (select st.person_id, st.name from shared_types(2) st)))
  with check (org_id = current_org()
    and (person_id = current_member()
      or id in (select sr.record_id from shared_records(2) sr)
      or (person_id, type) in
        (select st.person_id, st.name from shared_types(2) st)));
