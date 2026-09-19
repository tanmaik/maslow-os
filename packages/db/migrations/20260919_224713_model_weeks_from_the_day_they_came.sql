-- Which week of the person's own the key's allowance was last set for,
-- counted in sevens of days from the day their computer was claimed; null
-- until the sweep first sets one.
alter table computers add column model_week integer;
