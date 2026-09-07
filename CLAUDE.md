# Field guide

Settled decisions only. This file grows one entry at a time, as things are
actually decided — an empty section is honest, a guessed one is not.

## Quality

Code is as simple and elegant as it can be made, and every change is checked
adversarially against that — and against the experience of everyone it
serves: the customer, the developer, the founder, the audience. Maslow
Industries serves its stakeholders; the code is how.

## Talking to the founder

Speak plainly. No jargon, no acronym or vendor term without saying what it
is the first time, no phrase whose point is its cleverness. The person
reading is running the company, not the code: say what a change means for
the customer, the org and the brain before saying how it is built.

Teach as you go. When a term, a tool or a trade-off comes up, explain it
in a sentence right there, in the words of the product, so the reader
learns the system while the work happens rather than having to ask.

Finish with a recap that stands alone. At the end of every piece of work,
say in plain words what was done, what was found, what was checked and
how, what was left undone and why, and what happens next. A reader who
sees only that message has the whole picture.

## Stack

Node 24 to develop on, 22.18 as the floor: where importing `.ts` arrived.
pnpm. Monorepo under Turborepo. Next.js for the app. Vercel for hosting. Neon
for the managed database. Tigris, through Fly, for object storage.

## Local

The database runs beside the code: a real Postgres binary the repo fetches from
npm, not infrastructure the environment has to provide. A laptop, a cloud
agent's box and a CI runner all behave the same.

**Everything the repo needs arrives from the npm registry.** Cloud agent
sandboxes allow package registries and deny most other hosts, so a dependency
that downloads from anywhere else fails exactly where it is least visible.

Install scripts are off. A package earns a place in `pnpm-workspace.yaml`'s
allow-list only after its script has been read and found to do one small
thing.

No Docker: nesting containers is unreliable inside cloud agents, and what
starts without a daemon starts everywhere.

Every checkout is self-contained — its own database, its own ports picked free
at start, nothing shared with another checkout. Ten worktrees are ten
independent stacks. A migration is created with `pnpm migration:new <name>`,
which stamps the clock; the runner refuses two files with the same stamp, so
parallel work cannot collide on a name.

For database or Brain changes, `pnpm check:db` runs the pooled-identity and
Brain checks on a fresh, temporary Postgres without Next or vendor keys.
It is a fast iteration loop; `pnpm check` remains the full merge gate.

## Config

Every secret a checkout needs lives in the repo, in `.env.development`,
encrypted per value; one private key, never committed, decrypts it. A human
pulls it with their own Vercel login (`pnpm env:pull`); an agent is given it in
its environment's secret store. Either way `pnpm dev` finds it and says whether
vendors are real or faked. Adding or rotating a dev secret is a commit.

For an agent: the key is `DOTENV_PRIVATE_KEY_DEVELOPMENT`, set in your
environment by a human; if it is there, `pnpm dev` already uses it. Add a
secret with `pnpm env:set NAME value` and commit `.env.development`. Never
print a decrypted value, and never commit `.env.keys`.

Vercel's environment store holds preview and production, and the dev key alone
on the development target — pulled, never injected. Nothing in it is ever
marked Sensitive: values stay readable so they can be pulled, diffed and
audited. A Vercel token is a full-account key: it lives only on the GitHub
`preview-db` environment, never with a person or an agent.

Local boots with no credentials at all. The agent working on the repo can read
and change configuration — that is what lets it help set things up.

One object describes what a deployment can do — sign-in, mail, storage, and
later billing, sizing and sharing — and the interface reads it, never the
environment. A register in `docs/dependencies.md` lists every vendor, written
when the vendor is added. Every vendor sits behind an interface of ours, so a
second supplier is a second implementation, never a second code path.

CI holds exactly two credentials — a Neon key and a Vercel token — on a GitHub
environment only `main` can use. The per-PR database workflow runs main's code
with them; a pull request's code never sees them.

## Tenancy

Everyone is in an org; a person alone is an org of one. Enterprise is the same
org with more people in it and the owner paying for all of them. The org is
the same object in every case.

One database, one set of tables. Every row belongs to an org and the database
enforces it — row-level security, not a `where` clause someone can forget.
The few rows that exist before an org is known — a person, a throttle — are
shown one key at a time by a policy of their own, and the migrations table is
the runner's alone.

Local and CI connect as the same restricted role production uses. Never a
superuser: RLS does not apply to a table's owner, so a privileged local
connection hides every isolation bug until production finds it.

