-- Who may reach a port somebody opened on their computer. There is one
-- level: the address opens, or it is not there at all. Only members of the
-- org can be given one, and only the computer's owner gives it.
create table port_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  computer_id uuid not null references computers (id) on delete cascade,
  port int not null check (port between 1 and 65535),
  member_id uuid not null,
  created_at timestamptz not null default now(),
  unique (computer_id, port, member_id),
  foreign key (org_id, member_id) references users (org_id, id) on delete cascade
);
alter table port_shares enable row level security;
alter table port_shares force row level security;

-- The computer's owner sees every share on it; anyone else sees only what
-- was given to them, so nobody learns what ports another person has open.
create policy see on port_shares for select
  using (org_id = current_org()
    and (member_id = current_member()
      or computer_id in
        (select c.id from computers c where c.user_id = current_member())));

-- Giving and taking away are the owner's alone.
create policy give on port_shares for insert
  with check (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()));
create policy take on port_shares for delete
  using (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()));

grant select, insert, delete on port_shares to app;
