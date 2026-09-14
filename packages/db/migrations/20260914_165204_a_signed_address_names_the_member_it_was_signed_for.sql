-- Whose debt it is. An address signed for an upload is signed for one
-- membership, and the debt written beside it is the only record of that:
-- whoever comes back to say what landed on the key must be the person it
-- was minted for, so nobody records someone else's picture as their own.
-- Null where nobody owes it in person — an org deleted, a purge.
alter table orphans add column user_id uuid default current_member();
