-- A membership's accounts at Composio are something a vendor holds for us,
-- owed when the membership goes.
alter table orphans drop constraint orphans_kind_check;
alter table orphans add constraint orphans_kind_check
  check (kind in ('stop', 'machine', 'volume', 'object', 'upload', 'accounts'));
