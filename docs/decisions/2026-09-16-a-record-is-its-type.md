# 2026-09-16 — a record is its type, and the brain is read three ways

Supersedes the universal `occurred_at` and `confidence` of
`2026-09-04-the-brain.md`, and the tool name of
`2026-09-05-recall-by-meaning.md`.

## What

Every record carries what every record needs: an id, a type, a title, a
body, its props, who wrote it, its version, and when it was written,
changed and removed. Nothing else is universal. When a thing happened,
and how sure the writer was, are fields a type declares when it needs
them, as a `date`, `datetime` or `number` field, and the read door
already filters and orders by any declared field. The one universal
order is when a record was written.

The brain is read three ways, each one tool, each one question:

- `list`: records of a type, filtered by any field the type declares and
  by a window of when they were written, ordered by any field, paged.
- `search`: records that say a thing or are about it. Exact hits on the
  words, quoted phrases and -exclusions over the title, the body and
  every field come first; where vectors are made, the records nearest in
  meaning fill the rest; each line says which. The full-text index reads
  every property's value beside the title and body.
- `get`, `graph` and `history` as before: by id, by links, and the log.

## Why

Tanmai, 2026-09-16: not everything has a when-it-happened or a
confidence, so neither belongs on every record; a type that needs one
declares it, and "the agent can write powerful tool queries based on
types to decide what to bring out." And "recall is a horrible name for
what that tool actually is"; "read is more like recent or list"; and
"we also need grep text with the body and properties."

## What it changes for the person

The calendar lays records on the day they were written, or on a date
field of the type's. The record page no longer shows a "when" or a "how
sure" row of its own; a type that wants them has them as fields. A link
between records is a verb and nothing else.
