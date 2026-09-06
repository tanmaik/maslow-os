# 2026-09-05 — the brain speaks in lines

What changed in the MCP server once an agent had used it for a day, and
what was decided against.

## Answers are lines, not JSON

Every tool answered with pretty-printed JSON: every key spelled out for every
record, dates to the millisecond, nulls for what was not there. An agent
reads all of it and carries the ids back. Now a tool answers in text, one
line per thing, the id first, then only what is there: `id kind when "title"
src=source:ref vN`, then `derived c=0.8`, `shared:view`, `removed` or
`merged→id` when so, then the props as compact JSON, and the body beneath,
indented. A link from a record is `→ verb id "title"`. A change in the log
is one line naming only the fields that moved. The format is described once,
in the server's instructions. Structured output beside the text was rejected:
clients hand the model both, so it doubles the cost of every answer.

## The handshake says whose brain this is

The instructions an MCP server hands over at connect time were the same for
everyone. Now the request that opens a connection runs one query as the
person and the first sentence says their name, their org, the date, how many
records there are of each kind and what the verbs are. Only the handshake
pays for it; every other request builds the server without.

## The vocabulary bends

A kind, a verb or a field, once defined, could only gain fields. Two doors
change that. `redefine` renames or redescribes a kind or a verb, with records
and edges following through the foreign keys, and renames, retypes,
redescribes or requires a field. A field change must fit what records of the
kind already hold, or it is refused with the count to fix first; a rename
carries every value to the new name, which no record may hold already.
`undefine` removes a field and its values from every record, and removes a
kind or a verb only once nothing is of it.

The vocabulary is the person's, and so are the records of a kind, so a
change reaches the caller's own records and nobody else's: plain updates
under row-level security, no privileged function. A kind shared in from a
colleague is theirs; reshaping it is refused with their name on the refusal.

Names, descriptions, sources and refs must print: no control characters,
so nothing written can forge a line in what an agent reads back.

## Walks, and calls that take many

`graph` now walks: from some records, to a depth, along chosen verbs, out or
in or both, and each record comes back with its distance. `edit`, `remove`,
`restore`, `unlink` and `unmerge` take lists, in one transaction: a refusal
anywhere refuses the whole call, so a stale version never half-applies.

## An app may be described at an address

Client ID Metadata Documents, which the MCP spec now recommends over dynamic
registration and which claude.ai prefers. A client id that is an https
address with a path (or http on the machine itself, as a command-line app
serves) is fetched, must name itself by that exact address, and must describe
a client as registration would; the description is kept five minutes. It is
fetched only once a request has parsed, and only from a host whose every
address is public, so nothing inside our network is ever asked for one. The
code an approval issues carries the app's name from the consent page, so
trading it in fetches nothing and a vendor's bad minute never burns a code.
The server says so in its metadata. Registration stays for clients that have
not moved.
