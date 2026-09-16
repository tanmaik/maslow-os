# 2026-09-04 — the brain's interface is a database with views

The brain page was one column: a search, a flat list, the vocabulary as a
definition list, a note form and the file door, with no way to see an edge.
Replaced by views over the same doors, each a card beside a rail of the
brain's views:

- **The rail** is a floating card: everything, one view per type of the
  person's own, the types shared into this brain with whose each is, and
  the types page. It says how many records of the person's own it holds.
- **Records** is one card: a search and a way to write a record on top, the
  agent's asks to share beneath them, then a row per record with its type
  and when. Picking a type puts its declared fields in the columns.
  Deleted rows are hidden.
- **A record** is one page, a card of its own beside the rail: its type
  and whose it is, the title and body edited in place, its fields with how
  sure and when among them, then "Relevant records", every record linked
  to it as a chip named after it, with whose it is when it is a
  colleague's, and the ring beside them when it has links and no more than
  eight; the verbs are read on the ring. Then "Who can see it".
  Link, unlink, share, delete, restore and unmerge live there. Nothing on
  the page says who wrote it or when; that is the log's.
- **Types and fields** is the person's types as cards, each with its form
  and a share; below them, the types colleagues have shared into this
  brain, grouped by owner.

Every body is markdown, rendered with `react-markdown` and GFM on the theme's
tokens. A record with no body says so; nothing is forced.

## The graph is a map of one record

Three layouts were built and thrown away before this one: a force graph
with dots and names, the same with cards, and a map of columns by kind.
Each was readable, compact or organised, never all three, and none would
stay so as a brain grew. Only a record page has a graph. Its question is
what is around this one thing, so that record sits in the
centre with everything it links to on a ring around it and the verb on each
spoke. A ring answers that question up to a handful of links and past that
it is a thicket, so a record with more than eight links has no map, and its
links are read as a list alone; the page does not read the graph for it.
A record with no links has nothing to map and no map either.
A galaxy of groups within groups was designed for the crowded case and
dropped on 2026-09-09: the list is enough there.

A chip is a type's mark, a small square in its colour, and a title, cut
short with an ellipsis. Positions
are exact, not simulated; a d3 simulation runs only under a drag, so a chip
stays where it is put and its neighbours shoulder aside. React Flow draws
it: pan with two fingers, pinch to zoom, click to open. It is the one
rendering library beside shadcn, taken because a hand-rolled SVG pan, zoom
and minimap would be more bespoke code than the rest of the interface put
together. The graph mounts in the browser only, after its pane has a size.

A person can link two records on any verb, or unlink them, from the
record page. Two gaps closed on the
way: an edge could join a record to itself, and no edge could ever be
removed through the door. Both are now refused or possible, with checks in
the smoke suite.

Whole-app layout went full width with the same change: the root layout no
longer caps at a reading column, headers wrap, settings cards sit in a grid,
tables scroll sideways on a phone, and the brain's rail of views becomes a
scrolling row below `md`.

Considered and rejected: a client-side data grid. The tables are server
rendered from URL state, so every view is a link, the back button works, and
nothing is fetched twice. A form that fails validation gets the write door's
sentence as a plain response, the same as every other route here; a nicer
surface for errors waits until the notification pattern in settings is generalised.