The seed holds several orgs with obviously distinguishable data, so a leak looks
wrong on sight.

Every org has one principal: the owner who pays for it and can do what no
other owner can — hand the org to another member, or delete it. The principal
stays until they hand over, so an org is never without one. Anyone else may
leave. Deleting an org takes its name typed exactly, and takes everything in
it with it.

A membership that ends is a past member: kept with everything it wrote, seen
by nobody, until an owner brings it back or purges it. One membership per
person per org, ever — brought back or invited back, they are the same member
with the same records; purged, the membership and all it wrote are gone, and
that is the owner's call to make.

Database roles are created with SQL, never through Neon's API: an API-made role
is a `neon_superuser` with `BYPASSRLS`, and every policy silently stops
applying to it.

## The brain

What a person knows lives in records, the links between them, and a log of
every change. The brain is a graph of a mind, not a copy of its sources:
nothing mirrors a mailbox or a calendar into it. Whatever writes into it — a
person today, an agent reading an app through a tool later — writes what it
concluded, with a confidence and an edge back to what it rests on. What it
rests on is a source record the writer chose to bring in: the app, the app's
own id, and as much of the original as it judged worth keeping, from a
citation to a copy. A question the brain cannot answer is answered outside
it, and the answer and what it rests on are written so the next time is a
read.

Kinds and verbs are the person's own vocabulary, open to them and their
agent, each with a description and an author. Every person's starts empty:
whoever writes the first record of a kind defines it, with a description, in
the same call, and a record of an undefined kind is refused, never stored.
Two people in one org may each define a `note`, and they are two kinds. A
kind may declare its fields as rows, never as columns: values stay in one
JSON column and the doors check and query them by the declaration. Nothing
changes a table's shape after deploy.

Records, edges and the vocabulary are the person's. A record is owned by
whoever wrote it, always, and seen by nobody else until its owner shares it:
with a person, a group, or everyone in the org, at view, edit or owner. A
kind is shared the same way, and a share on a kind reaches every record of
it; a record shared alone brings its kind into view with it. The owner stays
the owner: only they write records of their kind or change what it declares.
The most any path gives a member is what they may do; there are no deny
rules. Everyone is every current member and is not a row. Editors change;
owners also share, remove and merge; everyone can only be given view. Org
owners manage groups, not content. A share records who gave it, person or
agent. What is shared into a brain is listed beside the person's own kinds,
grouped by whose it is and how it was opened: the whole kind or some
records, to everyone or to them.

One read door and one write door, in `packages/brain`; nothing else touches
the tables. Writes are idempotent on a record's source and ref. Events are
written by the database and the app cannot write them. A merge hides the
loser behind a pointer to the winner and rewrites nothing, so it reverses.
A brain exports to a file that imports into any brain, as the importer.

The brain is an MCP server at `/mcp`, and the doors are its tools, answering
in lines and saying whose brain it is when an app connects. An agent
gets in through OAuth on our own sign-in: the person approves it on our page,
and what it holds is a session, listed and ended from settings like any
other. Claude Code and claude.ai are the two clients it is checked against.

## Connections

A person's accounts in outside apps are held at Composio and nowhere else:
the Composio user is the membership, and a connection is seen by nobody else
in the org. Every app Composio reaches is one a person can connect; the
product names none. The page asks Composio what is connected each time it is
shown, and says so when Composio does not answer. In production a finished
sign-in activates only once we have vouched for who did it. Access to a person's apps
ends with their membership: a membership that ends or an org that is deleted
owes its accounts to Composio in the same transaction. Composio's managed
OAuth
apps sign people in until a customer needs our name on the consent screen.
The agent reaches those apps through three MCP tools, apps, find and run,
never a tool per action.

## Real and fake

Development runs against the real thing — real vendors, your own keys —
because a product nobody lives in does not get good. Tests run with no
credentials: the smoke boots a fresh stack with every vendor key blanked, so
CI needs none.

The fake is a fallback, never a default. Credential present, real thing;
absent, fake — so a fresh checkout still gives a working app. A fallback in
development stays visible on screen for as long as it is active.

**In production there is no fallback.** A missing credential stops the app
from starting. Nothing degrades quietly, and no error is swallowed.

The hourly sweep — the meter and the orphans — runs from the app when an
hour has passed since the last, in every environment, and from a cron in
production as the backstop.

