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
pnpm. Monorepo under Turborepo. Next.js for the app. Vercel for hosting, and
for a customer who runs Maslow in a cloud of their own, one container image
of the same app, `apps/web/Dockerfile`, which migrates as it starts
(`docs/decisions/2026-09-19-the-app-runs-anywhere.md`). Neon
for the managed database. Fly for the computers, and Tigris, through Fly,
for object storage: one invoice. A customer who hosts Maslow builds it in their own
AWS account from the Terraform template in `infra/aws/`
(`docs/decisions/2026-09-19-the-installer-is-terraform.md`).

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
with another checkout. Ten worktrees are ten independent stacks. A
checkout on a Maslow computer is reached at that computer's own address,
port first, on whichever computers' domain reaches the machine; `pnpm dev`
prints it as `computer`, and it is the one outside origin the dev server
serves its assets to, so no other computer's page is trusted. A migration is created with `pnpm migration:new <name>`,
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

The per-PR workflow and the hourly reap hold five credentials — Neon's
key, Vercel's token, the second bucket's two keys and Fly's token — on a
GitHub environment only `main` can use. They run main's code; a pull request's
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
concluded, with an edge back to what it rests on and, where its type
declares one, how sure. What it
rests on is a source record the writer chose to bring in: the app, the app's
own id, and as much of the original as it judged worth keeping, from a
citation to a copy. A question the brain cannot answer is answered outside
it, and the answer and what it rests on are written so the next time is a
read.

The brain's pages are read far more often than written, since most of what
is in them the agent put there. The records page is a rail of the person's
types beside the records themselves: each type carries how many records it
holds, the one open is filled and nothing else in the rail is coloured,
the types a colleague shared fold under
that person's name, and a brain of many types is narrowed by typing one.
The records are rows of a title and the first line of what they say, cut
either into their types or into the days they were last modified, since
the one time every record carries and is ordered by is its last change,
as a note's is in a notes app, and marked with
whose they are where they are not the reader's; the one picked reads
beside the list, as a note does in a notes app, the arrow keys walk to
the next, a window too narrow for both shows one at a time, and a mark
on the record or a double-click on its row opens it as a page of its
own, whose way back is the list it came from with it still open. A record is a document: its
body takes its shape as it is typed, a slash offers what a line can become,
and markdown is what is stored, so an agent writes and a person writes the
same text. The editor is Tiptap, which is not a component and has no shadcn
equivalent, as CodeMirror is not for the Files editor. A save names the
last change of the record it saw, and one that fell behind is refused,
never written over what landed since: the page shows the newer version
and the person keeps theirs or takes it. The page watches the log and
refreshes as the record changes elsewhere, so an agent's rewrite is on
screen within seconds. While anyone has a record open, its body is one
live document in a relay of ours, `packages/sync`, that every editor of
it is joined to over a socket on a ticket the app signs: keystrokes
merge as they happen, each person's caret carries their name, a row
above the words says who else is in it, a reader with view watches it
move, and the relay saves through the app's own door,
after a second of quiet and before a different person's typing lands,
so every save is one person's and in their name. The relay holds no
table and runs the page's own editor headless, so what it saves is what
the page would; markdown stays the one truth, and the live document is
forgotten when the last person leaves. A rewrite from elsewhere replaces
the live text within seconds; a viewer's socket is read-only, and a
share that ends puts its person out within the minute. A socket that
closes ends the page's copy too, and the page opens anew rather than
carry a copy the relay would merge in twice. A relay that cannot be
reached, or a body the editor cannot hold, shows "Not live" and the page
saves as it does alone; the title always saves that way. On Vercel the
relay is one small Fly machine per environment that the hourly sweep
makes, keeps on the current image and keeps running; previews share one,
which carries a lease every preview's sweep renews, so it lives while
previews live and the reap takes it after; production's carries none.
Production refuses to start without the relay's secret.

