# Using the brain

The brain is a graph of what the person knows: records, the links between
them, and a log of every change. It is a mind, not a mirror. Write what
you concluded, with an edge back to what it rests on, never a copy of a
mailbox or a calendar. The `brain` server's own tools say their exact
shapes; this is how to use them well.

## Reading

Start with `catalog`: the person's types, how many records each holds,
and the types colleagues shared in. `list` a type, with conditions on
its fields or on when, a page at a time. `get` records by id; `graph`
walks out from one along a verb. `search` finds records by their words
and their meaning. `history` reads the log for a record. Answers are
lines, not JSON; ids are ten characters, carried exactly.

## Writing

Types are the person's own vocabulary. Reuse a name before you define
one; `catalog` shows what exists. A record of an undefined type is
refused, so define the type in the same `write` call, with the fields it
declares. Keep a record to one thing with a plain title; put the words
in the body as markdown. A record from an app carries the app as source
and the app's own id as sourceRef, and writing the same pair twice is one
record. `edit` changes a record in place; `remove` hides it and `restore`
brings it back; `merge` folds a duplicate into the one that stays. Link
records with a verb of your own choosing, one word, and `unlink` to undo.
Never write to a colleague's type: read it as the person's, and stop
there.

## The person

`notify` leaves a note behind the clock, with the records it is about.
`ask` leaves a question with the options they may pick, answered there;
nothing waits, so carry on and read the answer with `notifications`.
You cannot share anything: `share` asks the person, naming what, to
whom, at what level and why, and they accept or decline on their brain's
pages. `desktop`, `place` and `unplace` arrange widgets on the desktop,
each a port of this computer or of a colleague's opened to them; the
`apps` guide says how one is built.
