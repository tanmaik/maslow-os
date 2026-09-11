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
- **Our image.** The base Linux with our tools in it: the door, Claude
  Code, Chromium, the reporter. We build it; every machine gets
  the newest one on its next start; the person cannot change it, because
  it is not on their disk.

## Always on, from the first sign-in

A computer is per membership: the org pays for it, its files stay inside
the org, and it goes with the membership or the org. A person in two orgs
has two. It is claimed the moment they sign in, in the region the sign-in
came from, and made step by step as the Computer page asks after it: the
disk, then the machine, then ready when its door answers. The page shows a
progress bar until then. It never sleeps: the hourly sweep starts a
current member's machine if it is stopped and stops a past member's if it
runs, and gives a member with none one beside their org's others; an org
with none yet waits for a sign-in, which knows where the person is. The
floor is two CPUs, two gigabytes and ten of disk, about twelve dollars a
month; a bigger size drops back to the floor only when nobody is connected
and nothing is running, because dropping is a restart too.

## What the person sees

They are themselves, `wile@acme`, since 2026-09-11: the boot names the
account after their first name and the machine after their org, and files
are owned by the number underneath, so a rename touches nothing. Home is
`/home/me`: every new terminal opens there. `sudo` works with no
password, so they are root when they ask
to be, and `apt install` sticks. Everything under `/` is a normal Debian
and is theirs. `/opt/maslow` is ours: mounted from the image, read-only,
and fresh from the image on every restart, so nothing done to it lasts. CPU and memory are fixed from outside
by Fly; nothing inside can change them. The internet is open outward and
closed inward, except through our doors.

The page shows one storage number, the bytes they use, live. Never a cap,
never a bar, never "of". Inside, `df` shows the disk's current size because
Linux does; the disk is grown before it fills, so it never reads full.

## Reset keeps home

The disk holds two parts, the person's Linux and their home. The door,
the reporter and our tools run in the image, as root, outside the person's
Linux, where even their root cannot stop them. So the only thing they can
break is their own Linux. A restart is a reboot: every running process,
terminal and agent ends, and only what is on the disk remains. Claude
Code resumes from its transcript in home, and the browser keeps its
logins. Restart is automatic only when the machine has
stopped answering, when nothing was running anyway; every other restart is
the person's own choice. Reset is a button, never automatic: it throws
their Linux away, copies a fresh one from the image, and keeps every byte
of `/home/me`. A wrong guess by a monitor must never wipe someone's
packages, so no monitor resets; it alerts us and shows the button.

## Sizes

A ladder of four sizes, each named with its CPUs and memory and no price,
at Tanmai's word on 2026-09-08: Small, two shared CPUs and 2 GB; Medium,
four and 4 GB; Large, eight and 8 GB; Dedicated, two dedicated CPUs and
8 GB. Picking one restarts the machine into it in a few seconds; nothing
inside can. The row is the truth: the sweep remakes a machine whose size
is not its row's, as it does for the image. Nothing changes the size but
the person: the sweep moved a computer up a rung on its own from
2026-09-08 when it found nine tenths of its memory in use, and that came
out on 2026-09-10. The reporter gives CPU,
memory and disk every few seconds; the page draws them live; near the top
of the current size, the page says so. Shrinking is the same control. The
ledger records every change with the size, and prices come later from
reading it.

## The disk grows itself

The disk is grown before it fills, with no restart: Fly grows the volume
and its file system while the machine runs, checked on 2026-09-08 with a
machine that saw the room the moment the call returned. The hourly sweep
reads each running computer's numbers, and a disk more than four fifths
full is grown by half again. It cannot shrink; a smaller disk is a copy
while stopped. There is a ceiling, it is ours, it is 200 GB, and it never
shows: hitting it alerts us and never walls the person.

## The door is the way in

