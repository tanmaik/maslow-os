# 2026-09-05 — the database gate, and two fewer round trips

## `pnpm check:db` is the loop for database and brain work

The full smoke boots Next and walks every page, which takes minutes. A
change to a policy, a migration or a brain door needs only the database:
`pnpm check:db` starts a fresh Postgres in a directory of its own, migrates
and seeds it, runs the pooled-identity checks and the brain suite as the
restricted app role, and removes the cluster when it stops, interrupted or
not. Two runs at once do not touch each other. `pnpm check` stays the merge
gate; the fast loop does not reach routes, pages or vendors.

## Every suite runs, even after one fails

The smoke used to skip the connections and brain suites once any earlier
check had failed, so one red line hid every later one. Each suite now runs
and sets the failure flag on its own.

## A request's identity is one query

Each scoped transaction set its three or four settings one query at a
time. They are one parameterized `set_config` over an unnested array now:
a simple person-scoped read is six round trips instead of eight. The reset,
the transaction, the membership lock and the transaction-local scope are
unchanged, and the pooled-identity checks prove a poisoned connection still
sheds its identity.

## The catalog groups fields once

Assembling the vocabulary scanned every field row for every kind. Fields
are grouped by kind in one pass now, so the work is linear in kinds plus
fields; the output is byte-for-byte the same.
