-- One object in the bucket is one wallpaper: finishing the same upload
-- twice keeps what is already there rather than a second row of the same
-- picture, metered twice and deleted once.
delete from wallpapers a
  using wallpapers b
  where a.member_id = b.member_id
    and a.key = b.key
    and (a.created_at, a.id) > (b.created_at, b.id);
alter table wallpapers add constraint wallpapers_member_key_key unique (member_id, key);
