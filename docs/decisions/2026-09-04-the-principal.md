# 2026-09-04 — every org has one principal

"An org keeps at least one owner" was a count, and a count has no one to
bill, no one to ask before the org is deleted, and no answer to who wins when
two owners disagree. It is now a name.

## One principal, on the org

`orgs.principal_id` names the membership that holds the org: an owner who
pays for it and alone can hand it to another member or delete it. It is not
null, and references `users (org_id, id)` deferred to commit, so an org and
its principal are written in one transaction — the seed, the sign-in that
founds an org of one, and any script that makes an org by hand.

The principal is always an owner: hand-over makes the new principal an owner,
demotion refuses the principal, and so does removal. That makes "at least one
owner" automatic, and the `last` outcome is gone with the count.

## Leaving, and not leaving

Anyone may leave their org and become a past member, from the settings page.
The principal cannot: they hand the org over first, or delete it. A person in
an org of one is its principal, so their only way out is to delete it.

## Deleting an org

Only the principal, and only by typing the org's name exactly; the server
deletes `where name = $1` under the org's own scope, so a wrong name deletes
nothing. Every foreign key to `orgs` now cascades, so members, past members,
sessions, invitations, vocabulary, records, edges and events all go with it.
People remain: a person outlives any org they were in. The rows going with
the org log no event; there is no org left to log one under.

Leaving and deleting end the session, so both routes live under `/auth/`,
where the proxy does not renew the cookie the route just cleared.
