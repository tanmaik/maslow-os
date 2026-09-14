# Maslow

```
pnpm install
pnpm dev
```

That is the whole setup: a Postgres of your own, migrated and seeded, and the
app on a free port. `pnpm check` is the merge gate — typecheck, format, unused
code, and a smoke that boots a fresh stack and walks it. A migration starts
with `pnpm migration:new <name>`. Read [CLAUDE.md](CLAUDE.md) before changing
anything, and [REVIEW.md](REVIEW.md) before merging it.

Every pull request from this repository gets its own database and preview
with nothing to set up. A fork's pull request gets neither: the workflow
holds credentials.

Outside production, sign in by picking a seeded person from the pill in the
corner; the pill also says which vendors are faked. With the dev-secrets key
(below), `pnpm dev` signs in for real too: enter an email, get a six-digit
code from WorkOS, enter it. Nothing is registered per host, so every checkout
and every pull request works with the same two values, and production carries
WorkOS Production's:

```
WORKOS_CLIENT_ID=client_...   # the WorkOS environment's client ID
WORKOS_API_KEY=sk_...
```

Mail goes through Resend when `RESEND_API_KEY` and `MAIL_FROM` are set: the
sign-in code, and invitations. Without them, locally and on previews, the code
is printed to the server's terminal and the page says so.

## Claude and the brain

The brain is an MCP server at `/mcp`, behind the same sign-in as the site.
Give Claude Code the URL and it does the rest:

```
claude mcp add --transport http brain https://<host>/mcp
```

On claude.ai, add the same URL as a custom connector. Either way a browser
opens, you sign in and allow it, and Claude reads and writes your brain as
you, in the org you were signed in to. Every write it makes is logged as
the model's. Disconnect it under Agents in settings. Locally the host is the
one `pnpm dev` prints; claude.ai cannot reach a laptop.

Uploaded images live in an S3-compatible bucket named by `STORAGE_ENDPOINT`,
`STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY` and
`STORAGE_SECRET_KEY`. Without them a checkout uses a directory and a preview
refuses uploads.

Analytics, replay and error tracking go to PostHog when `POSTHOG_KEY` is
set: every page seen, click, error and replay, as whoever is signed in,
tagged local, preview or production. One PostHog project serves all three,
and its filter counts only production. Without the key nothing is reported
and the pill says so.

A record's body is live while people are in it: the relay in `packages/sync`
holds the document and saves through the app, on the `SYNC_SECRET` the two
share. `pnpm dev` starts one beside the app on a secret of its own. On
Vercel the sweep keeps one machine on Fly per environment, on the
`SYNC_SECRET` set there: previews share one, made when the first preview
sweeps and reaped a day after the last stops renewing it; production has
its own. Without a secret nothing is live and the page saves as it does
alone.

Production refuses to start without WorkOS, mail, storage, analytics, the relay's secret, or the
sweep's `CRON_SECRET`.

## Dev secrets

`.env.development` holds every dev secret — WorkOS, Resend, the bucket,
Composio, Voyage — encrypted, in the repo. One private key decrypts
it. On a laptop, being on the Vercel team is the access:

```
vercel login && pnpm env:pull      # once per checkout; writes .env.keys
```

An agent gets the same key from its environment's secret store, as
`DOTENV_PRIVATE_KEY_DEVELOPMENT`. With it, `pnpm dev` says how many values it
decrypted; without it, it says vendors are faked.

```
pnpm env:set SOME_KEY value   # encrypt; commit the file
pnpm env:get                  # decrypt and print
```

A new variable is also named in `turbo.json`'s `env` list, or Vercel's build
never sees it and a production build that requires it fails.

## Verifying

Each command proves something, and says what it does not reach.

```
pnpm check        # the merge gate: typecheck, format, unused code, the smoke
pnpm check:fast   # the same without the smoke, plus check:db; under a minute
pnpm check:db     # a fresh Postgres, migrated and seeded; the pooled-identity
                  # and brain suites as the app role. No Next, no vendors.
pnpm smoke        # the whole product on a fresh stack, every vendor faked
pnpm dev          # the stack for a browser; PORT=3999 pnpm dev picks the port
```

Every run owns its data under `.local`, so two at once and a run after a run
do not touch each other. The smoke and `check:db` reach routes and tables;
only a browser reaches the pill and the graph, and only a real key reaches
a vendor. What a reviewer still walks by hand is in
[REVIEW.md](REVIEW.md).
