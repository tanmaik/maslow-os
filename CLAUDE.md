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
for the managed database. Fly for the computers, and Tigris, through Fly,
for object storage: one invoice.

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
at start, its own machines on Fly under a lease it renews, nothing shared
with another checkout. Ten worktrees are ten independent stacks. A migration is created with `pnpm migration:new <name>`,
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
on the development target — pulled, never injected. Nothing in it is marked
Sensitive — values stay readable so they can be pulled, diffed and audited —
except production's two database URLs. Those are Sensitive: the build and
the running app use them, and nobody reads the value back from Vercel.
That stops a look-up, not a deploy — whoever can ship code can still make
it print them — and either one opens every brain. A person who needs the
database goes through Neon, where the access is a deliberate act. A Vercel token is a full-account key: it lives only on the GitHub
`preview-db` environment, never with a person or an agent.

Local boots with no credentials at all. The agent working on the repo can read
and change configuration — that is what lets it help set things up.

One object describes what a deployment can do — sign-in, mail, storage, and
later billing, sizing and sharing — and the interface reads it, never the
environment. A register in `docs/dependencies.md` lists every vendor, written
when the vendor is added. Every vendor sits behind an interface of ours, so a
second supplier is a second implementation, never a second code path.

The per-PR workflow, the hourly reap and the sweep that follows every
production deploy hold six credentials — Neon's key, Vercel's token, the
second bucket's two keys, Fly's token and the sweep's secret — on a GitHub
environment only `main` can use. They run main's code; a pull request's
code never sees them. The check that runs a pull request's own code holds
one credential: a Fly token that reaches only the dev app, so the worst a
bad pull request can do is make dev machines, which the reap kills.

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
every change, numbered in the order changes commit, so something reading
past a number never misses one. The brain is a graph of a mind, not a copy of its sources:
nothing mirrors a mailbox or a calendar into it. Whatever writes into it — a
person today, an agent reading an app through a tool later — writes what it
concluded, with a confidence and an edge back to what it rests on. What it
rests on is a source record the writer chose to bring in: the app, the app's
own id, and as much of the original as it judged worth keeping, from a
citation to a copy. A question the brain cannot answer is answered outside
it, and the answer and what it rests on are written so the next time is a
read.

Types are the person's own vocabulary, open to them and their agent. A type
is a name and the fields it declares, nothing more: no description, since
the name is what a model needs. Every person's starts empty: whoever writes
the first record of a type defines it in the same call, a person included:
writing a record by hand, they may name a new type and say what it holds,
and a record of an undefined type is refused, never stored. Two people in one org may each
define a `note`, and they are two types. A type may declare its fields as
rows, never as columns: values stay in one JSON column and the doors check
and query them by the declaration. Nothing changes a table's shape after
deploy. A verb is the word on an edge and nothing else: not
defined, not described, not a row, not listed anywhere.

The brain is not a database for people to look at. A table holds only what
the product reads at runtime; who wrote a row and when is the log's to say,
and no table carries an author, a version or a definition's date. A change
made through any door is logged in the name of the transaction that made
it: the person, or the app connected as them.

Records, edges and the vocabulary are the person's. A record is owned by
whoever wrote it, always, and seen by nobody else until its owner shares it:
with a person, a group, or everyone in the org, at view, edit or owner. A
type is shared the same way, and a share on a type reaches every record of
it; a record shared alone brings its type into view with it. The owner stays
the owner: only they write records of their type or change what it declares.
The most any path gives a member is what they may do; there are no deny
rules. Everyone is every current member and is not a row. Editors change;
owners also share, remove and merge; everyone can only be given view. Org
owners manage groups, not content. The agent shares nothing: it asks, and
the ask names what, whom, at what level and why; the person accepts or
declines it on their brain's pages, and only accepting makes the shares,
in their name. The log says who gave a share, and what was asked. A reader sees everything they may see unless they narrow it: what is
shared with a person is as present to them and their agent as their own. What is shared into a brain is listed beside the person's own types,
grouped by whose it is and how it was opened: the whole type or some
records, to everyone or to them.

One read door and one write door, in `packages/brain`; nothing else touches
the tables. Writes are idempotent on a record's source and ref. Events are
written by the database and the app cannot write them. A merge hides the
loser behind a pointer to the winner and rewrites nothing, so it reverses.
A brain exports to a file that imports into any brain, as the importer.

The brain is an MCP server at `/mcp`, and the doors are its tools, answering
in lines, with the same answer as data beside them for a program that asks,
and saying whose brain it is when an app connects. An agent
gets in through OAuth on our own sign-in: the person approves it on our page,
and what it holds is a session, listed and ended from settings like any
other. Claude Code and claude.ai are the two clients it is checked against.

## Connections

A person's accounts in outside apps are held at Composio and nowhere else:
the Composio user is the membership, and a connection is seen by nobody else
in the org. A connection is one account, and a person may hold several in
one app, each with a name they gave it that Composio keeps; the agent's
`run` names which account it acts in, and an app with several refuses until
it does. Every app Composio reaches is one a person can connect; the
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
credentials: the smoke boots a fresh stack with every vendor key blanked,
and needs only the dev-app Fly token to make, check and destroy one real
machine.

