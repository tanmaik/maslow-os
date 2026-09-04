# 2026-09-04 — the brain's interface is a database with views

The brain page was one column: a search, a flat list, the vocabulary as a
definition list, a note form and the file door, with no way to see an edge.
Replaced by views over the same doors, laid out like a database tool:

- **Records** is a table. Picking a kind adds its declared fields as columns,
  sortable by any field that has an order and filterable by any enum, through
  the read door's `where` and `orderBy`. Deleted rows are hidden unless asked
  for. A row is added in place, on the kind's own form.
- **A record** is one page: body, fields, provenance, every edge in and out
  with its verb, confidence and time, and its history from the log. Edit,
  delete, restore and unmerge live there.
- **Vocabulary** is the org's kinds, fields and verbs as tables, with forms
  to define more.
- **Activity** is the log, newest first. The read door gained `history` for
  this: `changes` reads forward for a consumer keeping up, `history` reads
  backward for a person looking.
- **Export & import** is the file door.

Every body is markdown, rendered with `react-markdown` and GFM on the theme's
tokens. A record with no body says so; nothing is forced.

## The graph is a map, and what it shows depends on the page

Three layouts were built and thrown away before this one: a force graph
with dots and names, the same with cards, and a map of columns by kind.
Each was readable, compact or organised, never all three, and none would
stay so as a brain grew. What replaced them answers a different question on
each page.

On the Records page the question is what the brain holds and how its kinds
connect, so each kind is a cluster of chips packed in a grid, the clusters
sit on a ring in the order that puts linked kinds side by side, and links
cross the empty middle where they can touch nothing. On a record page the
question is what is around this one thing, so that record sits in the
centre with everything it links to on a ring around it and the verb on each
spoke. Kind views have no graph.

A chip is a kind's icon and a title, cut short with an ellipsis. Positions
are exact, not simulated; a d3 simulation runs only under a drag, so a chip
stays where it is put and its neighbours shoulder aside. React Flow draws
it: pan with two fingers, pinch to zoom, click to open. It is the one
rendering library beside shadcn, taken because a hand-rolled SVG pan, zoom
and minimap would be more bespoke code than the rest of the interface put
together. The graph mounts in the browser only, after its pane has a size.

Links are read as sentences on a record page: "this person owes Road
Runner", with how sure and when beside. A person can link two records on
one of the org's verbs, or unlink them, from there. Two gaps closed on the
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
surface for errors waits until the notice pattern in settings is generalised.
