# 2026-09-05 — recall by meaning

Full-text was deferred as enough "until a real question fails". The agent's
questions fail in a predictable way: it does not know the words a record
uses, only what it is about. So the brain gained one more read: `recall`,
a question in, the nearest records out, best first with a score.

## Vectors live beside the records, compared by brute force

Each record's meaning is a 512-number vector in `record_embeddings`, one row
per record, gone with it, kept under the model's name with when it was made.
Ranking is a dot product in SQL over every row of the person's brain. The
local Postgres is a plain binary from npm with no pgvector, and a laptop, a
preview and production must behave the same; one person's brain is a few
thousand records at most, and that is milliseconds. An index is a later
migration if it ever hurts.

## Made when asked, never when written

Writes do not call the model. A recall first catches up: the live records
the person sees, their own and what colleagues shared, changed since their
vector was made or never given one, are embedded a hundred at a time, oldest
change first, until none are behind; then the question is embedded and
ranked. The database says which are behind, comparing the record's last
change to the change its vector was made from, so nothing is read that is
not embedded, and a record changed while its vector was being made is behind
again. A write never waits on a vendor or fails because of one, the web
app's own writes are covered without knowing it, and a fresh brain fills in
as it is asked. Each batch is its own transaction, so vectors already made
stay made when the vendor fails midway, and the person's catch-up is held
while a batch is made, so two recalls at once never embed, or pay for, the
same records. Whoever sees a record may make its vector, since the vector
says nothing the record does not.

## Voyage, behind our interface, with a stand-in outside production

`deployment.embeddings` is Voyage when `VOYAGE_API_KEY` is set, and the model
and its size are fixed in code beside each other, since a vector is only
comparable with vectors of the same making. Outside production, without the
key, a stand-in hashes words and word pairs into the same shape of vector, so
recall visibly works on a fresh checkout and in the smoke, and the pill counts
it as faked. In production without the key there is no recall tool at all;
nothing pretends.

## Every token is on the meter

Each recall writes a usage row for the tokens Voyage counted, at Voyage's
list price, with the app that asked as its cause, the moment it happens;
the stand-in counts roughly, so the meter shows the line on a laptop too.
Usage rows gained a `cause` for this; nothing edits a row once written, as
with every other line. Measurement and price stay separate, as the meter
has them for machines and disks.
