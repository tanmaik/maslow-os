-- A conversation with the agent on a person's machine. The harness on the
-- machine writes the transcript on the volume; this is the conversation as
-- the interface shows it, reconnected to by id. The session is the
-- person's, like their disk; the machine writes to it as itself.
create table agent_sessions (
  id uuid primary key,
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  user_id uuid not null,
  computer_id uuid not null references computers (id) on delete cascade,
  title text not null default 'New conversation',
  model text not null,
  -- The harness's own id for the session, once it has one.
  acp_session_id text,
  -- idle | working | restarted
  state text not null default 'idle',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, user_id) references users (org_id, id)
);
create index agent_sessions_by_owner on agent_sessions (org_id, user_id, updated_at);

alter table agent_sessions enable row level security;
alter table agent_sessions force row level security;
create policy own on agent_sessions
  using (org_id = current_org() and user_id = current_member());
create policy meter on agent_sessions for select
  using (org_id = current_org() and current_setting('app.meter', true) = 'sweep');
-- The machine sees and keeps up the sessions of the computer it is.
create policy reporting on agent_sessions
  using (computer_id in (select computer_id from computer_secrets
                         where secret = nullif(current_setting('app.machine_secret', true), '')));
grant select, insert, update, delete on agent_sessions to app;

-- What happened in a session, in order: a prompt, the agent's text, a tool
-- call, a turn's result, a restart. Written by the machine as it happens;
-- the same seq twice is the same event.
create table agent_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default current_org() references orgs (id) on delete cascade,
  session_id uuid not null references agent_sessions (id) on delete cascade,
  seq int not null,
  -- prompt | text | thought | tool | title | model | result | restart
  kind text not null,
  body jsonb not null,
  at timestamptz not null default now(),
  unique (session_id, seq)
);

alter table agent_events enable row level security;
alter table agent_events force row level security;
create policy own on agent_events for select
  using (org_id = current_org()
    and session_id in (select id from agent_sessions where user_id = current_member()));
create policy reporting on agent_events
  using (session_id in (select id from agent_sessions));
grant select, insert on agent_events to app;

-- Every call a machine made to a model through the gateway: which model,
-- how many tokens of each kind, and the vendor's own price when it said
-- one. The meter reads it; nothing edits it.
create table model_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  user_id uuid not null,
  computer_id uuid not null,
  session_id uuid,
  -- anthropic | openrouter
  provider text not null,
  model text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  -- Dollars, when the vendor reported them with the answer.
  reported_cost numeric,
  at timestamptz not null default now()
);
create index model_calls_by_member on model_calls (org_id, user_id, at);

alter table model_calls enable row level security;
alter table model_calls force row level security;
create policy org_isolation on model_calls for select using (org_id = current_org());
create policy reporting on model_calls for insert
  with check (computer_id in (select computer_id from computer_secrets
                              where secret = nullif(current_setting('app.machine_secret', true), '')));
grant select, insert on model_calls to app;

-- A usage line for tokens names the model.
alter table usage add column model text;