VS Code's web build was the first door from 2026-09-07. It came out on
2026-09-11, for the reasons in
[the computer's surface is ours](2026-09-09-the-computer-surface-is-ours.md):
what a person opens is Talk, a terminal joined straight from their
browser to a `tmux` session on the machine with Claude Code running in
it, and View, the machine's browser as video, each a socket to the door
on a ticket from our sign-in. Ready means the door answers. Files come
and go through the door too, straight from the browser. The Computer page
is plain first, ready, Open, the browser's page and the last backup, and
then the numbers, ports, size, SSH and reset.

SSH stays, at Tanmai's word on 2026-09-11, and is set up by one command
since 2026-09-10. The public key is pasted under "Your public key" in
settings, checked for the shape `ssh-keygen` writes, kept on the
computer's row, and given to the machine's door, which writes it beside
the SSH server outside the person's Linux; the sweep gives it again every
hour, so a remade or reset machine has it. The road in is SSH carried
over a WebSocket through the same door, at `/maslow/ssh` on the machine's
own name, with no ticket: the key is the lock, as on any machine on the
internet, and the SSH server takes keys only, one user, no root. The user
it takes is `me`, the account outside the person's Linux; inside, the
same number is the person's own name. The Computer page shows the
computer's name, which is its hostname and the org's slug, and one
command: `curl -fsSL "<this site>/ssh/setup?…" | sh`, carrying a ticket
the computer's secret signed and good for an hour, so the script knows
whose computer. The script puts `maslow-ssh`, the small Python
ProxyCommand the app serves, at `~/.local/bin`, and writes a `Host
<name>` block to `~/.ssh/config`, or only brings its address up to date
when the block is there, since a moved computer has a new one; then `ssh
<name>` works. A login over SSH lands in the same terminal the Terminal
page shows: sshd's ForceCommand runs `/opt/maslow/ssh-login.sh` inside
the person's Linux, which joins the tmux session `main` as a grouped
session, so the Mac's terminal and the page each keep their own size and
current window while sharing every window, and makes `main` the way the
page does when it is not there yet; a command given to `ssh` runs plain,
and a file app gets the SFTP server it asked for. Raw port 22 at Fly's
edge was not possible: the edge cannot route a plain TCP connection to a
machine by name, and SSH names its target only after the handshake.

## Models: a key per person, no gateway

Nothing routes model calls through us. Each person gets their own
OpenRouter key, minted by us with a spending cap, placed on their machine;
Claude Code uses it directly. Built 2026-09-08, restored 2026-09-11 after
a day out: the key is minted with OpenRouter's provisioning key
(`OPENROUTER_PROVISIONING_KEY`) when the machine is first made, named for
the environment, the checkout and the computer, capped at twenty dollars a
month in production and two elsewhere, kept on the computer's row and
given to the machine in its environment; the boot writes it to a profile
file inside the person's Linux, again at every boot, so nothing the
person does to their files loses it. `claude` on the machine is a wrapper
of ours on the read-only side, on the path of any shell, a bare `ssh
computer claude` included, that reads the key and the person's choice at
every start and reaches OpenRouter through the Anthropic-shaped address
it offers with the models named by OpenRouter's own ids: GLM 5.3 Flash by
default, at Tanmai's word on 2026-09-08 and again on 2026-09-11, with the
Claude 5 models one `/model` away. Ours is the default and the fallback:
`model mine` in the computer's terminal switches Claude Code to the
person's own Anthropic account, which they sign in to from that terminal,
and `model ours` switches it back at its next start, so a person whose
own plan runs dry keeps working on ours. The choice is a file in home,
and the machine reports it with its numbers so the Computer page says
which account is in use. A machine made before the deployment minted keys
gets one at the next sweep. A deployment without the provisioning key
mints none and says so on the Computer page: Claude Code runs on the
person's own account there. The sweep copies each key's spend into the
ledger and deletes keys carrying this deployment's name that no computer
holds, reading OpenRouter's own list: only on a pass that read every org,
and never a key made within the hour, whose computer may be mid-making. A
key OpenRouter no longer has is forgotten and the machine remade with a
fresh one. The key is ours, so OpenRouter already holds every call it
made, with the model, the tokens, the cached tokens and the exact cost;
nothing polls it, and anyone with our keys, a person or an agent, reads
the whole of it from OpenRouter at any time. The cap is the abuse limit.
Their own account is theirs and we never see it.

Which models Claude Code offers is ours to say, and it is the one list
the wrapper hands it, in the image the person cannot edit. The key itself
cannot be limited to models, OpenRouter has no such setting, so a key
taken off the machine can reach any model until its cap. The cap is the
wall. Caching is Claude Code's and the model's, and OpenRouter passes it
through for every model that has it; the ledger shows cached tokens on
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
its person's in the bucket. A disk an hour old that no machine holds goes
too, since one made for a machine that was never made is on no list of
leases; a computer whose disk went that way forgets it and makes another
at its next step. The two buckets themselves stay, one per
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

## Claude Code on the computer, the browser beside it, the brain over the wire

Settled with Tanmai on 2026-09-08, reversing the earlier "the computer is
in the brain's MCP". The brain's MCP at `/mcp` is the brain and the
connectors, Composio's apps, find and run, and nothing else: no hand that
runs a command or reads or writes a file goes into it. The computer is
where Claude Code runs, not another set of remote tools.

Claude Code is in the image, under `/opt/maslow` from npm, so it updates
with the image and is `claude` on the person's path. It runs on our key by
default, on GLM 5.3 Flash, and `model mine` in its terminal switches it
to the person's own Anthropic account, `model ours` back. Zed's adapter
for the Agent Client Protocol is beside it as `claude-code-acp`, so an
editor on the person's Mac drives the same Claude Code over SSH on the
same account: the choice and the key are read by a file every login
shell and both wrappers source, proven 2026-09-11 with one prompt over
ACP answered on GLM through OpenRouter with no Anthropic login on the
machine. It knows two MCP servers out of the box, seeded
into its settings, so a person who changes or removes one is left alone:

- **The browser**, `packages/browser`: the Chrome extension's tools by
  the same names, read the page as a numbered list, find by words, click,
  type, screenshot and the rest, built on Playwright and written for the
  weakest model. It runs on the machine as its own MCP server, on
  `127.0.0.1:8082`, outside the person's Linux but as the person, so it
  updates with the image, reaches only their home, and its Chromium and
  what that needs from Debian are never on their disk. Its profile, logins
  included, lives on the disk beside the home. Once anything opened it,
  it stays open for the life of the machine, so a page mid-work outlives
  whoever was watching it; nothing durable lives in a tab. It has a page
  of its own, `/browser`, live and in the person's hands: video as the
  page moves, and their clicks, keys, scrolls and addresses sent up the
  same socket, so a person watches over the agent's shoulder, steps in to sign
  in to a site for it, and hands it back. Tanmai, 2026-09-08: "it is
  just another port at the end of the day." Words cross both ways: a
  drag selects in the picture and Copy carries the selection into the
  person's own clipboard, paste sends theirs in as typed text, and every
  other chord with Cmd or Ctrl stays with their own browser, whose
  reload and tabs keep working. The Computer page's port list leaves out
  ours and Claude Code's own listeners.
- **The brain**, at this deployment's `/mcp`, with a session of the
  owner's that our server opens for the computer, named "Your computer"
  beside their apps in settings, and gives the machine with its address.
  Ending it there ends it; the next time the machine is made, on the next
  image, it gets another. A laptop's app cannot be reached from a machine,
  so a laptop's computer knows the browser alone.

Chromium comes from Playwright, fetched from Microsoft rather than npm
when the image is built: an exception to the field guide's line, written
down here.

## Backups and shared drives

Backups go to the bucket we already have. Once a day the sweep signs an
upload address for a computer and asks its door; the machine archives
the home outside the person's Linux, uploads it there, and keeps what came
of it on the disk for the sweep to read at its next ask, so nothing on the
machine calls home and no key of ours is ever on it. The newest fourteen
are kept, each recorded in the ledger, and the Computer page says when the
last one was made. A failed one is said to us and tried again the next
hour. Restoring from one is by hand for now. Shared drives, links into
other people's computers with permissions and live sync, come later; what
they need now is that files are plain files in a plain home on a plain
disk.

## Order of work

Each is one pull request, read before the next starts. As of 2026-09-08:

0. This decision and the field guide. Done.
1. The image. Done.
2. A computer at sign-in, with the lease, the tags, the ledger, the
   progress bar and the backfill. Done, live.
3. Opening it: every machine at its own address behind a door that takes
   a ticket from our sign-in, and the Open button. Done, live.
4. The browser tool as a package, with its scripted check. Done.
5. The numbers on the page: live charts, the storage number, open ports.
   Done, live.
6. Claude Code on every computer, the browser as its own MCP server on
   the machine, and the brain reached with the computer's session. Done,
   live.
7. Reset keeps home. Done.
8. Sizes. Done.
9. The disk grows itself. Done.
10. Claude Code on our key, and the switch. Done.
11. Backups. Done.
12. The key and the SSH front door. Done, and kept when VS Code came out
    on 2026-09-11.
