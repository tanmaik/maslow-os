-- When a debt comes due. Most are due the moment they are owed; one for an
-- object the browser is still putting itself is due only once the address
-- it was signed for has expired, so the sweep never deletes a picture out
-- from under the upload that is landing on it.
alter table orphans add column due_at timestamptz not null default now();
