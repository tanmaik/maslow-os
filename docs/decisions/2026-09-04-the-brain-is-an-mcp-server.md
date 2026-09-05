# 2026-09-04 — the brain is an MCP server, behind our own sign-in

Claude Code and claude.ai reach the brain over MCP at `/mcp`. Both expect a
remote server to protect itself with OAuth and to say where its authorization
server is, so the site became one. What was decided on the way.

## The doors are the tools

Twelve tools, one per door: catalog, read, get, graph, write, edit, remove,
restore, unlink, merge, unmerge, history. Each call is one transaction as the
person, through `asPerson`, and a refusal from a door (`Invalid`, `NotFound`,
`Conflict`, `Forbidden`) goes back as a tool error with the door's sentence,
so the agent can act on it. Sharing and the file door are not tools yet: an
agent has no member or group ids to share with, and a file is a person's to
move.

The server's instructions carry the field guide's paragraph on the brain: a
mind, not a mirror; read the catalog first; define in the same call; writes
are idempotent. What the model writes is logged as `model:<client>`, with the
client's name from its registration, so the activity log says Claude wrote it
and the record still belongs to the person.

## A token is a session

The access token an app gets is a session token, the same `org.session`
string a browser holds in its cookie. `sessions` gained a `client` column: a
browser's is null, an app's is its name. Resolving a bearer token is
`resolveSession`; ending an app's access is deleting its row, from an Agents
card in settings, and the next request with that token is a stranger. No
refresh tokens and no expiry: a session lasts until it is ended, as the site's
sessions do. JWTs were rejected because a token that cannot be revoked is not
one the settings page can honestly list.

## An app's description is its client id

Both clients register themselves dynamically. A registry would be a table
with no org to belong to and a sweep to prune it, and open registration
protects nothing anyway: anyone can register any address. So the registration
is returned as the client id, base64url of the name and redirect addresses,
and the authorize page reads it back. Redirect addresses must be https, or
http on the machine itself, since a command-line client listens on
localhost. The consent page names the app, the person and the org, which is
the real defence.

PKCE with S256 is required. A code is a row in `oauth_codes`, in the org,
spent by the token endpoint in one `delete ... returning`; a wrong verifier
burns it, and a person's stale codes go when they next approve something.

## Every request stands alone

The transport is the SDK's web-standard streamable HTTP one in stateless mode
with JSON responses: no session id, no server-sent events, nothing held
between requests. A Vercel function can answer any request, and the smoke can
call it with `fetch`. GET and DELETE on `/mcp` answer 405.

## A sign-in returns where it started

The authorize page, signed out, is the sign-in. To come back afterwards, the
sign-in forms carry `next`, a path on this site; the flow cookie remembers it
between the two legs of a code sign-in; and `/auth/dev`, `/auth/switch` and
`/auth/restart` honour it too. The dev pill now sends the page it was picked
from, so switching person keeps you where you were. The consent page offers
the person's other orgs, since an app is connected to one membership.

## Not built

Scopes: an app gets everything the person can do in the brain. CORS on the
OAuth endpoints, which a browser-based MCP client would need. Resource
indicators. A record of when an agent last called.
