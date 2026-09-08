# 2026-09-07 — the computer returns

Settled with Tanmai on 2026-09-07, before any of it is built. It is built
in the order at the end, one pull request at a time, each read and audited
before the next.

## Three things in three places

A person's computer is three things.

- **The disk.** Their files, their installed packages, their settings,
  their whole Linux. The one thing that must never be lost. A Fly volume,
  backed up, owned by the person.
- **The machine.** CPU and memory, rented by the second. Nothing on it
  matters. It can be restarted or swapped for a bigger one, and the disk is
  plugged into whichever one is running.
- **Our image.** The base Linux with our tools in it: the SSH server, VS
  Code, Claude Code, Chrome, the reporter. We build it; every machine gets
  the newest one on its next start; the person cannot change it, because
  it is not on their disk.

## Always on, from the first sign-in

A computer is per membership: the org pays for it, its files stay inside
the org, and it goes with the membership or the org. A person in two orgs
has two. It is claimed the moment they sign in, in the region the sign-in
came from, and made step by step as the Computer page asks after it: the
disk, then the machine, then ready when VS Code answers. The page shows a
progress bar until then. It never sleeps: the hourly sweep starts a
current member's machine if it is stopped and stops a past member's if it
runs, and gives a member with none one beside their org's others; an org
with none yet waits for a sign-in, which knows where the person is. The
floor is two CPUs, two gigabytes and ten of disk, about twelve dollars a
month; a bigger size drops back to the floor only when nobody is connected
and nothing is running, because dropping is a restart too.

## What the person sees

They are `me`. Home is `/home/me`: VS Code, SFTP and every new terminal
open there. `sudo` works with no password, so they are root when they ask
to be, and `apt install` sticks. Everything under `/` is a normal Debian
and is theirs. `/opt/maslow` is ours: mounted from the image, read-only,
and fresh from the image on every restart, so nothing done to it lasts. CPU and memory are fixed from outside
by Fly; nothing inside can change them. The internet is open outward and
closed inward, except through our doors.

The page shows one storage number, the bytes they use, live. Never a cap,
never a bar, never "of". Inside, `df` shows the disk's current size because
Linux does; the disk is grown before it fills, so it never reads full.

## Reset keeps home

The disk holds two parts, the person's Linux and their home. The SSH server,
the reporter and our tools run in the image, as root, outside the person's
Linux, where even their root cannot stop them. So the only thing they can
break is their own Linux. A restart is a reboot: every running process,
terminal and agent ends, and only what is on the disk remains. VS Code
reopens the same files, Claude Code resumes from its transcript in home,
Chrome keeps its logins. Restart is automatic only when the machine has
stopped answering, when nothing was running anyway; every other restart is
the person's own choice. Reset is a button, never automatic: it throws
their Linux away, copies a fresh one from the image, and keeps every byte
of `/home/me`. A wrong guess by a monitor must never wipe someone's
packages, so no monitor resets; it alerts us and shows the button.

## Sizes

A ladder of sizes, each with its price per hour. Picking one restarts the
machine into it in a few seconds; nothing inside can. The reporter gives
CPU, memory and disk every few seconds; the page draws them live; near the
top of the current size, the page says so. Shrinking is the same control.

## The disk grows itself

The disk is grown before it fills, with no restart: Fly grows the volume
and its file system while the machine runs. It cannot shrink; a smaller
disk is a copy while stopped. There is a ceiling, it is ours, it is high, and it
never shows: hitting it alerts us and never walls the person.

## VS Code in the browser first, the key later

The first door is VS Code's own web build, `code-server`, running in the
image on the person's machine beside their files: tree, editor, terminal,
extensions, and its own list of open ports. The browser talks to the
machine directly, carrying a ticket from our sign-in. Files from outside
come in the way VS Code takes them: dropped onto the tree, straight into
home, and downloaded from it the same way; nothing is staged through the
bucket. Large files must work that way too, and the check drops one of
gigabytes; SFTP, later, is the road for whole folders. The Computer page holds what VS Code does not: the live charts,
the size, the storage number, reset, and open ports as previews.

A person with the browser needs no key. The public SSH key, pasted or made
in the browser and downloaded so the private half never touches our
server, and the SSH front door that lets a Mac's own terminal, VS Code and
file apps in, come last.

## Models: a key per person, no gateway

Nothing routes model calls through us. Each person gets their own
OpenRouter key, minted by us with a spending cap, placed on their machine;
Claude Code uses it directly. The key is ours, so OpenRouter already holds
every call it made, with the model, the tokens, the cached tokens and the
exact cost; nothing polls it. The hourly sweep copies each key's spend into
the ledger, and anyone with our keys, a person or an agent, reads the
whole of it from OpenRouter at any time. The cap is the abuse limit. A
command in the image, which the person cannot edit, flips Claude Code
between our key and their own; their own is theirs and we never see it.
Keys are minted per environment, named for the environment and the person,
capped low outside production, and deleted with the machine.

