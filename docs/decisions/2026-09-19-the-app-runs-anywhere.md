# 2026-09-19 — the app runs anywhere

The website runs as an ordinary server in a container as well as on
Vercel, so a customer can run Maslow in a cloud account of their own.
the customer is the first: Maslow inside their AWS account. Self-hosting was
deferred on 2026-09-04 until the managed product was good; a paying
customer who needs it is the reason it no longer waits. On Vercel nothing
changes.

## What it is

- **One image.** `apps/web/Dockerfile`, built from the repo's root, holds
  the app as Next's standalone server and the files it reads, and the
  database package with its driver. It is built with no secret in reach:
  `IMAGE_BUILD=1` tells the build not to ask for what production needs,
  and the container asks for all of it as it starts. Vercel never sets it,
  so a Vercel build still fails on a missing secret as it always has.
- **Migrations as it starts.** The container runs `scripts/migrate.mjs`
  before it serves anyone, on `DATABASE_OWNER_URL`; the runner's lock makes
  several starting at once safe. Production anywhere requires the owner
  URL, and only a deployment that is not production is seeded, so a
  production outside Vercel never gets the seeded people.
- **Off on purpose, in writing.** `SERVICES_OFF` names the services a
  deployment goes without: `analytics`, `speech` and `computers`, and
  nothing else. Production starts without a service named there and says
  so; one missing and not named still stops it, as before. Naming anything
  else stops it too: sign-in, storage, mail, the relay and the sweep are
  never off.
- **Its own address and version, named.** Outside Vercel the deployment's
  address is `APP_URL`, which computers reach the brain at and the relay
  calls back to, and its version is `APP_VERSION`.
- **The image carries only what the server reads.** Files uploaded to a
  directory, which only a laptop does, are left out of what the build
  traces, so the image does not carry the whole repository.

## What it is not

- Not anything in AWS: no network, database, front door or installer.
  Those are the installer's, written in Terraform, next.
- Not the customer's own sign-in, which comes with Microsoft Entra.
- Not the hourly sweep's schedule outside Vercel; until the installer
  gives it one, the sweep runs as the page is visited.
- Not a second code path. Everything outside Vercel is the same code
  reading different settings.
