-- A person has a first name and, optionally, a last name. The display name
-- is a column the database generates from the two, on people and on every
-- membership's copy.

alter table people add column first_name text, add column last_name text;
alter table users add column first_name text, add column last_name text;

-- An existing name is cut at its first space; one with nothing before the
-- space takes the address's local part.
update people set
  first_name = coalesce(nullif(split_part(btrim(name), ' ', 1), ''), split_part(email, '@', 1)),
  last_name = nullif(btrim(substr(btrim(name), length(split_part(btrim(name), ' ', 1)) + 1)), '');
update users set
  first_name = coalesce(nullif(split_part(btrim(name), ' ', 1), ''), split_part(email, '@', 1)),
  last_name = nullif(btrim(substr(btrim(name), length(split_part(btrim(name), ' ', 1)) + 1)), '');

alter table people alter column first_name set not null,
  add check (first_name <> '');
alter table users alter column first_name set not null,
  add check (first_name <> '');

alter table people drop column name;
alter table users drop column name;
alter table people add column name text
  generated always as (first_name || coalesce(' ' || last_name, '')) stored;
alter table users add column name text
  generated always as (first_name || coalesce(' ' || last_name, '')) stored;

grant update (first_name, last_name, avatar_key) on people to app;
