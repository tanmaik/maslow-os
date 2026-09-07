# 2026-09-03 — the sign-in screen is ours; WorkOS vouches for an email

Sign-in goes through WorkOS. How it was wired so that the screen is ours and
nobody is asked for a name.

## Managed: a six-digit code through WorkOS's API, behind our form

WorkOS's hosted AuthKit page was tried first and rejected: it is their screen,
it asks for a first and last name on sign-up, and it needs a redirect URI per
host, which on Vercel's shared suffix meant a wildcard WorkOS documents as
forbidden. Their User Management API is headless, so the form is ours. The
first leg posts an email and WorkOS mints a code; the second posts the code and
WorkOS answers with who holds the address. No redirect URI exists anywhere, so
every preview and every checkout works with the same two values:
`WORKOS_CLIENT_ID`, the environment's client ID, and `WORKOS_API_KEY`.
Staging for development and previews, Production for production.

Passkeys were wanted too. WorkOS offers them only inside the hosted page, so
they are absent until that changes.

## Sessions are rows in the org

The identity provider vouches for an email and a name, and that is its whole
part. A session is a row in `sessions`, belonging to the org like every other
row. The cookie carries `org.session`; a forged org sees no row.

A session lasts until the person signs out; nothing about it ages. Browsers
cap a cookie at about 400 days, so `proxy.ts` renews the cookie on every
visit, and a person who keeps coming back is never signed out by time. Only
sign-out deletes the row, and a deleted row makes the cookie worthless on the
next request.

## Membership is ours; a WorkOS organization is a later mirror

WorkOS organizations are free and a WorkOS user can hold zero or many
memberships, so an org of one is a WorkOS user with no WorkOS organization at
all. Membership lives in our tables because the org is ours and must be the same
object everywhere. An invitation is a row keyed by email;
the person is admitted when the provider vouches for that email. A WorkOS
organization is created only when an org turns on its own identity provider,
which is also the only point WorkOS charges per org.

## Sign-in sees one email before it sees an org

Admission needs to find a person by email before any org is known. Rather than
a privileged path, a second policy on `users` and `invitations` lets a
connection that names `app.email` see the rows carrying that email and the
names of the orgs those memberships are in, and nothing else. Settings are the app's claims; policies exist so a `where` cannot be
forgotten, not to defend against the app.

## No name is asked for

A person is their email. The name WorkOS returns is kept when it has one, and
the part before the `@` stands in until they set one.

## Mail is Resend, and the code mail is ours

WorkOS's API mints the code and hands it back, and by default also mails it
itself from its own address. Two mails per sign-in with the same code looked
like spam and were treated as spam, so WorkOS's Magic Auth mail is switched
off in both environments (Emails → Configuration) and the code mail is ours,
through Resend, with `RESEND_API_KEY` and `MAIL_FROM`. Without them, outside production, the code is printed to the
server's terminal and the page says so, which is the visible fallback the
field guide asks for. In production a WorkOS deployment with no mail refuses
to start: nobody could enter it. Invitations use the same sender when it
exists and say plainly when it does not.

## Abuse limits on the anonymous surface

Asking for a code and guessing a code are the two things a stranger can do,
and both spend money or attempts. A `throttles` table, visible one key at a
time through `app.throttle`, counts hits per window: three codes per email and
twenty per network address in ten minutes, five guesses per code, and a fresh
code lifts the guess lock. Over the limit, the page says so. The network
address is what the nearest proxy reports, which Vercel sets itself; with no
proxy there is none to count against and only the per-email limit applies.
Throttle rows are never pruned; they are one small row per key and the
nightly sweep is where that goes when it matters.

## Not built yet

A stolen session cookie is valid until that session signs out; there is no
"sign out everywhere" and no record of when a session was last seen. The
session id is stored as is, so reading the table is holding the sessions.
Inviting tells a signed-in person whether an address already belongs to
someone, which is a small oracle accepted for now.

Resend needs a verified sending domain before production can sign anyone
in.