**"Download my data"** gives a person what is theirs, and today that is
their brain: an export that imports into any brain, as the importer. Nobody's
export holds anyone else's slice, the org owner included. Importing is
additive, so an org is rebuilt one person at a time. No production credential
ever leaves production; only files travel.

Local runs on the dev-tier keys in `.env.development` — WorkOS staging,
Resend to founders only, and the bucket — and the synthetic seed: three
orgs with obviously distinguishable data. Whatever is not there is faked,
and `pnpm dev` and the pill say which. A laptop's objects live under a
`dev/` prefix in the dev bucket — a bucket of its own, with keys of its
own, so nothing outside production holds production's — and the nightly
reap purges them: tomorrow makes new ones. A preview is the same: a Neon
branch off an empty parent — never off production — migrated and seeded on
deploy, on preview keys. The per-PR workflow is the only thing that builds
a preview: database first, then deploy, and both die with the pull request.
Outside production a dev sign-in exists — pick a seeded person, no email —
visibly flagged like every fake and impossible in production.

## The computer

There is none today. What was here — a Fly machine with a volume per
person, its daemon, uploads staged through the bucket, daily backups,
Claude Code on it behind a model gateway — came out on 2026-09-07, with
every table and page it had. It comes back deliberately, as SSH and SFTP
to a machine that spins up and down and sizes itself, and not before. The
keys it used stay in the environment stores, unread.

## Interface

Every component is shadcn, and every shadcn component is installed under
`apps/web/components/ui`. Nothing is hand-rolled beside them: no bespoke
button, input, dialog or table, and no other component library. Styling is
Tailwind on shadcn's theme tokens. The typeface is the system one; no font is
fetched from anywhere.

## Metering and billing

Every unit of consumption is recorded from the first day — bytes held in
the bucket and the brain, vectors made, actions run — whether or not anyone
is charged yet, and whether or not anyone reads it yet: nothing shows it.
Measurement and price stay separate, so prices are set later from real usage.
Every metered figure is reconciled against the vendor's own bill.

Each event carries its cause: a share someone else read, an agent running
unattended, an app a colleague opened. A bill is a list of reasons, not a
number.

Billing is per org, and the org owner pays for everyone in it. Managed is pay
as you go through Stripe. **No resource that costs money exists without a
payment method behind it**: a sweep finds anything that does, and finding one
is an incident. Everything metered has an abuse limit before it ships.

## Public site

Built to be read by agents as much as by people, and measured with
`npx is-agentic <domain>`. The score goes up, never down.

## Cleanup

Nothing is cleaned up; things fail to outlive their owner. A test's database
dies with the test, a checkout's data with the checkout, a preview's resources
with the pull request. A nightly sweep catches what a failed close missed.

## Documentation

This is open source: the repo is the record, and there is no private version
to fall back on. Documentation describes what is true now. When the code
changes, the docs change in the same commit, or the docs are wrong.

Nothing is kept for history's sake — git holds the history. Dead code,
superseded docs, unused artifacts and the old half of a reversed decision are
deleted in the change that made them dead, never in a later cleanup that does
not come.

## Merging

A pull request merges when nothing lingers behind it. The gate is mechanical
where it can be, and Macroscope where it cannot. What a reviewer walks by
hand is `REVIEW.md`.

- `check` is green: typecheck, format, unused code, and the smoke, which
  migrates an empty database and signs in as every seeded org.
- The preview built and its database migrated. Both are required checks, so a
  change that fails `next build` or a migration never reaches main.
- Macroscope read it. A finding is fixed or answered in its thread, and every
  thread is resolved before merge.
- Every environment is answered: it works locally with no credentials, on the
  preview, and in production. A vendor it adds is in `docs/dependencies.md`
  in the same commit.
- A migration is a new file from `pnpm migration:new`. Docs changed with the
  code. Nothing in it points at a later pull request to finish it.
- The title says what changed for the person using the product, in one
  plain sentence. The description says what changed, why, what to check,
  and what it does not do, each as a short list of facts. No cleverness,
  no story, nothing a reader has to decode.
- Squash-merged onto a linear main. The branch and its preview die with it.

## Comments

A comment states the purpose of the unit it sits on, in the vocabulary of the
domain. That is the whole job.

Not in a comment: why the approach was chosen, what was tried first, what broke
and when, how this file relates to four others, or any residue of the
conversation that produced the code. Decisions live in `docs/decisions/`, one
file per decision, dated.

If the comment is longer than the function, one of them is wrong.

```ts
// Rejects paths that escape the user's root.
function confine(rel: string): string;
```
