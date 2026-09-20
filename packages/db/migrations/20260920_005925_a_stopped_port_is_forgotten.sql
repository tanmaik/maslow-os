-- A port that matters, an app or one shared, found not listening: when it
-- was first seen so. Back within ten minutes, it goes on as it was; gone
-- longer, its app and its shares are forgotten and it is a new port when
-- it next listens. Its owner's alone to see and to change.
create table stopped_ports (
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  computer_id uuid not null references computers (id) on delete cascade,
  port int not null check (port between 1 and 65535),
  stopped_at timestamptz not null default now(),
  primary key (computer_id, port)
);
alter table stopped_ports enable row level security;
alter table stopped_ports force row level security;

create policy own on stopped_ports
  using (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()))
  with check (org_id = current_org()
    and computer_id in
      (select c.id from computers c where c.user_id = current_member()));

grant select, insert, delete on stopped_ports to app;
