# placeholder

```
pnpm install
pnpm dev
```

That is the whole setup: a Postgres of your own, migrated and seeded, and the
app on a free port. Every pull request gets its own database and preview
with nothing to set up. Read [CLAUDE.md](CLAUDE.md) before changing anything.

## Dev secrets

Everything a checkout needs is in `.env.development`, encrypted, in the repo.
One private key decrypts it: get it from a teammate and put it in `.env.keys`
at the repo root (ignored), or set `DOTENV_PRIVATE_KEY_DEVELOPMENT` in a cloud
environment's settings. With it, `pnpm dev` uses real vendors and says so;
without it, vendors are faked and it says that instead.

```
pnpm env:set SOME_KEY value   # encrypt; commit the file
pnpm env:get                  # decrypt and print
```
