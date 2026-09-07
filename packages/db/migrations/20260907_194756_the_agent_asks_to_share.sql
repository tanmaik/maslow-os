-- The agent never opens a brain to anyone; it asks. A request names what to
-- share, with whom, at what level and why, and waits for its owner to
-- accept or decline it on the brain's pages. Accepting makes the shares in
-- the owner's name; either answer removes the request. The log keeps the
-- ask and the answer.

create table share_requests (
  id text primary key default short_id(),
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  person_id uuid not null default current_member(),
  -- What to share: [{ "record": id } | { "type": id }].
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  -- Whom to share it with: [{ "who": "everyone" } | { "who": "member", "id" } | { "who": "group", "id" }].
  subjects jsonb not null check (jsonb_typeof(subjects) = 'array' and jsonb_array_length(subjects) > 0),
  level text not null check (level in ('view', 'edit', 'owner')),
  reason text not null default '',
  foreign key (org_id, person_id) references users (org_id, id) on delete cascade
);

alter table share_requests enable row level security;
alter table share_requests force row level security;
create policy own on share_requests
  using (org_id = current_org() and person_id = current_member())
  with check (org_id = current_org() and person_id = current_member());
grant select, insert, update, delete on share_requests to app;

alter table events drop constraint events_subject_check;
alter table events add check (subject in
  ('record', 'edge', 'type', 'verb', 'property', 'share', 'request', 'member'));
create trigger share_requests_events
  after insert or update or delete on share_requests
  for each row execute function log_event('request');