One list is looked at four ways, and which way is the person's to pick: the
rows themselves; a table with a column for every field the type declares,
sorted by any of them and dragged as wide as they like; a board of the
values of one choice field, with a card carried from column to column to
change it; and a month with the records on the days they were last
modified, or on a date field of the type's. All four
narrow the same way, in one row under the switch: a condition on any
declared field or on when, as many as they want, each a chip they can take
off, and a sort. Nothing narrows in the page — the read door takes the
conditions, checks each against the field's own declaration, and answers a
page at a time. The view, its conditions, its sort and its column widths
are all in the address, so a view is a link; they are also kept per person
per list, in a table of the person's own, so the next visit opens where the
last one ended.

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

The agent also says things to the person and asks them things, through the
same door: `notify` leaves a note and `ask` a question, each a notification of
the person's alone, in the name of whatever wrote it, with the records it
is about and, for an ask, the options the person may pick; `notifications` reads
them back with the answers. Nothing waits for an answer — the ask is left
and the answer read later. An ask to share is one of them, so what waits on
a person waits in one place. The same two words are on the person's
computer, `notify` and `ask`, which speak to the brain the machine is
already connected to.

## Connections

A person's accounts in outside apps are held at Composio and nowhere else:
the Composio user is the membership, and a connection is seen by nobody else
in the org. A connection is one account, and a person may hold several in
one app, each with a name they gave it that Composio keeps; the agent's
`run` names which account it acts in, and an app with several refuses until
it does. Every app Composio reaches is one a person can connect; the
product names none. The page asks Composio what is connected each time it is
shown, and says so when Composio does not answer. Connecting takes the whole
tab to the app's sign-in, since a sign-in page refuses to be shown in a
frame, and the way back lands on Settings, open on what came of it. In production a finished
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
computers among them, so nothing it does costs money. That a computer
works is its own check, `node scripts/check-computer.mjs`, which makes one
on whichever cloud the environment names, waits for its door, restarts it
and takes it away; it costs money and is run deliberately.

The fake is a fallback, never a default. Credential present, real thing;
absent, fake — so a fresh checkout still gives a working app. A fallback in
development stays visible on screen for as long as it is active. The
computer has no fake: no Fly token, and computers are off, and the page
says so.

**In production there is no fallback.** A missing credential stops the app
from starting. Nothing degrades quietly, and no error is swallowed. A
deployment goes without a service only by naming it in `SERVICES_OFF`, and
only analytics, speech and computers may be named; the app says what is off
as it starts. Outside Vercel its own address is `APP_URL`.

The hourly sweep — the meter, the orphans and the computers — runs from
the app when an hour has passed since the last, in every environment, from
a cron in production as the backstop. Nothing runs on a deploy: a new
image is noticed by the page asking after an update every few minutes.

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
built in its order, one pull request at a time. What the app asks of
the cloud a computer runs in is one interface of ours, in our own words,
each cloud a file under `apps/web/lib/clouds/` that implements it, Fly
for the managed product and AWS for a customer who hosts Maslow, and
images called by their label; `pnpm check` refuses
an import of a cloud anywhere but the one line that picks it. That
decision is
`docs/decisions/2026-09-18-computers-behind-one-interface.md`.

