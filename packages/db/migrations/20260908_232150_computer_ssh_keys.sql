-- The public keys that open a computer over SSH, one per line, as the
-- person set them in settings.
alter table computers
  add column authorized_keys text not null default '';
