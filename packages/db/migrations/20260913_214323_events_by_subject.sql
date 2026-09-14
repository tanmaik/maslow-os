-- The changes to one thing, in order: what a page or an agent watching a
-- record reads, and what a save that names the last change it saw is
-- checked against.
create index events_by_subject on events (org_id, subject_id, seq);
