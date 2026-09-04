-- An edge can say how strongly and since when, not only that.

alter table edges add column props jsonb not null default '{}';
alter table edges add column confidence real check (confidence between 0 and 1);
alter table edges add column occurred_at timestamptz;
