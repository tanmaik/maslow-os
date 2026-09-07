# 2026-09-07 — the database keys are write-only

## Either database URL opens every brain

Row-level security binds the app's role to the org and person a connection
declares about itself, in settings any connection may set. It protects
against a query of ours that forgets who is asking. It does not protect
against a person holding the app's URL, who can declare themselves anyone,
and the owner's URL bypasses the policies outright. Both are master keys.

## Production's two URLs are Sensitive in Vercel

The environment store keeps every value readable so it can be pulled,
diffed and audited. Production's `DATABASE_URL` and `DATABASE_OWNER_URL` are
the exception, marked Sensitive on 2026-09-07: the build migrates with the
owner's, the app runs with its own, and neither can be read back from
Vercel by a person. Sensitive stops a look-up. It does not stop a deploy:
build and function code still read the values, so anyone who can ship code
to production can make it print them. It narrows who can read the keys
from anyone with Vercel access to anyone who can deploy, no further.
Previews keep readable URLs to branches that hold seed data only.

## The gate refuses code that could carry a key out

`pnpm check:secrets`, part of `pnpm check`, reads every file that ships and
every script a deploy runs. `DATABASE_URL` and `DATABASE_OWNER_URL` may be
named only in the files that open a database, listed in the script; shipped
code reads the environment one name at a time and never spreads, prints or
serialises it whole. A pull request that would print a key fails the gate,
and one that widens the list changes the script itself, in plain view of
review. What the gate cannot refuse is a person who can merge choosing to
change the gate.

## What this does not do

Anyone in the Neon organisation can still reset a role's password, open the
SQL editor, or branch production, and read everything. The Neon API key on
GitHub can do the same through the API. Access to a brain is bounded by who
is in the Neon account until records are encrypted with a key the database
never holds, which is a product decision about what the brain can search,
not yet taken.
