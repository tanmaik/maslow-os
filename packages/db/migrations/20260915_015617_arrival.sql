-- When the person answered the card that meets them on their first desk.
alter table users add column arrived_at timestamptz;

-- What that answer still owes their computer once it is ready: how much
-- they want their agent to do, and what they said they are working
-- toward. One row per person, gone once delivered.
create table arrivals (
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  member_id uuid not null default current_member(),
  mode text not null check (mode in ('off', 'bar', 'desk')),
  words text,
  -- How often the agent should run for that answer, in minutes, kept
  -- here until delivered so no clock runs ahead of the first run; and
  -- whether the person set a cadence by hand in Settings since answering,
  -- which the answer's then never replaces.
  every int not null default 0,
  by_hand boolean not null default false,
  -- Which delivery has it in hand, and since when, so one delivery at a
  -- time has it and only that one lets go of it or finishes; one that
  -- died lets go after a couple of minutes.
  delivery uuid,
  delivering_at timestamptz,
  primary key (org_id, member_id),
  foreign key (org_id, member_id) references users (org_id, id) on delete cascade
);
alter table arrivals enable row level security;
alter table arrivals force row level security;

create policy own on arrivals
  using (org_id = current_org() and member_id = current_member())
  with check (org_id = current_org() and member_id = current_member());

grant select, insert, update, delete on arrivals to app;
