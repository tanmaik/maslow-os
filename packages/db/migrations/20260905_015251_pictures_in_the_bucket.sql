-- A profile photo and an org's logo are objects in the bucket, so each
-- carries its size and when it was saved, for the meter. The person's row
-- holds the photo's, and every membership carries a copy, as it does the
-- key; a picture saved before this carries neither until it is replaced.
alter table people add column avatar_bytes bigint, add column avatar_at timestamptz;
alter table users add column avatar_bytes bigint, add column avatar_at timestamptz;
alter table orgs add column logo_bytes bigint, add column logo_at timestamptz;
grant update (first_name, last_name, avatar_key, avatar_bytes, avatar_at) on people to app;

-- A picture that is replaced, or whose org is deleted, is owed a deletion
-- from the bucket, like any object.
alter table orphans drop constraint orphans_kind_check,
  add constraint orphans_kind_check
    check (kind in ('stop', 'machine', 'volume', 'object', 'upload', 'accounts', 'picture'));

-- Whether a picture is still shown by any person, membership or org: one
-- saved before keys were made per object may be shared, and is deleted
-- only when the last of them lets it go. Asked by the sweep, across orgs.
create function picture_in_use(picture text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from people where avatar_key = picture)
      or exists (select 1 from users where avatar_key = picture)
      or exists (select 1 from orgs where logo_key = picture)
$$;
