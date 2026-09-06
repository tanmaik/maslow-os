-- A kind or a verb leaves the vocabulary the way a record leaves the brain:
-- hidden, kept with its history, and brought back by restore. Its name
-- stays taken while it is away, so restoring it never collides.
alter table record_kinds add column deleted_at timestamptz;
alter table edge_verbs add column deleted_at timestamptz;
