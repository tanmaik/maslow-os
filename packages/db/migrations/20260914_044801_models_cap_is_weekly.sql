-- The ceiling on the person's model key, in dollars a week. Written from
-- the deployment's default when the key is minted, so an owner can later
-- set one member's cap without touching every other; null is a key minted
-- before the column, which the deployment's default still covers.
alter table computers add column model_cap_usd numeric check (model_cap_usd > 0);