Which models Claude Code offers is ours to say, and it is one list in the
settings file our image owns, the same file that names the key. The key
itself cannot be limited to models, OpenRouter has no such setting, so a
key taken off the machine can reach any model until its cap. The cap is
the wall. Caching is Claude Code's and the model's, and OpenRouter passes
it through for every model that has it; the ledger shows cached tokens on
their own so it is seen working.

## The ledger replaces the meter

The meter is gone. Two rules stand in for it. Every resource we make
anywhere, a machine, a disk, an object, a key, carries the person's id,
the org's id and the environment in its name or tags, so any vendor's list
traces back in one look. And one table, the ledger, records every resource
event: when, whose, what, how much, at what cost, and why. It records what
happened to resources, never what is in files or conversations. Nothing
shows it to the person. Prices may be rough; what may not be missing is
the record of what happened, whose it was and why, so that an agent with
our keys can walk every vendor's own log and the ledger together and trace
every dollar back. Prices are set later from reading it.

## Fly everywhere, and a lease

Laptops, previews and production all make real machines on Fly, with the
same image, through the same code. There is no fake and no fallback: a
checkout with no Fly token has computers off, and says so. Fly's storage,
Tigris, is on the same invoice, split the same way: one Fly app and one
bucket for production, one of each for previews and laptops.

Every machine made outside production carries a lease, a "keep me until"
time in its Fly tags, that the running dev server renews while it is up.
The reap, which already runs on GitHub for the bucket and preview
databases, runs hourly with Fly's token: lease lapsed an hour, stop the
machine; lapsed a day, destroy it, its disk, its key and every object of
its person's in the bucket. The two buckets themselves stay, one per
environment. It reads Fly's
list, not our database, so nothing forgotten escapes it, and it says what
it did in its log and ends with a count; a laptop's database is not there
to write a ledger row into, so the ledger holds what the app did and the
reap's log holds what the reap did. A renewal can only keep a machine
alive; silence can only stop one. A closed pull request destroys its
preview's machines on the spot. The smoke on a pull request's own code
holds a Fly token that reaches only the dev app, so it makes a real
machine, checks it, and destroys it.

## Nothing calls home

A machine never needs to reach our server. Our server asks the machine for
its numbers, OpenRouter for its spend, and Fly for its list. That is what
lets a laptop's machines be real.

## The computer is in the brain's MCP

Settled with Tanmai on 2026-09-08. There is no separate agent for the
computer and no separate server for it. The brain's MCP at `/mcp` also
offers the computer's tools, so every agent that can reach the brain,
Claude Code on the machine or on a Mac, claude.ai, the Mac app later, can
use the person's computer through the same address and the same sign-in.

The computer's tools are the browser and three hands. The browser is the
Chrome extension's tools by the same names, read the page as a numbered
list, find by words, click, type, screenshot and the rest, built on
Playwright in `packages/browser` and written for the weakest model: the
page comes back as text with numbered parts, a find answers with the
number, every action waits for the page to settle and fails in one line.
It is checked by four tasks that must pass with GLM 5.3 Flash. The hands
are run a command, read a file, write a file, as `me` in home. Chrome and
the browser tool run on the person's machine, inside their Linux, so the
profile and its logins are theirs and in home; our server runs no browser.
A call at `/mcp` is passed to the machine through its door, signed with
the computer's secret, and the answer passed back, images included: the
same road the page opens VS Code by, and the same direction as everything
else, our server asking the machine. From inside a dev machine the brain
is the preview's or production's, since a laptop cannot be reached; from
the laptop itself everything works.

Chromium for the tool's own checks comes from Playwright, fetched from
Microsoft rather than npm: an exception to the field guide's line, written
down here.

## Backups and shared drives

Backups go to the bucket we already have. Shared drives, links into other
people's computers with permissions and live sync, come later; what they
need now is that files are plain files in a plain home on a plain disk.

## Order of work

Each is one pull request, read before the next starts. As of 2026-09-08:

0. This decision and the field guide. Done.
1. The image. Done.
2. A computer at sign-in, with the lease, the tags, the ledger, the
   progress bar and the backfill. Done, live.
3. Opening it: every machine at its own address behind a door that takes
   a ticket from our sign-in, and the Open button. Built, in review.
4. The browser tool as a package, with its four-task check. Built, in
   review.
5. The numbers on the page: live charts, the storage number, open ports.
6. The computer in the brain's MCP: the browser and the three hands on
   the machine, reached through `/mcp`.
7. Reset keeps home.
8. Sizes.
9. The disk grows itself.
10. Claude Code on our key, and the switch; it reaches `/mcp` like any
    other agent.
11. Backups.
12. The key and the SSH front door.
