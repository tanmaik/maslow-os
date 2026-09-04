# 2026-09-03 — roles, the org setting, and preview passwords

Three things found by testing against the real database, and what was decided.

## Database roles are created with SQL, never through Neon's API

A role made through Neon's API is a member of `neon_superuser`, which carries
`BYPASSRLS`. Every row-level policy silently stops applying to it. The `app`
role was made that way first and saw every org's rows with no org set. It is
now `create role app login` as plain SQL, which defaults to `NOBYPASSRLS`, and
the owner role is not permitted to grant otherwise.

## An empty org setting means no org

Policies read `current_setting('app.org_id', true)`. On a connection that has
never seen the setting it is missing and the call returns NULL. On any reused
connection — a pool, or the same client after one transaction — the setting
exists with the value `''` once a transaction has set it locally, and
`''::uuid` is an error. Migration `20260903_000001` wraps it in `nullif(…, '')`.
Empty means no org, and no org sees nothing. The migration's own comment blames
the pooler; the behaviour is plain Postgres on any reused session.

## A preview's database password is derived, not stored

A Vercel deployment captures its environment when the build starts. Rotating
the `app` password on every push replaced the password a build had already
captured, and every second push shipped a preview that could not connect.
Setting it once and tracking whether the rows matched turned out to need state
nobody can read back: Vercel never returns an encrypted value. So the password
is a function of the Neon branch — an HMAC of its id under the project's API
key — and every run sets the role and the rows to the same value and deploys.
Nothing is remembered, nothing rotates, and a retry after any failure
converges.

Two consequences, accepted. Rotating the Neon key changes every derived
password; each open pull request converges on its next event, and the
workflow can be re-run for any that need it sooner. And the deploy marker
(`build.env.PREVIEW_DB`) is not in Vercel's published schema for creating a
deployment — it was verified live: a marked deployment built, unmarked ones
were skipped. If Vercel drops it, previews stop loudly; the fallback is to
gate the ignore command on `DATABASE_OWNER_URL` and accept a second automatic
build per push.
