-- An org shows a logo, a person shows an avatar, and a person who leaves an
-- org takes their sessions and invitation with them.

alter table orgs add column logo_key text;
alter table users add column avatar_key text;

alter table sessions drop constraint sessions_user_id_fkey,
  add constraint sessions_user_id_fkey foreign key (user_id) references users (id) on delete cascade;
