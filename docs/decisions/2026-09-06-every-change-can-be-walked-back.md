# 2026-09-06 — every change can be walked back

The log is the person's memory of their own mind, so it holds every change
that concerns them, numbers their own changes from one, and any of those
changes can be walked back.

## What the log holds

Records, links, kinds, verbs and fields were already logged by the database
itself. Now shares and memberships are too. A share is logged as a change
of the owner who gave it, and seen by whoever can see the share; a
membership change — joining, leaving, coming back, a change of role, a
purge — is seen by every member. A name or a picture changing is not a
change of the org and is not logged. A purge is the org's line, not the
purged member's, whose log went with them.

Who sees what has not changed: your own changes, colleagues' changes to what
they shared with you, and who joined or left. A colleague's private record
never shows.

## Numbered from one

Each person's changes are counted from one, so their history reads without
gaps. The count is held for the transaction, so two changes of theirs at
once are numbered one after the other. Colleagues' changes show between
under their own numbers, with who made them. The log's place in the whole
database is kept as a paging cursor and never shown as a number.

## Walked back

A link is now hidden rather than erased, like a record, and comes back with
restore once its verb is there. That was the last thing a door erased.

`revert` takes the number of one of your own changes and puts the thing as
it was before: a created record is hidden, an edit is undone, a removal is
restored, a rename is renamed back, a field is put back with its
declaration. Only the latest change to a thing can be walked back, so
nothing made since is lost; the walk-back is one more change in the log,
and can itself be walked back. A share or a membership is changed in
settings, not walked back.
