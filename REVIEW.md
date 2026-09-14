# Review

What a reviewer walks by hand before a pull request merges. `pnpm check`
catches what a machine can — types, format, unused code, the smoke — and
this is the rest. Each line is a question with a yes or no answer; a no is a
finding, fixed or answered in its thread before merge.

## Never

Lines that are not crossed. A pull request that crosses one is not merged
however good the rest is.

- **No credential is committed in the clear.** A dev secret goes through
  `pnpm env:set` into `.env.development`; `.env.keys` is never committed;
  nothing decrypted is printed in a log, a test or a message.
- **No superuser connection from the app.** Local, CI, preview and production
  all connect as the restricted `app` role, and a database role is created
  with SQL, never through Neon's API.
- **No query without a scope.** Every read and write goes through `asOrg`,
  `asPerson`, `asSelf`, `asEmail`, `asSignIn`, `asMeter` or `asThrottle`; a table without row-level security, or a policy loosened to
  make a query work, is a finding.
- **No fallback in production.** A missing credential stops the app from
  starting, in `apps/web/lib/deployment.ts`; nothing degrades quietly, and no
  error is swallowed into a log and forgotten.
- **No resource that costs money without a row.** An object is recorded
  with its org and person before it is used, and a removal writes what it
  owes to `orphans` in the same transaction.
- **No table's shape changes after deploy.** A migration is a new file from
  `pnpm migration:new`; one that was applied is never edited.
- **No primitive beside shadcn.** Every button, input, dialog and table is
  from `apps/web/components/ui`, and the screens are composed of them; no
  other component library, no hand-rolled primitive, no font fetched from
  anywhere.
- **No preview off production.** A preview's database is a Neon branch off
  the empty parent; its bucket and keys are the dev tier's, never
  production's.

## Always

What every pull request is checked for.

### It reads plainly

- The title is one sentence a person who does not know the code understands
  on sight, saying what changed for them: "Uploads over 2 MB are shrunk
  instead of refused", not "feat(storage): image pipeline".
- The description is four short lists: what changed, why, what to check
  where, and what it does not do. Every line is a fact; none is a story.
- Nothing has to be decoded: no metaphor, no pun, no phrase whose point is
  its cleverness. Numbers, file names and commands are in the description,
  never in the title.
- A reviewer can tell from the description alone which environments the
  change touches and what to click to see it.

### Nothing lingers

- Every export is used, every dependency imported, every file reached:
  `pnpm unused` says so, and a new entry in `knip.jsonc` is a finding
  unless it names a real entry point.
- Dead code, superseded docs and the old half of a reversed decision are
  deleted in this pull request, not left for a later one.
- Nothing in it points at a later pull request to finish it: no TODO, no
  "for now", no feature flag guarding half a change.
- A vendor it adds is in `docs/dependencies.md` in the same commit, behind
  an interface of ours, with a fake for a checkout without its key.
- A decision it makes is in `docs/decisions/`, dated; the code carries the
  purpose in comments and nothing else.

### Every environment is answered

- **Local, no credentials.** `pnpm dev` on a fresh checkout still gives a
  working app, every vendor faked and the pill saying so. The smoke runs
  with every key blanked; a change that needs a key to pass is wrong.
- **Local, with credentials.** With the dev key, the same change runs
  against the real vendor, named for the checkout and reaped nightly.
- **Preview.** The preview built and its database migrated and seeded; the
  per-PR workflow needs no new secret. A value read from the environment is
  listed in `turbo.json` so the build sees it, and set on Vercel's preview
  target if a preview needs it.
- **Production.** Every new value is set on Vercel's production target
  before merge, and `deployment.ts` refuses to start without it. A change
  that runs a cron says how production's is scheduled.

### The data holds

- The seed's three orgs still look obviously different from each other, so a
  leak looks wrong on sight; the smoke signs in as each and sees only its own.
- A membership that ends keeps what it wrote and is seen by nobody; a purge
  is the owner's call and takes everything.
- A merge in the brain hides, never rewrites; an export imports into any
  brain as the importer, holding nobody else's slice.
- A write that could arrive twice is idempotent: files on their key, brain
  records on source and ref, migrations on their checksum.
- A save of a record's title or body names the change it rests on, and one
  that fell behind is refused, never written over what landed since.

### It fails well

- Whatever the vendor answers — a 500, a timeout, nothing — the page says
  so in a sentence and nothing is left half done; the next call converges.
- Two requests at once make one thing: a lease, a claim or a unique index
  is what says so, never a check followed by a write.
- What a browser or an app sends is checked before it is trusted: a name,
  a size, an id, a signature.
- A test that failed once and passed on retry is a race in the code, not in
  the test; the fix is in the code.

## Watch for

What has gone wrong before, in the code and in how it was made, and is
easy to miss.

In the code:

- A helper copied into a second file instead of shared: the S3 signer, the
  bucket purge. One implementation, imported.
- A value the app reads from `process.env` outside `deployment.ts`, or a
  fallback that hides its absence.
- A name the bucket sees that does not carry the checkout or the pull
  request, so the reap cannot find it.
- A test that shares a directory with `pnpm dev` or with its own last run:
  the smoke's database and store live under `.local/smoke` and are wiped
  at start.
- A comment that explains history: why this was chosen, what was tried,
  what broke. It goes to `docs/decisions/` or nowhere.
- A shadcn component edited by hand rather than reinstalled.
- An `onlyBuiltDependencies` entry added without reading the script.
- A `vercel.json`, workflow or `turbo.json` change tested only locally.
- A merge conflict resolved by a script: `preview-db.mjs`, `CLAUDE.md` and
  `docs/dependencies.md` have each shipped a half-resolved conflict. Read
  the resolved file whole.

In how it was made, for an agent as much as a person:

- **Merging without being told to.** A pull request is merged when its
  author says merge, not when its checks are green. Two were merged on a
  guess and had to be explained after the fact.
- **Building what was not asked for.** A change that reaches past its
  request — a second feature, a refactor of the file next door, a
  decision not yet made — is split out or dropped, however good.
- **A vendor set up two ways.** Sign-in codes once came from WorkOS on one
  deployment and Resend on another; two Vercel values were once marked
  Sensitive, against the field guide. Every environment takes the same
  path through `deployment.ts`, and a value on Vercel stays readable.
- **A dev resource destroyed by hand.** The preview bucket was once deleted
  in the course of "cleaning up". Nothing outside `.local` is removed by a
  command typed in a session; the reap and the teardown script are the only
  hands.
- **A red main.** The last push to main failed its own check on a race in
  the daemon. A check that fails once is fixed before the next merge, not
  retried until green.
- **An answer nobody could follow.** Several sessions stalled on "what is
  going on" and "tell me exactly what we have added". A change is
  explained in the words of the product — the person, the org, the
  brain — in a paragraph, before any of its parts.