It is per membership, claimed at sign-in in the person's region and made
as the page asks after it, and it never sleeps; while it is being made,
restarting or moving, the whole computer is off: the screen is covered
under one card that says what it is doing, so nothing on it is ever seen
waiting or reconnecting, and what is open is opened afresh under the card
before it lifts. A restart puts the
terminal back and nothing else: the door writes down every half minute
each window's folder, name and the command running in it, and at the
first boot after, puts the windows back in their folders and types each
command back in so it runs in view, a `claude` continued; the door says
ready only once that is done. A server that ran outside a window stays
down, since what listens after a restart is what the person's windows
started; what a process held in memory is what a restart costs. They are themselves on it, `wile@acme`:
the account is named after their first name, with a number after it
when Debian already has that name, and the machine after their
org at every boot, and files are owned by the number underneath, so a
rename touches nothing. Home is `/home/me`,
`sudo` needs no password, and `/opt/maslow` is ours and read-only. Reset
throws their Linux away and keeps home; it is a button, never automatic,
and the backups are there to restore from afterwards. A new image is an
update, not a restart: the page asks after one every few minutes, the app
looks at the machine and writes on the person's row that one is ready and
to which image, and says so quietly in two places — a notification,
counted among what waits on the person and standing until they take it,
a newer image taking the place of an older; and a row on the Computer
pane. Each has one button, Update, which names what it will stop before
it stops it. Nothing takes an update on its own, and none of it is on the
machine.
Every computer is at least one size, four shared CPUs and eight
gigabytes, since memory is what people run out of and the CPUs sit idle:
the door, the browser and one Claude Code take a gigabyte and a half
before the person has done anything, and an app they build one or two. That is a floor and not a start: a row under it is
lifted to it at the next sweep, and no machine is ever shaped below it.
One given more by hand on Fly keeps it: the row learns the machine's size
at the next sweep, and nothing remade is made smaller than it is. Every
machine carries two gigabytes of swap, so one that outgrows its memory
slows rather than losing what it ran. The sweep writes on the row what
memory is in use and the most seen at this size, so the floor moves on
what people use; a machine over four fifths at two sweeps running is
said to us, never walled; and the door weighs a fresh boot the moment it
is ready, before anything of the person's comes back, and the sweep says
so to us when the image itself is over two gigabytes. The disk grows before it
fills and never shows a cap. Where it is is one of the
North American regions Fly still makes disks in, seven today, since Fly
retires regions now and then and a retired one refuses a new disk;
it is guessed at sign-in from where the request came
and said on the page by name beside three live numbers, each timed again
and again while the pane is open and named for what rides on it: the
round trip the person's own browser measures to their computer, which a
keystroke in the terminal pays; the one it measures to Maslow, which a
click pays; and the one Maslow measures to the computer, which Files and
the desktop's ports pay on top. Over forty milliseconds to the computer
the page says so and names the region nearest them. A move is a button
of the person's and nothing else's: the machine stops, its disk is
snapshotted, the snapshot is restored in the new region, a machine there
must answer its door, and only then do the old machine and disk go, the
snapshot kept a day; a step that fails puts them back where they were,
and the page is blocked for the minutes it takes. The computer is a
pane of Settings, plain first, ready, the update if one waits, the last
backup with the fourteen kept listed under it, each restoring into a
dated folder of its own in the home and over nothing, and then its
numbers, size, where and reset in the open. A port is the person's until they share it
with a person, a group or everyone in the org, and it opens or is a 404;
or they make it public, and it opens to anyone on the internet with the
address, a page or an API alike, no sign-in, no cookie and no redirect,
given to nobody, so it is not listed among what colleagues were shared,
the door letting it through and whatever runs on it
checking who is calling and keeping its own limits, which is how an API
or a site of the person's own is hosted; the agent asks for a port, the
public included, through the same share tool it asks for a record with,
and never shares one itself. A file or a folder in their
home is shared the same way, at view or edit, from a right-click in
Files or through that share tool, and it is the one thing on the machine
that carries a mark: an extended attribute holding the id the share is
by, kept by the door with the path it sits at, so a move or a rename
keeps the share and the link, a copy behaves as an unshared file, a file
remade in its place by a program's save is the same file, since the door
watches the folder it stands in, and one gone from its place for longer
than a moment and found nowhere else is deleted, its share ending the
moment anyone next looks. A right-click on a row in Files renames it or
moves it to the Trash, a right-click on the space between rows makes a
folder, and deleting is always moving to the Trash of their Linux, never
erasing.
What is shared with a person stands in their Files under the sharer's
name, opens in the preview as their own would, and has a link on
our domain by its id that opens for whoever is allowed and is a 404 for
anyone else. A colleague reads it from the owner's machine while that is
up and from a copy in the bucket while it is not; the app keeps the copy
current from the machine, on the share, after every save a colleague
makes, whenever a read finds it behind, and every hour, and a save a
colleague makes while the machine is off waits in the copy and lands on
the disk the next time it is up. Text is edited and the last save wins,
said before it does: a save names when the file was last changed as it
was opened, and one that fell behind is not written over but asked
about, save anyway or take theirs. Everything else is read, and at edit
replaced by an upload; an editor may add a file to a shared folder, and
moving, renaming and deleting stay the owner's. A share landing leaves a
notification for each person it reached. Every copy has a row and is
owed its deletion when the row goes; a shared thing has a ceiling on its
size and its files. The settled design is
`docs/decisions/2026-09-16-files-are-shared.md`. The door is the one way in, and
ready means the door answers. Two sockets go straight from the person's
browser to it, each on a ticket from our sign-in and never through our
server: Talk, a terminal joined to a `tmux` session on the machine, a
plain shell with Claude Code the word `claude` away, so closing the tab
kills nothing and the next tab finds it mid-output — its tmux windows
listed down a sidebar, each named for the program running in it or, at a
bare prompt, the folder it is in, and renamed by a double-click on the
name, which is then theirs and not tmux's; the one in view marked, and
any but the last closed from the list; and View, the machine's browser as real
H.264 video decoded in the tab, drawn at the size of the pane it is shown
in, which the pane tells the machine as it settles, so the picture fills
the window and is never letterboxed; its tabs, the person's hands and
pointer on it, the cursor the page wants under that pointer, and what
changed in a folder of their home, on one socket. Nothing durable lives in
a tab: the tab is a view onto state on the machine, and the machine's
browser never idles away. What a program on the machine opens goes to whoever is at the terminal:
a port of theirs fills the screen, a folder of theirs opens Files there, a
file of theirs opens in the preview, and any other address is
offered to open on their own device (Files lists Home, the folders the
person pinned beside it and what was shared with them, not every folder; the preview is one file
filling the screen, a picture or a video shown as it is, a
PDF or an Office document read whole by the browser's own viewer, every
page, the document made into a PDF once on the machine and kept there,
text edited and saved there, and the way a file opens from Files, from
the command bar and from the machine), because a
sign-in page that judges a browser by where it sits refuses the machine's;
a sign-in whose answer comes back to the machine says so on the page, and
the person carries the answer back by pasting the address that would not
load. SSH is a third road in, carried over a
WebSocket through the same door with no ticket, opened by the keys the
Access pane lists, one per Mac with a Remove on each, set up on a Mac by
the one command the pane shows, which installs the Python script the app serves as
ssh's ProxyCommand, makes the Mac a key if it has none and registers its
public half, and writes a `Host` named after the computer that uses that
key and no agent, and
landing in the same tmux session the Terminal page shows, as a grouped
session of its own; a command given to `ssh` runs plain. `claude` in the
person's terminal is their own: plain Claude Code on their own Claude
account, signed into inside Claude Code, and nothing of it passes
through us. Laptops, previews and
production all make real machines; there is no fake, and every machine
outside production carries a lease the reap enforces. Nothing on a machine
ever calls home: our Claude Code on it sends no telemetry, no error
report and no update check, every switch it has for those off in its
environment, and the one word every tool honours, `DO_NOT_TRACK`, set
beside them. The person's location, read from their browser once a
minute they are in the UI and granted, is sent straight to their own
machine's door and appended to `/home/me/.maslow/location.log`, never
through us or into our database. Claude Code lives in the person's Linux, installed there on the first
boot, where it updates itself the way Claude Code does and `claude
update` works; the image carries a copy under ours, read-only and unable
to update itself, which runs until theirs arrives. `claude` on their path
is ours either way, and it hands whichever copy they have their own
credentials. Their Claude Code knows two MCP servers of ours, seeded
into their own `~/.claude.json` and kept current there except where they
changed or removed one, and nothing else of ours: no mode, no model, no
skill, and it signs in to their own account. The two are the computer's
own, `packages/browser`,
running on the machine outside the person's Linux but as the person,
which is the browser, with its profile on the disk and a page of its own,
`/browser`, where the person watches it live and takes it over with their
own clicks and keys, dragging to select and carrying the words out, and
beside the browser's tools shadcn's own MCP server, started beside ours
from the package the image carries and offered as the `shadcn_` tools,
which look components up and say how to add them to an app; and
the
brain at this deployment's `/mcp`, reached with a session of the owner's
that our server opens for the computer and the person can end in
settings. The
brain's MCP is the brain and the connectors, and nothing of the machine:
no hand that runs a command or reads or writes a file goes into it.

