-- Two models in one window are two lines of tokens at two prices: the one
-- row per window the sweep writes is one per model.
drop index usage_one_per_window;
create unique index usage_one_per_window
  on usage (org_id, user_id, resource, coalesce(model, ''), from_at)
  where cause is null;
