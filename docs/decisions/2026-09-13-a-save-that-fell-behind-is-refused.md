# A save that fell behind is refused

**2026-09-13.** A change to a record may name the last change of that
record its writer saw. If anything it sets — the title, the body, a
field, when, how sure — changed after that, the door refuses it with a
conflict, and nothing is written. A change that names nothing lands as it
always did.

The record page names it on every save of the title or the body, and
asks the log every few seconds whether the record has changed elsewhere,
refreshing when it has. A refused save is held on the page beside the
newer version, and the person keeps theirs or takes it. Fields save
without it: a field is one value, and the last one written is the one
meant.

## Why

Two people with edit on one record, or a person and their agent, could
each write the whole body and the second silently erased the first. This
is the floor under live co-editing, which is next: the relay that will
merge keystrokes saves through the same door, and this is what keeps it
from writing over an agent's rewrite it has not merged yet.

## What it is not

Not a version on the record. The log already numbers every change in
commit order; the check reads it, and only for the columns the change
sets, so a person filling in a field does not make their own body save
fall behind. One index was added so the read is one lookup.

The page reads the number before the record, in two statements. A change
that lands between the two pairs newer text with an older number, and
the first save then falls behind once for nothing: the bar shows the same
text and Keep mine lands it. That is the safe side of the gap, and a
single-snapshot read would need a door of its own for a case measured in
microseconds.
