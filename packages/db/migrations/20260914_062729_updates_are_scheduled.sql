-- A new image is an update, not a restart: the sweep records that one is
-- ready and to which image, and the person says when their computer takes
-- it. None of this lives on the machine.
alter table computers
  -- The image an update is ready to, and when it became ready; both null
  -- when the machine is on the image of the day.
  add column update_image text,
  add column update_ready_at timestamptz,
  -- When the person asked for it: now, tonight at three where the machine
  -- is, or the next time nobody is using it. Null until they say.
  add column update_when text check (update_when in ('now', 'tonight', 'idle')),
  -- Whether the image it goes to was shipped as a security image, which
  -- takes the idle rule from the day it is ready rather than after seven.
  add column update_security boolean not null default false;
