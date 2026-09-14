-- A wallpaper's object in the bucket is owed its deletion the moment its
-- row goes, whichever way it goes: the person let it go, their membership
-- was purged, or the org was deleted. The debt is written in the same
-- transaction as the deletion, so nothing that costs money is left behind
-- by a cascade nobody wrote by hand.
create function wallpaper_owed() returns trigger
  language plpgsql as $$
begin
  insert into orphans (org_id, kind, ref) values (old.org_id, 'picture', old.key);
  return old;
end
$$;

create trigger owed after delete on wallpapers
  for each row execute function wallpaper_owed();
