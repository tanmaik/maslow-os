# 2026-09-03 — the sign-in screen is ours; WorkOS vouches for an email

Managed sign-in goes through WorkOS. How it was wired so that the screen is
ours, nobody is asked for a name, and self-hosted is the same code from the
callback onward.

## Managed: a six-digit code through WorkOS's API, behind our form

WorkOS's hosted AuthKit page was tried first and rejected: it is their screen,
it asks for a first and last name on sign-up, and it needs a redirect URI per
host, which on Vercel's shared suffix meant a wildcard WorkOS documents as
forbidden. Their User Management API is headless, so the form is ours. The
first leg posts an email and WorkOS mails a code; the second posts the code and
WorkOS answers with who holds the address. No redirect URI exists anywhere, so
every preview and every checkout works with the same two values:
`WORKOS_CLIENT_ID`, the environment's client ID, and `WORKOS_API_KEY`.
Staging for development and previews, Production for production.

Passkeys were wanted too. WorkOS offers them only inside the hosted page, so
they are absent until that changes.

## Self-hosted: any OpenID Connect provider, through a redirect

A self-hoster's people already have an identity provider, so the app is also a
standard OIDC relying party through `openid-client`, with the issuer as one
config value: `AUTH_ISSUER` and `AUTH_CLIENT_ID`. The provider's own screen
handles credentials; ours handles nothing. Both paths end at the same
admission and the same session, so there is one auth system with two ways of
being vouched for.

## Sessions are rows in the org

The identity provider vouches for an email and a name, and that is its whole
part. A session is a row in `sessions`, belonging to the org like every other
row. The cookie carries `org.session`; a forged org sees no row. Thirty days,
deleted on sign-out.

## Membership is ours; a WorkOS organization is a later mirror

WorkOS organizations are free and a WorkOS user can hold zero or many
memberships, so an org of one is a WorkOS user with no WorkOS organization at
all. Membership lives in our tables because self-hosted has no WorkOS and the
org must be the same object everywhere. An invitation is a row keyed by email;
the person is admitted when the provider vouches for that email. A WorkOS
organization is created only when an org turns on its own identity provider,
which is also the only point WorkOS charges per org.

## Sign-in sees one email before it sees an org

Admission needs to find a person by email before any org is known. Rather than
a privileged path, a second policy on `users` and `invitations` lets a
connection that names `app.email` see the rows carrying that email, and nothing
else. Settings are the app's claims; policies exist so a `where` cannot be
forgotten, not to defend against the app.

## No name is asked for

A person is their email. The name WorkOS returns is kept when it has one, and
the part before the `@` stands in until they set one.

## Mail is Resend, and the code mail is ours

WorkOS's API mints the code and hands it back; only its hosted page mails it.
So the code mail is ours, through Resend, with `RESEND_API_KEY` and
`MAIL_FROM`. Without them, outside production, the code is printed to the
server's terminal and the page says so, which is the visible fallback the
field guide asks for. In production a WorkOS deployment with no mail refuses
to start: nobody could enter it. Invitations use the same sender when it
exists and say plainly when it does not.

## Assumed: one person, one org

WorkOS holds one identity per email, and `users.email` is globally unique, so a
person is in exactly one org and an existing email signs into the org it
already belongs to. Splitting `users` into people and memberships is the change
if the product wants Figma-style workspaces. Assumed, not settled: the founder
was asked and had not answered when this was built.

## Not built yet

The self-hosted signup rule, first arrival owns and everyone after is invited,
needs a way to ask whether the instance is empty, which no org-scoped
connection can. Signup is open everywhere until then. Resend needs a verified
sending domain before production can sign anyone in.
