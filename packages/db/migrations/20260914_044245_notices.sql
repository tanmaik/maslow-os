-- What waits on one person: a note their agent left them, or an ask it
-- cannot answer itself. A note is read and cleared; an ask holds the
-- options it offers and the answer given, so whoever asked can read it
-- back. An ask to share carries the request it would run, and answering
-- the notice is answering the request. A notice is the person's alone:
-- nobody else in the org ever sees one.
create table notices (
  id text primary key default short_id(),
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  person_id uuid not null default current_member(),
  kind text not null check (kind in ('note', 'ask')),
  title text not null check (title <> ''),
  body text not null default '',
  -- Who wrote it, in the name the transaction carries: the app connected
  -- as the person, or the person themselves.
  author text not null default coalesce(
    nullif(current_setting('app.author', true), ''), 'you'),
  -- The records it points at, as chips that open them.
  records text[] not null default '{}',
  -- What an ask offers, and what was chosen or typed; null until answered.
  options text[] not null default '{}',
  answer text,
  -- The ask to share this notice carries, if it is one. The request is
  -- gone the moment it is answered; the notice and its answer stay.
  request_id text references share_requests (id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  -- Only an ask has options, an answer or a request behind it.
  check (kind = 'ask' or (options = '{}' and answer is null and request_id is null)),
  foreign key (org_id, person_id) references users (org_id, id) on delete cascade
);

create index notices_newest on notices (org_id, person_id, created_at desc);

alter table notices enable row level security;
alter table notices force row level security;

create policy own on notices
  using (org_id = current_org() and person_id = current_member())
  with check (org_id = current_org() and person_id = current_member());

grant select, insert, update, delete on notices to app;
