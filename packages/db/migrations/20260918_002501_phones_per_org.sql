-- A phone is one row per org the person carries it into, so each org's
-- agent reaches the same phone: the key is the org and the token together.
alter table phones drop constraint phones_pkey;
alter table phones add primary key (org_id, token);
