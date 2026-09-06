-- A usage row may say what it was for: the app that asked for a recall,
-- the action an agent ran. Rows the sweep writes from what was held have
-- none, and those are the ones there is one of per window; what was spent
-- at an instant may share the instant.
alter table usage add column cause text;
alter table usage drop constraint usage_org_id_user_id_resource_from_at_key;
create unique index usage_one_per_window
  on usage (org_id, user_id, resource, from_at) where cause is null;
