# 2026-09-04 — a removed member is a past member

Removing a member used to delete their `users` row, which failed the moment
they had written anything in the brain. Keeping the row unseen fixed the
crash and left a question: whose are the records now?

## Kept, as theirs, until the owner decides

The records stay attributed to the membership that wrote them, exactly as if
the person were still there, and nobody can see them. The org owner has two
ways out, both under "past members" in settings:

- **Bring back** clears `removed_at` on the same row. Everything they wrote
  is theirs again the moment they sign in. Inviting the same email again does
  the same on sign-in, so there is no way to fork one person into two
  memberships.
- **Purge** deletes the membership and every record and edge under it. That
  may include things the org depended on; the owner is told so and chooses.
  Events stay, as the log of what happened.

## One membership per person per org, ever

`users (org_id, person_id)` is plainly unique again. The partial index that
allowed a fresh membership beside a tombstone went with the idea of fresh
memberships.

## One setting shows past members

Policies hide a removed row from every query. The transaction that lists,
removes, restores or purges past members sets `app.past_members = 'on'` and a
`past_members` policy shows the org's removed rows to it.

## Left open

Storage held by past members is metered to the org like everything else the
org holds. That is the reason the owner can purge; nothing here prices it.