## Interface

Maslow is a sidebar and one thing on the screen. The sidebar names every
place down the left: Search, Home, Database, Files, Terminal, Browser and
Ports; under them the person's apps, each by the name and face it was
given; and at its foot Notifications, Settings and the person, whose menu
holds their other orgs, a new org and the way out. What is picked fills
the rest of the screen, flush to its edges, and the sidebar marks where
the person is. Nothing floats, nothing is dragged and nothing is laid out:
there is no dock, no menu bar, no window and no split. On a phone the
places are tabs along the bottom edge, each a target a thumb can hit, and
the one picked fills the screen above them; nothing but the page's own
content scrolls, and the page never goes sideways. `check:phone` holds
those numbers. The shell is `apps/web/components/shell/shell.tsx`, and the
list of Maslow's own apps, which the sidebar and Home both read, is
`apps/web/app/desktop/apps.ts`. The settled design is
`docs/decisions/2026-09-21-one-sidebar-and-no-agent.md`.

Home is the list of apps: Maslow's own, each with a line saying what it
is for, then the person's apps and the ones colleagues shared with them,
and under those any widget an agent placed through the brain's `place`.
A port is a port until its owner makes it an app, from Ports, the page
that lists every port listening on their computer, each opened, shared
or made an app, and the ports colleagues opened to them: the port's own
favicon and name are offered and either is changed there, and from then
on the app is in the sidebar, on Home and in the command bar by that name
and that face, while its port is listening, and nowhere at all while it
is not, on its owner's screen; a colleague's keeps what is shared with
them while the share stands, since their machine is not asked after
another's. A computer that does not answer leaves the sidebar's apps as
they were, never empty. An app fills the screen, framed by a page of
ours, or opens in a browser tab of its own where its owner says so as
they make it an app, or where its page refuses to be shown in a frame,
which the door notes as it looks for the favicon; a colleague's opens
the same way from Ports as from the sidebar. Open on a bare port in
Ports is a browser tab of the port's own. A port that matters, an app or
one shared, found not listening is said so in Ports and kept as it was
for ten minutes: back within them, it goes on as it was; gone longer, its
app, its shares and its public address are forgotten, and it is a new
port when it next listens. That is judged while its owner is looking,
since that is when the door is asked. A port shared with a colleague
reaches them under the name and face its owner published it as, or as
"Port N · owner's" where it was never published.

