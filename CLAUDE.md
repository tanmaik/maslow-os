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

The brain's pages are read far more often than written, since most of what
is in them the agent put there. The records page is a rail of the person's
types beside the records themselves: each type carries a bar of how full it
is against the fullest beside it, the types a colleague shared fold under
that person's name, and a brain of many types is narrowed by typing one.
The records are rows of a title and the first line of what they say, cut
either into their types or into the days they happened, and marked with
whose they are where they are not the reader's. A record is a document: its
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
change it; and a month with the records on the days they happened. All four
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
frame, and the way back lands on the desk with the Settings window open on
what came of it. In production a finished
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
throws their Linux away and keeps home; it is a button, never automatic,
and the backups are there to restore from afterwards. A new image is an
update, not a restart: the sweep records on the person's row that one is
ready and to which image, and says so quietly in three places — a
notification behind the clock with now, tonight and when idle on it, counted
among what waits on the person until they pick one; a line in the Maslow
menu and in About This Computer; and a row on the Computer pane offering
the same three. Now names what it will stop
before it stops it; tonight is three in the morning where the machine is;
idle is half an hour with nothing typed and nothing asked of a port, and
a port that listens is called busy, since what a program serves itself
never passes the door. After seven days the idle rule runs on its own,
and a security image uses it from the first day. None of it is on the
machine.
Sizes are a ladder of CPU and memory, shown without a price, and a
restart of a few seconds; the first rung is four shared CPUs and eight
gigabytes, since the door, the browser and a few Claude Codes at once do
not fit in two; the person moves a computer up or down, and the sweep moves one it
finds with its memory nearly full up a rung on its own, never down; the
disk grows before it fills and never shows a cap. Where it is is one of the
North American regions Fly still makes disks in, seven today, since Fly
retires regions now and then and a retired one refuses a new disk;
it is guessed at sign-in from where the request came
and said on the page by name beside the one honest number, the round
trip the person's own browser measures to it; over forty milliseconds
the page says so and names the region nearest them. A move is a button
of the person's and nothing else's: the machine stops, its disk is
snapshotted, the snapshot is restored in the new region, a machine there
must answer its door, and only then do the old machine and disk go, the
snapshot kept a day; a step that fails puts them back where they were,
and the page is blocked for the minutes it takes. The computer is a
pane of Settings, plain first, ready, the update if one waits, the last
backup with the fourteen kept listed under it, each restoring into a
dated folder of its own in the home and over nothing, and then its
numbers, size, where, SSH and reset in the open; About This Computer
in the Maslow menu is its face on the desktop. A port is the person's until they share it
with a person, a group or everyone in the org, and it opens or is a 404;
the agent asks for a port through the same share tool it asks for a
record with, and never shares one itself. The door is the one way in, and
ready means the door answers. Three sockets go straight from the person's
browser to it, each on a ticket from our sign-in and never through our
server: Talk, a terminal joined to a `tmux` session on the machine, a
plain shell with Claude Code the word `claude` away, so closing the tab
kills nothing and the next tab finds it mid-output — its tmux windows
listed down a sidebar, each named for the program running in it or, at a
bare prompt, the folder it is in, and renamed by a double-click on the
name, which is then theirs and not tmux's; the one in view marked, any
Terminal window on the desktop turned to any of them, any but the last
closed from the list,
one opened from the dock starting in a fresh shell of its own, and a
shell nobody ever ran anything in going with its Terminal; and View, the machine's browser as real
H.264 video decoded in the tab, drawn at the size of the pane it is shown
in, which the pane tells the machine as it settles, so the picture fills
the window and is never letterboxed; its tabs, the person's hands and
pointer on it, the cursor the page wants under that pointer, and what
changed in a folder of their home, on one socket; and Agent, the same
Claude Code the terminal runs, spoken to over the Agent Client Protocol
through `claude-code-acp`. The door is that agent's client, and it owns
the terminal a command runs in: a command starts as the person in their
home and what it writes goes down the sockets as it arrives, so the
output is live under the tool call that ran it. The tab never runs
anything. One of those runs per machine, as the person,
in their home, on managed auth, and the door holds the conversation rather
than the tab: a prompt keeps going with nobody watching, what it said is
kept and replayed to the next socket, and the session id is on the disk,
so a door that comes back after a new image loads the same conversation.
The window is a conversation: what the agent says as markdown, what it
thought folded away, a row for every tool call with its changes or its
output beside it, the plan it is working to, and what it asks before it
acts, answered there. Which conversation, which mode and which model are
the person's to pick; a new one, a fork of this one and any of the ones
the machine keeps are a click away. Nothing durable lives in
a tab: the tab is a view onto state on the machine, and the machine's
browser never idles away. What a program on the machine opens goes to whoever is at the terminal:
a port of theirs opens that port's window on the desktop, a folder of theirs opens Files there, a
file of theirs opens in the Preview window, and any other address is
offered to open on their own device (Files lists Home and the usual
places beside it, not every folder; the Preview window is one file in a
window of its own named for it, a picture or a video shown as it is, a
PDF or an Office document read whole by the browser's own viewer, every
page, the document made into a PDF once on the machine and kept there,
text edited and saved there, and the way a file opens from Files, from
the command bar and from the machine), because a
sign-in page that judges a browser by where it sits refuses the machine's;
a sign-in whose answer comes back to the machine says so on the page, and
the person carries the answer back by pasting the address that would not
load. SSH is a third road in, carried over a
WebSocket through the same door with no ticket, opened by the public key
a person sets in settings, set up on a Mac by the one command the
Computer pane shows, which installs the Python script the app serves as
ssh's ProxyCommand and writes a `Host` named after the computer, and
landing in the same tmux session the Terminal page shows, as a grouped
session of its own; a command given to `ssh` runs plain. Every model
call goes through us: the agent on the machine sends it to this
deployment's gateway, `/model`, carrying a token of its computer's and
no key, and the gateway sends it on with the OpenRouter key that
computer's row holds, minted per person with a cap of five dollars a
week. The key never leaves our server. What a person spent is shown to
them in dollars, in the Agent window and on the Agent pane; OpenRouter
holds the record, the sweep copies it, and reaching the cap stops the
calls and nothing else. Where a machine cannot dial the deployment, as
on a laptop, the call goes to its own door and up the line the laptop's
stack holds open for the brain. Two Claude Codes run on the machine and
they never share credentials. The Agent window's is ours: started with
`MASLOW_AUTH=managed`, it runs through the gateway, on GLM 5.3 Flash on
whichever of its providers is fastest and nothing else — the gateway puts
that model on every call whatever name was asked for, so no Claude model
is reachable on what Maslow pays for — and the app is the one way to it.
The settled design is `docs/decisions/2026-09-16-the-model-gateway.md`. The Agent window is BoardUI's AI Chat template wired
to it: a rail of chats with no folders, pinned ones first; the thread in
its user and assistant turns, with what the agent did as its task list,
a thought one step among the steps it came with and folded with them,
what it asks before it acts as a notification, the kind of thing named, the
thing itself as it would run, and the answers as buttons, which goes
when the prompt does, and a question it asks the person, Claude Code's
own questionnaire, standing in the thread and answered there; the pill
composer with the one model named and dictation where the
browser has it, live while the agent works, since a word typed then goes
into the running turn as it does in Claude Code's own terminal, and under
it how the agent acts, the week's spend and how full the conversation is.
One conversation is in view at a time and the rest stand open behind it,
each with its own Claude Code process, running on; a new one is handed
over at once, since the door keeps one warm; one quiet for three minutes
is closed, its process freed, and opens again whole when wanted. A chat
is named by the same model after its first exchange, or by the person
with a click on the name, and the name is the door's, kept on the disk.
A conversation picked in the rail is in view at once, whole from the
door's own record when it was open before, and Claude Code loads it
behind. Two tools are the door's own, handed to every
conversation as a small MCP server started beside it under a token of
that conversation's: a wakeup, which prompts the conversation again after
a while and is kept on the disk so a door coming back still keeps it, and
a monitor, a command run as the person whose lines reach the
conversation as they come, into the running turn or as a turn of its
own, waking it if it sleeps. There is no cron and no workflow. What the
adapter lacks for this, a word into a running turn and a close, is put
into its installed copy when the image is built, in
`apps/computer/patch-acp.mjs`. Floating conversations on the desktop, the
pets of 2026-09-15, were tried for a night and taken out the next
morning: the window is the one shape. `claude` in the
person's terminal is their own: plain Claude Code on their own Claude
account, signed into inside Claude Code, and nothing of it passes
through us; there is no switch between the two. An env block in the
person's own Claude Code settings that names the API's address or key is
theirs to have, and a session of ours refuses to run through it; a
deployment without our provisioning key has no Agent of ours, and says
so. Laptops, previews and
production all make real machines; there is no fake, and every machine
outside production carries a lease the reap enforces. Nothing on a machine
ever calls home. The person's location, read from their browser once a
minute they are in the UI and granted, is sent straight to their own
machine's door and appended to `/home/me/.maslow/location.log`, never
through us or into our database. Claude Code lives in the person's Linux, installed there on the first
boot, where it updates itself the way Claude Code does and `claude
update` works; the image carries a copy under ours, read-only and unable
to update itself, which runs until theirs arrives. `claude` on their path
is ours either way, and it hands whichever copy they have their own
credentials; an editor drives the same Claude Code over the Agent Client
Protocol through `claude-code-acp`. It starts in auto
mode, seeded into their own `~/.claude/settings.json` and theirs to change. It knows
three MCP servers out of the box, seeded into its
settings: the browser tool, `packages/browser`,
running on the machine as its own server outside the person's Linux but
as the person, with its profile on the disk and a page of its own,
`/browser`, where the person watches it live and takes it over with their
own clicks and keys, dragging to select and carrying the words out; and
the brain at this
deployment's `/mcp`, reached with a session of the owner's that our
server opens for the computer and the person can end in settings; and
BoardUI's, the skin Maslow wears, with its skill linked among the
person's from the image, so what Claude Code builds for them looks like
Maslow. The
brain's MCP is the brain and the connectors, and nothing of the machine:
no hand that runs a command or reads or writes a file goes into it.

