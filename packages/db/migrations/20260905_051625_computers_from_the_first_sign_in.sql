-- Every org starts with computers on; an owner's switch in Settings turns
-- them off.
alter table orgs alter column computers set default true;
-- When the person turned their computer off, and null while it is on.
alter table computers add column off_at timestamptz;