The fake is a fallback, never a default. Credential present, real thing;
absent, fake — so a fresh checkout still gives a working app. A fallback in
development stays visible on screen for as long as it is active. The
computer has no fake: no Fly token, and computers are off, and the page
says so.

**In production there is no fallback.** A missing credential stops the app
from starting. Nothing degrades quietly, and no error is swallowed.

The hourly sweep — the meter, the orphans and the computers — runs from
the app when an hour has passed since the last, in every environment, from
a cron in production as the backstop, and the moment a production deploy
goes live, so a new image reaches every computer at once.

**"Download my data"** gives a person what is theirs, and today that is
their brain: an export that imports into any brain, as the importer. It is
a function in `packages/brain`, checked by the smoke, with no page on it
yet. Nobody's export holds anyone else's slice, the org owner included. Importing is
additive, so an org is rebuilt one person at a time. No production credential
ever leaves production; only files travel.

Local runs on the dev-tier keys in `.env.development` — WorkOS staging,
Resend to founders only, and the bucket — and the synthetic seed: three
orgs with obviously distinguishable data. Whatever is not there is faked,
and `pnpm dev` and the pill say which. A laptop's objects live under a
`dev/` prefix in the dev bucket — a bucket of its own, with keys of its
own, so nothing outside production holds production's — and the hourly
reap purges them: tomorrow makes new ones. A preview is the same: a Neon
branch off an empty parent — never off production — migrated and seeded on
deploy, on preview keys. The per-PR workflow is the only thing that builds
a preview: database first, then deploy, and both die with the pull request.
Outside production a dev sign-in exists — pick a seeded person, no email —
visibly flagged like every fake and impossible in production.

## The computer

A person's computer is three things in three places: the disk, a Fly
volume holding their files, their packages and their whole Linux, which
must never be lost; the machine, CPU and memory rented by the second, on
which nothing matters; and our image, the base Linux with our tools in it,
which the person cannot change because it is not on their disk. The
settled design is `docs/decisions/2026-09-07-the-computer-returns.md`,
built in its order, one pull request at a time.

It is per membership, claimed at sign-in in the person's region and made
as the page asks after it, and it never sleeps; the
page is blocked until it is ready. They are themselves on it, `wile@acme`:
the account is named after their first name, with a number after it
when Debian already has that name, and the machine after their
org at every boot, and files are owned by the number underneath, so a
rename touches nothing. Home is `/home/me`,
`sudo` needs no password, and `/opt/maslow` is ours and read-only. Reset
throws their Linux away and keeps home; it is a button, never automatic.
Sizes are a ladder of CPU and memory, shown without a price, and a
restart of a few seconds; nothing changes a computer's size but the
person; the disk grows
before it fills and never shows a cap. Where it is is one of sixteen
North American regions, guessed at sign-in from where the request came
and said on the page by name beside the one honest number, the round
trip the person's own browser measures to it; over forty milliseconds
the page says so and names the region nearest them. A move is a button
of the person's and nothing else's: the machine stops, its disk is
snapshotted, the snapshot is restored in the new region, a machine there
must answer its door, and only then do the old machine and disk go, the
snapshot kept a day; a step that fails puts them back where they were,
and the page is blocked for the minutes it takes. The Computer page is
plain first, ready, Open, the browser, the last backup, and then its
numbers, size, where, SSH and reset in the open. A port is the person's until they share it
with a person, a group or everyone in the org, and it opens or is a 404;
the agent asks for a port through the same share tool it asks for a
record with, and never shares one itself. The door is the one way in, and
ready means the door answers. Two sockets go straight from the person's
browser to it, each on a ticket from our sign-in and never through our
server: Talk, a terminal joined to a `tmux` session on the machine, a
plain shell with Claude Code the word `claude` away, so closing the tab
kills nothing and the next tab finds it mid-output; and View, the machine's browser as real
H.264 video decoded in the tab, its tabs, the person's hands and pointer
on it, the cursor the page wants under that pointer, and what
changed in a folder of their home, on one socket. Nothing durable lives in
a tab: the tab is a view onto state on the machine, and the machine's
browser never idles away. An address a program on the machine opens goes
to that browser, never the laptop. SSH is a third road in, carried over a
WebSocket through the same door with no ticket, opened by the public key
a person sets in settings, set up on a Mac by the one command the
Computer page shows, which installs the Python script the app serves as
ssh's ProxyCommand and writes a `Host` named after the computer, and
landing in the same tmux session the Terminal page shows, as a grouped
session of its own; a command given to `ssh` runs plain. Model calls never
route through us: each person holds an OpenRouter key we minted with a
cap, OpenRouter holds the record, and the sweep copies it; Claude Code
runs on it by default, on GLM 5.3 Flash, with the Claude models one
`/model` away; `model mine` in the computer's terminal switches it to
the person's own Anthropic account, which they sign in to from that
terminal, and `model ours` switches it back, so a person whose own plan
runs dry keeps working on ours; a deployment without our provisioning
key runs everyone on their own, and says so. Laptops, previews and
production all make real machines; there is no fake, and every machine
outside production carries a lease the reap enforces. Nothing on a machine
ever calls home. Claude Code is in the image and is `claude` on the
person's path, and an editor drives the same Claude Code over the Agent
Client Protocol through `claude-code-acp`, on the same account. It knows
two MCP servers out of the box, seeded into its
settings: the browser tool, `packages/browser`,
running on the machine as its own server outside the person's Linux but
as the person, with its profile on the disk and a page of its own,
`/browser`, where the person watches it live and takes it over with their
own clicks and keys, dragging to select and carrying the words out; and
the brain at this
deployment's `/mcp`, reached with a session of the owner's that our
server opens for the computer and the person can end in settings. The
brain's MCP is the brain and the connectors, and nothing of the machine:
no hand that runs a command or reads or writes a file goes into it.

