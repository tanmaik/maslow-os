-- The update a computer waits for is named by the image's label alone, as
-- the app names images now; where the image is kept, and its digest, are
-- the cloud's and are dropped, with the update's time kept.
update computers
set update_image = regexp_replace(split_part(update_image, '@', 1), '^.*:', '')
where update_image is not null;