An agent connected to the brain arranges Home and puts things in front
of the person: `desktop`, `place` and `unplace` on the brain's MCP put a
widget down, move one or take one off, and say what lies there and which
ports colleagues opened to the person; a widget is an app served on a
port, of the person's own computer or of a colleague's opened to them,
and nothing else. `open` puts something in front of the person by its
one address, `maslow://`: a record, a file or folder of their home, a
port, the computer's browser at an address, the terminal, a pane of
Settings. It opens where Home is showing, and where anything else is
open it is offered at the foot of the screen and never put over it.

Command-K, or Search in the sidebar, opens the command bar: one field
over the screen that finds an app, a pane of Settings, a record or a
file in the person's home by its words and goes there on Return. A
framed page keeps every key of its own but Command-K. While the computer
is being made, restarting, updating or moving, the screen is covered
under one card that says what it is doing. The first time the shell is
drawn on a device, one card asks for what Maslow will want of it, on one
tap: notifications and the location, each by the browser's own prompt in
turn; answered or declined, the card never returns on that device, and
the location, once granted, is logged to their own machine and nowhere
else.

The look is one colour on pure grey: no hue in any neutral, an orange
unless the person picks another under Look in Settings, kept on their
device, spent only on what they are meant to look at. Type has three
sizes and each has one job: the body at 14 is what is read, regular for
prose and a value and medium for a name; the caption at 12 is what
stands beside or under it, regular for a description, a date, a size or
a path and medium for a label on its own, a section head, a column head
or a chip; the headline at 16 names a pane, a sheet, a dialog or an
empty state, and only a page's own title climbs past it. Nothing is set
at 13, nothing is bolder than medium below the headline, and a size is
one of the scale's own, `text-xs`, `text-sm`, `text-base`, set once in
`apps/web/app/globals.css`, never a number written by hand. On a phone
the root is 18 instead of 16, so the same three sizes read at arm's
length as iOS's do.