## Interface

The canvas is the screen and the chrome floats over it: dark, warm, quiet,
one look with no light one. Home is a desk the size of the display that
never scrolls, and every surface of Maslow is a window on it, drawn in
the window with its controls in the window's bar, placed
anywhere, at any size the person drags it to, overlapping if they like,
coming to the front when touched; nothing lays windows out for them and
nothing resizes one because another changed. Windows open from a dock
along the bottom with one click, at the block's own size, as many times
as the person likes; the dock's pin keeps it in view or lets it hide so
the desk takes the whole page. Any window fills the screen with
one press and comes back. Desks are pages swiped between. A phone shows
one window at a time. Windows are plain: square, flat, a hairline
border, a title bar with its buttons, and nothing animates. You are the
last thing on the dock, and how much waits on you is a count on the
Brain. "Waiting on you" is what asks something of you and is
still there: the agent's asks, and later the pages teammates' agents put
in front of you; a shared record is knowledge, not a demand, and nothing
tracks whether you opened it. The settled designs are
`docs/decisions/2026-09-09-the-canvas-is-the-screen.md` and
`docs/decisions/2026-09-11-the-screen-is-a-desk.md`.

Every component is shadcn, and every shadcn component is installed under
`apps/web/components/ui`. Nothing is hand-rolled beside them: no bespoke
button, input, dialog or table, and no other component library. Styling is
Tailwind on shadcn's theme tokens. The typeface is Inter, and only Inter,
shipped from npm inside the bundle; nothing is fetched from anywhere at
build or at run.

A click shows the next page at once. Every link is `next/link`, so a click
swaps only what changed and the page it points at is fetched before the
click; a `loading.tsx` gives a page its shape while its rows are read. A
link the pointer reaches starts loading its whole page, and a page fetched ahead is
trusted for thirty seconds. The code runs in the database's own AWS region,
Ohio, so a round trip to it is under a millisecond and a person's own trip
is paid once a click; the database stays on and never sleeps.

## Metering and billing

There is no meter. Two rules stand in for it. Every resource we make
anywhere — a machine, a disk, an object, a key — carries the person's id,
the org's id and the environment in its name or tags, so any vendor's list
traces back in one look. And one table, the ledger, records every resource
event: when, whose, what, how much, at what cost, and why. It records what
happened to resources, never what is in files or conversations. Nothing
shows it to the person. Prices are set later from reading it, and vendor
bills are checked against it.

Billing is per org, and the org owner pays for everyone in it. Managed is pay
as you go through Stripe. **No resource that costs money exists without a
payment method behind it**: a sweep finds anything that does, and finding one
is an incident. Every resource has a ceiling before it ships; the ceiling is
ours, it never shows, and reaching it alerts us rather than walling the
person.

## Public site

Built to be read by agents as much as by people, and measured with
`npx is-agentic <domain>`. The score goes up, never down.

## Cleanup

Nothing is cleaned up; things fail to outlive their owner. A test's database
dies with the test, a checkout's data with the checkout, a preview's resources
with the pull request. A machine made outside production carries a lease:
renewed while its owner runs, stopped an hour after it lapses, destroyed a
day after, along with any disk an hour old that no machine holds. An hourly
reap, reading the vendor's list rather than ours, catches what a failed
close missed; what it takes from under a live row, the row forgets and
makes again.

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
where it can be, and a reader where it cannot: Codex, run as `codex exec
review` against the base branch, or a review agent of Claude's. What a
reviewer walks by hand is `REVIEW.md`.

- `check` is green: typecheck, format, unused code, the secrets check —
  the database URLs are named only where they are opened, and shipped code
  never handles the environment whole — and the smoke, which migrates an
  empty database and signs in as every seeded org.
- The preview built and its database migrated. Both are required checks, so a
  change that fails `next build` or a migration never reaches main.
- A reader read it: Codex or a review agent, on the whole diff against main,
  before the merge, and its findings are fixed or answered in the pull
  request. Since 2026-09-11; Macroscope, which did this before, ran out of
  credits and is off.
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
