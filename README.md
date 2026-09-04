# placeholder

```
pnpm install
pnpm dev
```

That is the whole setup: a Postgres of your own, migrated and seeded, and the
app on a free port. Every pull request gets its own database and preview
with nothing to set up. Read [CLAUDE.md](CLAUDE.md) before changing anything.

Sign-in is the development fallback until an identity provider is configured:
pick a seeded person, flagged on screen. With the dev-secrets key (below),
`pnpm dev` signs in for real: enter an email, get a six-digit code from WorkOS,
enter it. Previews carry the same values, production carries WorkOS
Production's. Nothing is registered per host, so every checkout and every pull
request works with the same two:

```
WORKOS_CLIENT_ID=client_...   # the WorkOS environment's client ID
WORKOS_API_KEY=sk_...
```

Mail goes through Resend when `RESEND_API_KEY` and `MAIL_FROM` are set: the
sign-in code, and invitations. Without them, locally and on previews, the code
is printed to the server's terminal and the page says so. Production refuses
to start without an identity provider, or with WorkOS and no mail.

## Dev secrets

Everything a checkout needs is in `.env.development`, encrypted, in the repo.
One private key decrypts it. On a laptop, being on the Vercel team is the
access:

```
vercel login && pnpm env:pull      # once per checkout; writes .env.keys
```

An agent gets the same key from its environment's secret store, as
`DOTENV_PRIVATE_KEY_DEVELOPMENT`. With it, `pnpm dev` uses real vendors and
says so; without it, vendors are faked and it says that instead.

```
pnpm env:set SOME_KEY value   # encrypt; commit the file
pnpm env:get                  # decrypt and print
```
