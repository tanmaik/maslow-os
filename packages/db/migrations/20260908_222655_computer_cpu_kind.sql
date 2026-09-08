-- A computer's size names its CPUs' kind too: shared, or dedicated
-- ("performance" in Fly's words).
alter table computers
  add column cpu_kind text not null default 'shared';
