-- A person's desktops: each one screen, its own arrangement of the
-- surfaces they dragged onto it, as a tree of splits: a window, or a split
-- side by side or one above the other of two more, at a ratio. A desktop
-- is the person's alone; nothing anyone else does lands on it.
create table desktops (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  member_id uuid not null default current_member(),
  position int not null check (position >= 0),
  -- The tree: {"window":{"kind","title","href"}} or
  -- {"split":"x"|"y","ratio":0..1,"a":tree,"b":tree}; null when empty.
  layout jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, member_id, position),
  foreign key (org_id, member_id) references users (org_id, id) on delete cascade
);
alter table desktops enable row level security;
alter table desktops force row level security;

create policy own on desktops
  using (org_id = current_org() and member_id = current_member())
  with check (org_id = current_org() and member_id = current_member());

grant select, insert, update, delete on desktops to app;
