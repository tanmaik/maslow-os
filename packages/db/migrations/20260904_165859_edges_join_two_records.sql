-- An edge joins two different records; a record cannot link to itself.

alter table edges add check (from_id <> to_id);
