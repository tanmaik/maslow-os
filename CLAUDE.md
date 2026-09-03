# Field guide

Settled decisions only. This file grows one entry at a time, as things are
actually decided — an empty section is honest, a guessed one is not.

## Quality

Code is as simple and elegant as it can be made, and every change is checked
adversarially against that — and against the experience of everyone it
serves: the customer, the developer, the founder, the audience. Maslow
Industries serves its stakeholders; the code is how.

## Stack

Node 24 to develop on, 22.18 as the floor since that is what a fresh cloud
agent box ships. pnpm. Monorepo under Turborepo. Next.js for the app. Vercel
for hosting. Neon for the managed database. Fly for managed machines.

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

Machines in development are plain processes in a scratch directory. No Docker:
nesting containers is unreliable inside cloud agents, and a machine that starts
without a daemon starts everywhere.

Every checkout is self-contained — its own database, its own ports picked free
at start, nothing shared with another checkout. Ten worktrees are ten
independent stacks. Migrations are named by timestamp so parallel work cannot
collide on a number.

## Config

Vercel's environment store holds configuration. Nothing in it is ever marked
Sensitive: values stay readable so they can be pulled, diffed and audited.

Local boots with no credentials at all. The agent working on the repo can read
and change configuration — that is what lets it help set things up.

## Tenancy

Everyone is in an org; a person alone is an org of one. Enterprise is the same
org with more people in it and the owner paying for all of them. Self-hosted
has exactly one. The org is the same object in every case.

One database, one set of tables. Every row belongs to an org and the database
enforces it — row-level security, not a `where` clause someone can forget.

Local and CI connect as the same restricted role production uses. Never a
superuser: RLS does not apply to a table's owner, so a privileged local
connection hides every isolation bug until production finds it.

The seed holds several orgs with obviously distinguishable data, so a leak looks
wrong on sight.

## Self-hosting

The same app with one org in it. Multi-tenancy is not switched off — that org
is simply the only one. Same tables, same migrations, same code.

Managed instances use credentials we supply; self-hosted ones bring their own.
Signing up differs the same way: the first person to arrive owns the instance,
everyone after is invited, and the org's own identity provider sits behind the
same contract. Not a second auth system.

**Every external dependency must answer: can a self-hoster supply their own?**
If not, the feature it powers is absent on self-hosted — off, never
half-working. A register lists every dependency with its self-hosted answer,
written when the vendor is added.

One object describes what a deployment can do — signup, billing, sizing,
sharing — and the interface reads it. Never a scattered "is this self-hosted"
check.

## Real and fake

Development runs against the real thing — real models, real machines, your own
keys — because a product nobody lives in does not get good. Tests run against
recorded traffic: fast, deterministic, no credentials, since CI has none.

The fake is a fallback, never a default. Credential present, real thing;
absent, fake — so a fresh checkout still gives a working app. A fallback in
development stays visible on screen for as long as it is active.

**In production there is no fallback.** A missing credential stops the app
from starting. Nothing degrades quietly, and no error is swallowed.

**"Download my data"** gives a person what is theirs — their rows, their
machine's files — with stored tokens stripped. Nobody's export holds anyone
else's slice, the org owner included. Importing is additive: each member's
file adds theirs, so an org is rebuilt one person at a time. The same pair is
how a customer moves to self-hosted. No production credential ever leaves
production; only files travel.

Local runs the managed profile with test-mode keys — Stripe test, dev model
keys, mail to the founders only — seeded from the founders' own exports. So
local is production, as us, with fake money. One config value runs the
self-hosted profile instead. Agents get the synthetic seed unless a human
hands them a file.

A preview is the same: a Neon branch off an empty parent — never off
production — migrated, loaded from exports, on preview keys. Its machines
are real, on a dev Fly account with a spend cap, made when first used and
destroyed with the pull request. Outside production a dev sign-in exists —
pick a seeded person, no email — visibly flagged like every fake and impossible
in production.

## The machine

Breakage is made cheap rather than prevented — a machine you cannot break is a
machine you cannot use. The agent gets root and full freedom because of three
layers:

- **The image** is only a bootstrap — enough to start and hand off. It almost
  never changes.
- **The volume** is the computer. It holds the whole operating system, copied
  there on first boot and switched to on every boot after. Installs, config,
  files: all of it persists, because it is a real machine. The daemon updates
  itself here, and security updates run here on a schedule. A volume lives on
  one physical host, so durability is not automatic: it is snapshotted to
  object storage on a schedule, and that snapshot is the backup. Volumes
  auto-extend at a threshold and cap at 500GB.
- **The memory snapshot** is what they were doing. Usually survives a suspend.

Every machine and volume on Fly is recorded in our database with the org and
person it belongs to, at creation, before it is used. A sweep reconciles Fly's
inventory against ours; anything Fly has that we do not is an incident.

Nobody chooses a size. One is chosen at wake from what they have needed before.
Outgrowing it is a cold boot at a new size — a memory image is exact to the
machine that made it — so it is made rare, and happens at a step boundary the
agent chooses, never mid-execution. Downloads never force it: disk grows live.

Machines suspend within minutes of going idle — nobody signed in, no agent
running, nobody reaching their files or the ports they serve — and wake on the
first sign of return, before anything needs them. A colleague opening a shared
file at 3am is a wake. The window is short because resume is cheap; it is not
zero because suspending writes memory to disk, and a tab closed and reopened
should not thrash. The exact number comes from the meter.

**Resume is usual, never guaranteed.** No platform promises a snapshot can be
restored. So the machine must be correct when it comes back cold. On any boot,
warm or cold, the daemon brings back everything that was up — agents, servers,
jobs — from its record of what was running, and agents continue from their
transcripts. Nothing the user started stays down. Fast resume is pure upside.

Suspend is only fast at 2GB and below. Sizing up trades resume speed for room,
and the user sees that trade.

Self-hosted machines are containers on hardware the org already runs. They share
the box's CPU and memory fluidly among everyone on it, pause with memory
resident, and can have limits raised live. They cannot grow past the box.
Weaker isolation than a VM — right among colleagues, wrong among strangers,
which is why managed uses VMs — so they take the strongest isolation the host
offers: rootless, one per user, nothing running as root on the host.

## Agents

The harness writes its transcript as it goes; that is not the agent's job.
Transcripts live on the volume, the conversation lives in the database, and
the interface reconnects to a session by id — never to a process. When a
machine restarted underneath one, it says so.

The interface is an ACP client. Its layout is taken directly from t3code and
the Beautiful UI harness, not reinvented.

## Metering and billing

Every unit of consumption is recorded from the first day — disk held, compute
run at a recorded size, tokens spent — whether or not anyone is charged yet.
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
with the pull request.

## Documentation

This is open source: the repo is the record, and there is no private version
to fall back on. Documentation describes what is true now. When the code
changes, the docs change in the same commit, or the docs are wrong.

Nothing is kept for history's sake — git holds the history. Dead code,
superseded docs, unused artifacts and the old half of a reversed decision are
deleted in the change that made them dead, never in a later cleanup that does
not come.

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
function confine(rel: string): string
```