Settings is laid out as a Mac's System Settings: a rail of panes down
the left in two groups, yours and the org's, with a search over it that
leaves only what matches, and one pane at a time on the right, its parts
lying on the pane one under another with a hairline between, no card and
no head of its own; on a phone the rail is a strip along the top. Yours
are five, each named for the question it answers: You, Look, Computer
(the machine alone: ready, update, where, backups, reset), Apps, and
Access (SSH, the agents signed in to their brain, and their other
browsers and phones; ports have a page of their own); the org's are Org,
with deletion at its foot, Members and Groups. Each fact is on one pane
and said once, and no pane explains what its rows already show.

What waits on you waits behind Notifications in the sidebar: a click on
it slides a panel in from the right, closed by the same click, Escape or
a click outside, holding every notification newest first — a note read
and cleared, an ask answered where it stands, by picking one of the
options it offers or typing an answer, and marked with what you said
once you have. A note points at records as plain links that open them;
"Clear" at the top takes away what is done with, notes and answered
asks, and an ask still waiting, an ask to share among them, stays until
it is answered; and one that arrives while you are there stands at the
top right for six seconds, or until you point at it. Notifications
carries a dot while anything is unread or waiting on you. "Waiting on
you" is what asks something of you and is still there: an agent's notes
and asks, an ask to share among them; a shared record is knowledge, not
a demand, and nothing tracks whether you opened it. The skin is settled
in `docs/decisions/2026-09-12-the-look-is-warm.md` and
`docs/decisions/2026-09-19-one-skin.md`.

The way in is a lock screen: the person's wallpaper, darkened, with the
clock and the date over it and one column in the middle; in production,
for now, the same column alone on the bare ground, with no wallpaper and
no clock. It asks for an
address, and offers the faces of whoever has signed in on this device — kept
on the device, nowhere else, five at most, and forgotten one by one from the
face itself; picking one goes straight to the code. The code is six boxes and
the last digit sends it, over that person's picture where the device knows
them, since the server never says whether an address has an account before
the code is right. A person in more than one org says which one they are in
on the same screen, after the code and before Home. The seeded people
stay under a quiet divider, for development, and are not there in production.

