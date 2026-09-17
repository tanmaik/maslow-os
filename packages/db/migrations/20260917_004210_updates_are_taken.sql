-- An update is taken when the person presses Update, and at no other
-- time: no hour is picked and no image takes itself, so the row no longer
-- says when, or whether the image was a security one.
alter table computers
  drop column update_when,
  drop column update_security;
