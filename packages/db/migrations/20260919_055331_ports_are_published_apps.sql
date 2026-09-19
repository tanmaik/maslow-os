-- A port becomes an app when its owner publishes it: a name and a face of
-- their choosing, and a place on their shelf. A port nobody published is a
-- port and nothing more; only apps are in the dock, and an app whose port
-- is not listening this moment is nowhere at all until it is back.
create table published_apps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  computer_id uuid not null references computers (id) on delete cascade,
  port int not null check (port between 1 and 65535),
  -- What it is called everywhere it is seen, a colleague's dock included.
  name text not null check (name <> '' and length(name) <= 120),
  -- Its face as the address that carries the picture: the icon the door
  -- found on the port, or one the person chose; null wears the kind's own.
  icon text check (icon is null or length(icon) <= 65536),
  -- Where it sits on its owner's shelf: the order is the person's, kept here
  -- rather than on whichever browser they last arranged it in.
  position int not null default 0,
  unique (computer_id, port)
);
alter table published_apps enable row level security;
alter table published_apps force row level security;

-- The owner sees every app of theirs; everybody else sees only the ones
-- whose port reaches them, so nobody learns what another has published,
-- and unsharing a port hides its name in the same act.
create policy see on published_apps for select
  using (org_id = current_org()
    and (computer_id in
          (select c.id from computers c where c.user_id = current_member())
      or exists (select 1 from port_shares s
                 where s.computer_id = published_apps.computer_id
                   and s.port = published_apps.port
                   and (s.subject in ('everyone', 'public')
                     or s.member_id = current_member()
                     or exists (select 1 from group_members m
                                where m.group_id = s.group_id
                                  and m.member_id = current_member())))));

-- Publishing, renaming, arranging and unpublishing are the owner's alone.
create policy publish on published_apps for insert
  with check (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()));
create policy rename on published_apps for update
  using (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()))
  with check (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()));
create policy unpublish on published_apps for delete
  using (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()));

grant select, insert, update, delete on published_apps to app;