The skin is one: shadcn/ui, installed whole as source we own under
`apps/web/components/ui` (style `base-nova`, on Base UI, drawing Remix
icons). The
look is plain, tight and quiet, and it is written down once: the token
block at the top of `apps/web/app/globals.css` and the rules in
`apps/web/components/ui/README.md`. shadcn's colour names are the only
ones; every neutral is pure grey; the one colour is the accent the
person picked, which feeds `--primary` and `--ring`. Corners are small,
6px, and only an avatar, a status dot and a switch are round. Type is
one scale, 12 for a label, 14 for the body, and a title a step or two
up. Controls are 32px, or 28 small, on a 4px grid; a hairline divides
regions, never a card inside a card; shadows are for what floats; there
are no gradients and no blur on content. A component is taken from the
catalogue, never written beside it; the few of ours beside it, a close
button and a status dot, are in the same folder. Motion is a colour or
an opacity over 150ms and the components' own entrances, all of it held
still for anyone who asked for less. Icons are Remix Icon, as component references. The
look is the device's, or light or dark as the person picks under Look
in Settings, kept on the device. The typeface is the device's own,
`system-ui` and `ui-monospace`, and nothing else is named, shipped or
fetched anywhere; nothing is fetched from anywhere at build or at run.

A click shows the next page at once. Every link is `next/link`, so a click
swaps only what changed and the page it points at is fetched before the
click; a `loading.tsx` gives a page its shape while its rows are read. A
link the pointer reaches starts loading its whole page, and a page fetched ahead is
trusted for thirty seconds. The code runs in the database's own AWS region,
Ohio, so a round trip to it is under a millisecond and a person's own trip
is paid once a click; the database stays on and never sleeps.

## The iPhone

Maslow on a phone is a native iPhone app in `apps/iphone`: SwiftUI on
iOS 26, wearing the system's own Liquid Glass and nothing drawn beside
it. The phone is the person: it signs in through `POST /auth/device`
with the same code the lock screen sends, holds a browser's kind of
session as a bearer token, opens the site's own doors with it, and is
refused by the brain's MCP as a browser is. It reads the brain through
three thin doors over `packages/brain`, `/brain/types`, `/brain/read`
and `/brain/get`, and what waits on the person through `/notifications`.
Its tabs are Brain, Computer, Waiting and You. With
Always allowed, the phone logs the person's location for as long as
they carry it, straight to their computer's door and never through us.
A lost phone is ended from Settings › Access with "Sign out the
others". A notification left for the person reaches a closed phone
through Apple's push service on a key of ours, off in the open where
the key is not set. The project file is written by `xcodegen` from `project.yml`
and never committed. The settled design is
`docs/decisions/2026-09-17-the-iphone.md`.

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
is an incident. Every resource has a ceiling before it ships; every ceiling
is ours, it never shows, and reaching it alerts us rather than walling the
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
makes again. It reads whichever cloud the environment names, and takes what
that cloud alone leaves behind: on AWS, a way through the front door to a
machine that is gone.

In every environment, production included, the sweep stops a machine of this
deployment that no row holds, once it is an hour old, since a machine is made
before its row names it. It is never destroyed there and its disk is never
touched: a database put back from an older copy has no row for a machine made
since. A deployment we host is one whose bill we see; a customer's is not, so
a machine nobody is watching is never left running. Only a pass that read
every org may call a machine unheld, and a move's machines are held.

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
where it can be, and a reader where it cannot: Greptile on the pull
request, or Codex run as `codex exec review` against the base branch.
What a reviewer walks by hand is `REVIEW.md`.

- `check` is green: typecheck, format, unused code, the secrets check —
  the database URLs are named only where they are opened, and shipped code
  never handles the environment whole — and the smoke, which migrates an
  empty database and signs in as every seeded org.
- The preview built and its database migrated. Both are required checks, so a
  change that fails `next build` or a migration never reaches main.
- The phone's layout holds: `check:phone` opens a fresh stack in a browser
  the size of a phone and measures the tabs along the bottom, how big each
  is, and that a place fills the width and nothing scrolls sideways. It is part of
  `check`, in the image's Chromium or the Chrome a laptop or the runner
  carries, and skips only where there is no browser at all.
- A reader read it: Greptile on the pull request, or Codex on the whole
  diff against main, before the merge, and its findings are fixed or
  answered in the pull request.
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
