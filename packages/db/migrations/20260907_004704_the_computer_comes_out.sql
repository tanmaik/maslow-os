-- The computer comes out: the machine and its volume on Fly, the uploads
-- staged for it, its backups, and the model calls Claude Code made from it.
-- What the ledger recorded of them goes with them, and the debts the
-- vendors were still owed for them are paid by hand, not by the sweep.
drop table model_calls, backups, files, computer_secrets, computer_events, computers cascade;
alter table orgs drop column computers;
delete from usage where resource in ('compute', 'rootfs', 'disk', 'tokens');
drop index usage_one_per_window;
alter table usage drop column model;
create unique index usage_one_per_window
  on usage (org_id, user_id, resource, from_at) where cause is null;
delete from orphans where kind in ('stop', 'machine', 'volume', 'object', 'upload');
alter table orphans drop constraint orphans_kind_check,
  add constraint orphans_kind_check check (kind in ('accounts', 'picture'));
