-- The OpenRouter key a computer's Claude Code runs on, minted per person
-- with a cap: the key itself, given to the machine; its hash, which reads
-- its spend back; and the spend recorded so far, so the ledger gets only
-- what is new.
alter table computers
  add column model_key text,
  add column model_key_hash text,
  add column model_spent_usd numeric not null default 0;
