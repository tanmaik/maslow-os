-- A trial deployment's orgs are each one guest's, made by "Try it" and
-- deleted a day later. The mark is when it was made; a real org has none.
alter table orgs add column trial_at timestamptz;
create index orgs_trial_at on orgs (trial_at) where trial_at is not null;

-- The trial's sweep names itself and sees the trial orgs alone, to count
-- them and to find the ones a day old; each is deleted as itself.
create policy trial on orgs for select
  using (trial_at is not null and current_setting('app.trial', true) = 'reap');

-- A guest is a person too, under an address no mail reaches. Once their
-- org is gone the sweep deletes them, and only a guest is ever deleted.
create policy trial on people for select
  using (email like 'guest-%@trial.invalid'
    and current_setting('app.trial', true) = 'reap');
create policy trial_delete on people for delete
  using (email like 'guest-%@trial.invalid'
    and current_setting('app.trial', true) = 'reap');
create policy only_guests on people as restrictive for delete
  using (email like 'guest-%@trial.invalid');
grant delete on people to app;