## Interface

The canvas is the screen and the chrome floats over it: dark, warm, quiet,
one look with no light one. Home is a desktop the size of the display that
never scrolls, and every surface of Maslow is a window on it, drawn in
the window with its controls in the window's bar, placed
anywhere, at any size the person drags it to, overlapping if they like,
coming to the front when touched; nothing lays windows out for them and
nothing resizes one because another changed. A click on an icon in
the dock brings that app's window forward, back from the dock if it was
put away, or opens its first, at the block's own size; New window in the
icon's menu opens another, and every window after the first is
numbered, on the bar, in the menu and on its icon when put away. The dock and the window's frame are ryOS's
(github.com/ryokun6/ryos), carried over as code under its licence, which
is now ours too: AGPL-3.0, in `LICENSE`, with `NOTICE` saying what came
from where. What the desktop lies on is ours: eight abstract wallpapers that ship with
the app, a few kilobytes of gradient and grain each, and the bare warm
ground, which is also what is left when a picture will not load. A person
adds their own, kept whole in the bucket and theirs alone. They are all
in Settings under Look, where a right-click on the desktop goes, and the one
picked is worn at once and follows the person to any device. Glass is the browser's own: a surface's backdrop is what
is truly behind it, frosted and bent at the edges through one SVG filter
(`components/glass.tsx`), never a picture of the page; Chrome bends,
Safari and Firefox frost. Glass is the chrome and paper is the content:
the menu bar clear, the dock clear glass, and menus, dialogs, every
window's bar and every rail beside its content (the brain's types, the
terminal's windows, the Agent's conversations, the Settings toolbar)
frosted at one level, keeping
most of their own colour so their words read; what is read or edited,
a list, a form, a terminal, a page on a port, lies on solid ground. Two
looks and no third. A page framed in a window is flush to its frame: no
margin, no card edge, no toolbar of its own that the bar already is. The dock is a
shelf of it holding icons that swell
under the pointer, with a label over the one the hand is on and a dot
under the ones with a window open; it lies along the bottom, the left or
the right, as a right-click on the dock says (a phone's
along the bottom), and an icon's right-click carries the dock's settings
under its own; it stays in view unless told to hide, and then its edge
brings it back. A window arrives out of its icon, shrinks
back into the dock when put away, and wears three plain lights and its
name in a bar; the one in front casts the deep shadow. A menu bar runs along the top: the Maslow menu at its left holds
About This Computer (the machine, where it is, its size and image, and
what it is using, laid out as ryOS's is), Settings, your other orgs and
the way out; the
front window's own menu stands beside it; Window lists every window on
every desktop; the clock is at the right. Left of it, the weather shows once
granted: a mark for the condition and the temperature, in the device's own
unit, with a tooltip naming the condition and the place. The ask is the
browser's own location prompt, made the moment the desktop is drawn for a
signed-in person and never asked again on that device once it is refused,
until Settings turns it back on. Any window fills the screen with
one press and comes back. A snapped window fills exactly the screen
under the menu bar and up to the dock, edge to edge. A port can be put
on the desktop itself, from its icon's menu: a widget, with no bar, under
every window, moved by the grip along its top and resized by its
edges, kept where it was left, and made a window again or taken off
from the grip's menu. The desktop is the ground under the windows, and the agent arranges it:
`desktop`, `place` and `unplace` on the brain's MCP put a widget down at a
place and size, move one, or take one off, and say what lies there and
which ports colleagues opened to the person; a widget is an app served
on a port, of the person's own computer, which the agent builds and runs
there, or of a colleague's opened to them, and nothing else, since a
record's page on a desktop is a document and not a widget. The windows the
person has open are theirs and the agent never sees or touches them. A
widget the agent placed is an ordinary one, dragged, resized, put away
or made a window like any other. The desktop is kept on the server with a count of how many times it
was kept: a save from the page names the count it saw and one that fell
behind is refused and takes the newer desktop in, its own changes kept over
it, and the page's five-second ask after ports says when the desktop was
kept elsewhere, so what the agent placed is on screen within seconds on
every device. There is one desktop
for now. The keys reach all of it. Command-K opens the command bar,
one field over the desktop that finds an app, a window, a port, a pane of
Settings, a record or a file in the person's home by its words and goes
there on Return; a letter
typed with nothing focused opens it with that letter. Control and
Option with a key act on the window in front, since the keys a browser
or a Mac owns are never taken: N opens another of its app, W closes it,
M puts it away, Tab and Shift-Tab go to the next and the previous,
comma opens Settings, and the arrows, U, I, J, K and Return put it on a
side, a corner or the whole desktop; the Window menu lists every one
beside its key. Tab reaches the dock as one stop and the arrows walk
its icons. A framed page keeps every key of its own but Command-K. A
phone is its own shell over the same windows, laid out as a phone is.
Home is a grid of tiles: the apps, the ports opened, and the widgets. A
tap opens one as the whole screen under the menu bar's strip, with
nothing to drag and nothing to resize, and one control at the right of
its bar holds everything the window itself offers as a sheet of rows:
another of its app, close, and the other windows. Under the screen is a
handle: a tap on it goes home, a swipe up from it opens the recents, a
deck of the open windows to go to or flick away. Never the system's own
gestures, which the browser owns. Going to a window brings it to the
front of that deck. The dock and the rail are not drawn. Every page's
toolbar folds to one row — the path or the address stays in a strip
that scrolls sideways, the rest goes to the sheet; the brain keeps its
search and one Filter button, with its conditions and sort as a sheet
and its view switch under one more control, and its table drags
sideways with the title column held. Every menu — a window's, the
desktop's, a row's — opens as a sheet from the bottom edge, on a long press
where a right-click goes, with rows a thumb can hit. The command bar
opens from the menu bar's search icon or a two-finger tap, and stands
full width. Nothing but the window's own content scrolls. A tap acts at
once, with no wait for a second and no highlight, and a row pressed is
one step darker.
Nothing else animates. The look is one colour on pure grey: no hue in any neutral, an
orange unless the person picks another under Look in Settings, kept
on their device, spent only on what they are meant to look at; the body stays
at 14, a label in a bar drops to 12 and a title climbs. Settings is laid out
as a Mac's System Settings: a rail of panes down the left in two
groups, yours and the org's, with a search over it that leaves only
what matches, and one pane at a time on the right, its parts lying on
the pane one under another with a hairline between, no card and no head
of its own; on a phone the rail is a strip along the top. Yours are six,
each named for the question it answers: You, Look, Computer (the
machine alone: ready, update, size, where, backups, reset), Agent (what
it spent this week against the cap, and nothing else), Apps, and Access
(SSH, the ports they opened and who reaches each, the ports opened to
them, and the agents signed in to their brain); the org's are Org, with
deletion at its foot, Members and Groups. Each fact is on one pane and
said once, and no pane explains what its rows already show. What waits on you waits behind the clock: a click on it slides
a panel in from the right over the desktop, closed by the clock again,
Escape or a click outside, holding every notification newest first — a note
read and cleared, an ask answered where it stands, by picking one of the
options it offers or typing an answer, and marked with what you said
once you have. A note points at records as chips that open them, "Clear
read" at the top takes away what is done with, and one that arrives
while you are at the desktop stands at the top right for six seconds, or
until you point at it. The clock carries a dot while anything is unread
and the count of the asks still waiting on you; the Brain carries
nothing. "Waiting on you" is what asks something of you and is still
there: the agent's notes and asks, an ask to share among them, and later
the pages teammates' agents put in front of you; a shared record is
knowledge, not a demand, and nothing tracks whether you opened it. The
settled designs are
`docs/decisions/2026-09-09-the-canvas-is-the-screen.md` and
`docs/decisions/2026-09-11-the-screen-is-a-desktop.md`, with the skin over it
in `docs/decisions/2026-09-12-the-look-is-warm.md`.

The way in is a lock screen: the desktop's own wallpaper, darkened, with the
clock and the date over it and one column in the middle. It asks for an
address, and offers the faces of whoever has signed in on this device — kept
on the device, nowhere else, five at most, and forgotten one by one from the
face itself; picking one goes straight to the code. The code is six boxes and
the last digit sends it, over that person's picture where the device knows
them, since the server never says whether an address has an account before
the code is right. A person in more than one org says which one they are in
on the same screen, after the code and before the desktop. The seeded people
stay under a quiet divider, for development, and are not there in production.

The skin is BoardUI's (boardui.com), a design system bought outright
and installed as source we own: its whole catalogue, free and Pro, is
under `apps/web/components/base`, `application` and `foundations`, with
its tokens in `apps/web/styles`. Every component is BoardUI's where
BoardUI has one: button, input, textarea, select, switch, checkbox,
radio, tabs, table, tooltip, badge, chip, avatar, kbd, divider,
breadcrumb, pagination, date picker, notification, the chart cards and
the agent pieces. Where BoardUI ships a whole screen we want, the Agent
window being the first, it is that template wired to the real thing
rather than a copy of it: the template's own components take props for
what a real screen puts in their place, everything the product does not
have is cut behind one of those props, and there is one of each component
in the app. shadcn, still installed whole under
`apps/web/components/ui`, is for what BoardUI lacks: dialog, sheet,
context menu, menu bar, dropdown, popover, command, progress, skeleton,
and the like, each restyled to BoardUI's geometry and motion so the two
are one skin. Nothing is hand-rolled beside either: a component is taken
from the catalogue, never written beside it. Styling is Tailwind on
BoardUI's semantic tokens: its neutral ramp is pure grey with no hue in
any step, its accent ramp is spun from the hue
the person picked, and every shadcn token name points at the BoardUI
token it means. Type is BoardUI's composite utilities
(`text-body-medium`, `text-caption-1-semibold`), never a size and a
weight stacked by hand. Motion is BoardUI's: menus condense in over
150ms from a little smaller and a little blurred, dialogs over 300ms,
hover colours over 150ms, a press darkens one step and never shrinks,
exits faster than entrances, all of it held still for anyone who asked
for less motion; ryOS's own animations, a window arriving out of its
icon and leaving for the dock, the dock's swell, stay ryOS's. Icons are
Remix Icon, as component references. BoardUI Pro's source is licensed,
not ours to publish: the repository stays private while it is in it,
and going public means taking the Pro parts out first. The look is the
device's, or light or dark as the person picks under Look in Settings,
kept on the device. The typeface is the device's own, `system-ui` and
`ui-monospace`, and nothing else is named, shipped or fetched anywhere;
nothing is fetched from anywhere at build or at run.

Where BoardUI ships an assembled block, under
`apps/web/components/application` — a data table, a calendar, a settings
row — the product uses that block, not a hand assembly of the primitives
beside it: a prop first, and only then a small edit inside the block
itself when a prop is missing, made in the way every other use of that
block would want it too. The base components stay exactly as they are
used today.

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
is an incident. Every resource has a ceiling before it ships; every ceiling
but one is ours, it never shows, and reaching it alerts us rather than
walling the person. The one exception is the model key: that ceiling is the
person's, weekly, in dollars, and shown wherever they spend it.

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
where it can be, and a reader where it cannot: Greptile on the pull
request, or Codex run as `codex exec review` against the base branch.
What a reviewer walks by hand is `REVIEW.md`.

- `check` is green: typecheck, format, unused code, the secrets check —
  the database URLs are named only where they are opened, and shipped code
  never handles the environment whole — and the smoke, which migrates an
  empty database and signs in as every seeded org.
- The preview built and its database migrated. Both are required checks, so a
  change that fails `next build` or a migration never reaches main.
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
