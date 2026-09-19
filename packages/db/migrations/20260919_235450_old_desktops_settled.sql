-- The readers of the shapes a desktop had before 2026-09-16 are gone, so
-- what they would have read is settled here once. A person keeps their
-- first desktop alone: the windows on any other are gathered onto it
-- first, as many as a desktop holds, and then the others go. A layout that
-- is not today's, a list of windows each with a name of its own, is
-- emptied, which opens as a bare desktop.
update desktops f
set layout = jsonb_build_object(
  'cards',
  (select coalesce(jsonb_agg(e order by n), '[]'::jsonb)
   from jsonb_array_elements(
     (case when jsonb_typeof(f.layout -> 'cards') = 'array'
        then f.layout -> 'cards' else '[]'::jsonb end) || s.cards
   ) with ordinality as t (e, n)
   where n <= 32)
)
from (
  select d.org_id, d.member_id, jsonb_agg(c order by d.position) as cards
  from desktops d
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(d.layout -> 'cards') = 'array'
      then d.layout -> 'cards' else '[]'::jsonb end
  ) as c
  where exists (
    select 1 from desktops p
    where p.org_id = d.org_id and p.member_id = d.member_id
      and p.position < d.position
  )
  group by d.org_id, d.member_id
) s
where f.org_id = s.org_id and f.member_id = s.member_id
  and not exists (
    select 1 from desktops p
    where p.org_id = f.org_id and p.member_id = f.member_id
      and p.position < f.position
  );

delete from desktops d
where exists (
  select 1 from desktops p
  where p.org_id = d.org_id and p.member_id = d.member_id
    and p.position < d.position
);

update desktops
set layout = null
where layout is not null
  and (
    jsonb_typeof(layout -> 'cards') is distinct from 'array'
    or exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(layout -> 'cards') = 'array'
          then layout -> 'cards' else '[]'::jsonb end
      ) c
      where jsonb_typeof(c -> 'id') is distinct from 'string'
    )
  );
