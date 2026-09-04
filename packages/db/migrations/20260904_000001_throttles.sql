-- Abuse limits for what an anonymous request can do before any org is known:
-- how often one email or one address asks for a code, and how many guesses a
-- code gets. A connection sees exactly the key it names.

create table throttles (
  key text primary key,
  hits int not null,
  window_start timestamptz not null
);

alter table throttles enable row level security;
alter table throttles force row level security;

create policy own_key on throttles
  using (key = nullif(current_setting('app.throttle', true), ''));

grant select, insert, update, delete on throttles to app;
