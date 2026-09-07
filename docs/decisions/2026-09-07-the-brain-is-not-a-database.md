# 2026-09-07 — the brain is not a database

The brain's tables hold what the product reads at runtime and nothing kept
for the record. The log is the record. Kinds are called types, grants are
called shares, and verbs are no longer rows.

## What left

- **Verbs as rows.** A verb has no fields to check values against and is
  never shared, so the table's one job was refusing an edge whose word had
  not been typed before. That cost the agent a definition step and bought
  nothing. A verb is the word on an edge; the catalog reads the words in
  use off the edges; renaming one updates the edges that carry it, which
  the log records like any edge change.
- **Descriptions.** A type's name is what a model needs; a sentence beside
  it hardcodes more than the mechanism does. Fields keep their name, what
  they hold and whether they are required.
- **Authors and dates on rows.** `author` and `created_at` on types, fields
  and shares; `author` and `version` on records; `author` on
  edges. Every change is a line in the log with its author, so a row
  carrying the same is a second copy that only a person browsing the table
  would read. Records keep `created_at` and `updated_at` and edges keep
  `created_at`, because the read door orders by them and recall uses the
  last change to know which vectors are stale: those are runtime reads.
- **Layer.** Whether a record is a conclusion is whether it carries a
  confidence; a second column saying the same was a rule to remember.
- **Source and ref on edges.** On a record the pair is the idempotency
  key, which the write door reads. On an edge nothing read it; it was
  provenance printed back to the agent. Edges keep what, how strongly and
  since when.
- **How a shared type reached you.** Whole type or some records, to
  everyone or to you: a definer function and a catalog field to say it,
  and nothing that needed it. A type not your own is shared with you or it
  is not.
- **A ref on every hand-written record.** A record written without a
  source gets one from the door, `brain` and a fresh id, so the idempotent
  write and the export keep working and no page has to invent one.
- **Two seed types.** `file` and `tile` came from the computer's library
  and the board, both gone.
- **Edit by version.** With no version on a record, an edit applies. Two
  people editing one record at the same moment is not a case the product
  has; the log still holds every version.

## Who a change is by

The log trigger used to read the author off the row it was logging. Now the
transaction says who is acting: `asPerson` sets the app connected as the
person when the session has one, and the trigger falls back to the member
on the connection. Doors take no author.

## Names

`record_kinds` is `types`, `kind_properties` is `type_properties` with the
field's datatype in `datatype` so that `type` can name the record type
everywhere, `grants` is `shares`. In the log, lines about kinds are about
types, and the row copies use the new names too. Lines about verbs stay as
written; nothing walks them back.

## The file

A brain exports as types, fields, records, edges and shares as the tables
now hold them, without descriptions, layers or authors, and the log, whose
lines keep their authors. The file's format tag stays as it was: nobody
holds an old file yet, so there is nothing to version.

This supersedes the parts of "the vocabulary is the person's" and "a kind
is removed, not erased" that speak of verbs as rows and of descriptions.
