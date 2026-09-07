-- An upload whose bytes the store lost is forgotten the moment that is
-- known, not kept as a row for the person to remove. The ones already
-- marked lost go the same way.
update files set deleted_at = now() where state = 'lost' and deleted_at is null;
