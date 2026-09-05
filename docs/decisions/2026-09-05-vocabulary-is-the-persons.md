# 2026-09-05 — the vocabulary is the person's

A kind, a verb and the fields a kind declares belong to the member who
defined them, the way a record belongs to whoever wrote it. A colleague's
vocabulary starts empty, and two members of one org may each define a
`note`: they are two kinds, each with its own fields and its own records.

## Why not the org's

The brain is a graph of one mind. A vocabulary the whole org saw meant a
colleague's kinds appeared in everyone's catalog with none of the records
behind them, an agent could write a record of a kind whose meaning someone
else had set, and one person's fields shaped another's forms. Ownership of
the vocabulary follows ownership of the records so that what a person sees
of a colleague's brain is exactly what was shared, vocabulary included.

## Sharing is visibility, and a kind is shared like a record

A grant is on a record or on a kind. A grant on a kind reaches every record
of it, at the level given; a record shared alone brings its kind into view.
The owner stays the owner: only they write records of their kind, add
fields to it or share it, and a colleague reading a shared kind names its
owner. `grant_level` reads grants on a record and on its kind; `kind_reach`
says how a kind reaches the current member, and is both the kind's row
policy and the `via` the catalog reports.

The interface lists what was shared into a brain beside the person's own
kinds, grouped by whose it is and how it was opened: the whole kind or some
records, to everyone in the org or to them. Those tables read; nothing is
written into them.

## The migration on a populated database

Every existing kind, verb and field gets an owner: the member its author
names, when that member is still on the org's books, else the org's
principal. Every other member who had written records of a kind, or edges
carrying a verb, gets their own copy of it as it stood, because a record is
of its owner's kind and an edge carries its maker's verb. The log's entries
about a kind, a verb or a field become its owner's. Purging a past member
takes their vocabulary with their records.

## In the file

An export is one person's vocabulary, records, edges and the shares they
gave, kinds included, which travel by name and land on the importer's kind
of that name. What colleagues shared into the brain stays out of the file.

## Rejected

Copying the seed's starter vocabulary onto every new member: the agent is
meant to find the right structure for a person, not inherit a colleague's.
Making `person_id` nullable so an org-wide kind could be ownerless: the
"everyone" row the records decision already refused. Matching a kind by
name across owners in a read: a filter on a declared field would cast a
colleague's values by the reader's declaration, so a kind in a read is one
person's, the reader's own unless the owner is named.
