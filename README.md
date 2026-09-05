# placeholder

```
pnpm install
pnpm dev
```

That is the whole setup: a Postgres of your own, migrated and seeded, and the
app on a free port. `pnpm check` is the merge gate — typecheck, format, and a
smoke that boots a fresh stack and walks it. A migration starts with
`pnpm migration:new <name>`. Read [CLAUDE.md](CLAUDE.md) before changing
anything.

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

Uploaded images live in an S3-compatible bucket named by `STORAGE_ENDPOINT`,
`STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY` and
`STORAGE_SECRET_KEY`. Without them a checkout uses a directory and a preview
refuses uploads.

Analytics, replay and error tracking go to PostHog when `POSTHOG_KEY` is
set: every page seen, click, error and replay, as whoever is signed in,
tagged local, preview or production. One PostHog project serves all three,
and its filter counts only production. Without the key nothing is reported
and the pill says so.

Production refuses to start without WorkOS, mail, storage, or analytics.

## Dev secrets

`.env.development` holds the WorkOS pair, encrypted, in the repo. One private
key decrypts it. On a laptop, being on the Vercel team is the access:

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
