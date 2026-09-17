-- An ask may name the conversation on the person's computer it was asked
-- from, so the answer goes back to it as the next word said there.
alter table notifications add column reply_to text;
