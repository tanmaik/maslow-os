# 2026-09-09 — the computer's surface is ours

Proposed, not settled. Written for Tanmai to argue with before any code
moves. It replaces the part of
[the computer returns](2026-09-07-the-computer-returns.md) that makes VS
Code the first door.

## VS Code comes out

code-server leaves the image. Not demoted behind a fold, not kept for
developers: out.

It cannot be used on a phone. A file tree, a command palette and an editor
built for a mouse do not survive a touch screen, and a product whose
promise is that a person's work is theirs wherever they are cannot have a
front door that only opens on a laptop.

Nothing it took with it needs replacing. Claude Code is on the machine and
runs on a key we minted, so a person sets their computer up by asking for
it. The editor, the file tree and the extension marketplace were never the
point. Only the routing it lent us has to be rebuilt, and that is one rule
about addresses, below.

Two smaller things go with it. "Ready" currently means code-server answers
a health check, and has to mean the door answers instead. And the port
links currently open code-server's proxy, which the address rule replaces.

## Everything talks to the door

The rule that decides how this feels: **the terminal, the files and the
browser talk to the machine's door directly.** Our server mints the ticket
and gets out of the way.

Our functions sit in Cleveland, beside the database. Anything routed
through them pays a trip to Ohio before it reaches the machine. The live
browser does that today, once per frame, so a person in London watching a
browser in San Jose pays London to Ohio to San Jose and back to see a
click land. Straight to the machine, in the person's own region, is a few
tens of milliseconds, which is what a terminal has to be to feel like
nothing.

One socket carries the lot: the terminal's keys and output, the files
that changed, and the browser's frames pushed as the page moves rather
than a picture fetched on a timer. The person's hands go back up the same
socket. Nothing polls.

The browser view is held to the same forty milliseconds as the terminal,
and is built to reach it rather than to approximate it.

Two things decide whether that is possible, and only one of them is the
codec. The first is the path: one socket, straight to the door, in the
person's own region, with frames pushed as the page moves and the hands
going back up the same socket. The second is that input is never made to
wait on a frame. A click is sent the instant it happens and the cursor
moves locally at once, so the picture catching up a moment later reads as
the page responding rather than as the product lagging.

The third is the picture itself, and it is video from the start. Not
whole images sent over and over, which is what the page does today and
what falls apart the moment anything on screen moves. Real video sends
what changed since the last frame, which is a fraction of the size, and
a moving page costs about what a still one does.

It does not need WebRTC to do that. The machine encodes video and sends it
over the same single socket everything else uses, and the browser decodes
it with the video decoder it already has built in. That is one hop, real
video, and none of WebRTC's apparatus: no negotiating a connection, no
relay server to run and pay for, nothing that struggles with the way Fly's
addresses work. It is the finished thing, not a stage on the way to one.

What WebRTC would add over this is grace under a bad connection: it sends
over a protocol that tolerates a lost packet, where ours stalls until the
lost piece is sent again. On a good connection they are the same. If poor
mobile connections turn out to matter, that swap is the transport
underneath, with the same encoder above it and the same decoder below, and
nothing a person sees changes.

The agent pays none of this. Claude reaches the browser over loopback on
the machine itself, so only the human view crosses a network at all.

The database's own distance is a separate problem with separate answers,
read replicas and optimistic writes among them, and it is not this
decision's to solve.

## It is one product, not a door to another one

The computer is part of Maslow and has to read as part of it. The same
navigation, the same components, the same typeface, the same words for the
same things. Nothing borrowed, nothing that announces itself as somebody
else's software the moment it loads. A person moving from their brain to
their computer should not feel they have left.

That is the whole reason code-server is going. Not that it is bad
software, but that it is unmistakably a different product wearing our tab,
with its own menus, its own icons, its own idea of what a file is, and no
way back to us.

Concretely, it lands on the canvas the rest of the product is moving to:
the dark warm ground, the chrome floating over it, Computer as one of the
four places beside Team, Brain and Settings, and every surface a card. The
browser leaves the tabs and lives here. Talk, Files and what is running
are cards on that ground, not a second application inside a page.

Two things elsewhere already lean on this. The prompt bar in the room
waits on a channel to Claude Code on the machine, which is the Talk pane's
socket. And a page shared from a computer is meant to appear framed on a
colleague's screen, which is the port work below.

## Sensible to start with, and never a trap

Everything we set up is a default, and every default can be walked away
from. The machine is an ordinary Debian: `sudo` needs no password,
anything installs, and nothing we put there stops them replacing it. We
give Claude an account to run on so it works the minute they arrive, and
one word moves it to their own. Their files are theirs and leave whole.
The one thing they cannot change is our own read-only corner of the disk,
because it is not theirs and is replaced from the image on every start.

The point of the defaults is that nobody faces an empty machine and a
setup guide. The point of the escape hatches is that nobody who outgrows
the defaults has to leave to get past them. Both, or it is a cage with
good furniture.

## A phone is every step, not one of them

Every surface here is drawn for a phone first and a laptop second, and a step
is not done until it works on one. Most of that is layout. One piece is not:
a phone has no Control, no Escape, no Tab and no arrows, and its keyboard
covers half the screen, so the terminal needs a row of keys of its own above
it. That is design work inside the terminal's step, not a media query.

## Machines do not live under the product's name

A machine's address must sit on a different registrable domain from the app,
not a subdomain of it. `SameSite=Lax` on the session cookie blocks
cross-_site_ requests, and a subdomain is the same site, so a page served
from somebody's machine and framed on your screen could call our own API
carrying your session. Sandboxing the frame closes it too, but that leaves
one attribute standing between a colleague's code and your account.

This has to be true before any port is shared. Changing it afterwards
invalidates every machine address in existence.

## Three plain things

The Computer page becomes three things, all ours, all drawn for a phone
first and a laptop second.

**Talk.** A terminal, opened by a ticket
rather than an SSH key, because the person is already signed in. Which
account it runs on is a control on the page, not only a command in the
terminal. The choice is already a file in their home read at
every start, their Anthropic sign-in already survives switching, and the
numbers already say which account is in use.

It has to be a real terminal, not a toy in a tab. Splits, several things
at once, and a scrollback that behaves. Closing the tab must not kill
anything: a build left running is still running, and reopening the page
finds it where it was, mid-output. Nothing a person started is ever lost
by navigating away.

That means the session lives on the machine and the browser only attaches
to it. `tmux` is already in the image and is exactly this: sessions that
outlive whoever is watching, and panes to split them. The door attaches to
it rather than starting a fresh shell. Splits are drawn by us and mapped
to its panes, so they look like the product rather than like ASCII lines,
and the state behind them survives regardless. The browser's side is a
real terminal emulator drawing on the GPU, which is the closest a tab gets
to a native one.

It behaves like a terminal a person already knows: the splitting and
tab-switching keys a good native one uses, not a set of our own. Its face
is a monospaced one shipped from npm inside the bundle, the way the
canvas ships Instrument Sans and Instrument Serif, so nothing is fetched
at build or at run.

They are themselves on it. The person is their own name at their org,
`wile@acme`, not `me@computer`. First names are already required and
already exist: where somebody gave none, the part of their email before
the `@` was written in, so there is always something to use and onboarding
does not change. The account number underneath never changes, and files
are owned by the number and not the name, so being renamed, or the org
being renamed, costs nothing on disk and touches nothing they own.

**Files.** A list of what is there, a rich preview of whatever it is, a
small edit, and somewhere to drop a file. Previews are made on the machine
and sent small: a thumbnail for a photo, a poster frame for a video, the
first page of a PDF, markdown rendered, code coloured. A phone must never
pull twelve megabytes to draw a postage stamp. Uploads go straight to the
door, never through our functions, which have a size and a time limit; and
they resume from an offset, because a phone on a train drops and nobody
starts a two gigabyte upload twice. The list follows the disk: when Claude
writes a file, it appears, over the same socket.

**Ports.** An address each: a request to `3000-<machine>.<domain>` reaches
port 3000 inside, beside the routing that already forwards another
machine's name over the private network. A label, not a path, so the app
sees itself at the root and its links and sockets are not rewritten under
a prefix. The wildcard certificate the machines already use covers it, so
there is nothing new to buy.

Discovery is already ours and stays: the door reads the kernel's own list
of listening sockets and names the process holding each. It should say
more than it does. Today it keeps the bare process name, so a dev server
reads as `node`. The full command is already read and thrown away, and the
page's title is one request away. A port should show as what it is.

### One port faces the internet

Fly exposes exactly one of the machine's ports, 8080, behind 443 at its
edge. That is the door and there is nothing else.

Everything else listens on loopback, which is the machine talking to
itself: a program listening there can be reached by other programs on that
same machine and by nothing else in the world, whatever the firewalls say.
That is where the browser's own server sits, on 8082, which is why Claude
driving a page crosses no network at all. It is also where whatever the
person is building sits.

So a dev server on port 3000 is not on the internet. It is a process on
loopback that the door may choose to carry traffic to. That is what makes
the sharing below enforceable: one entrance, and it decides. Were every
port exposed the way Fly can expose them, there would be no place left to
say no.

The terminal needs no port either. The door attaches to a session already
running on the machine and joins it to a socket. Nothing listens, nothing
new is opened, and no key is asked for, because the ticket already said
who they are.

### SSH comes out, and is built to come back

Reaching the computer from your own Mac's terminal goes away for now: the
SSH server, the public keys in settings, the socket that carried it and
the script we served as a ProxyCommand. Nobody has to set up a key to use
their computer, because the browser terminal asks for nothing.

It is written to come back well rather than left half-present. The shape
that lets it is the shape already here: one door, one ticket, and a
socket that carries whatever protocol we put in it. SFTP and SSH return
through that door on a ticket, the way the terminal does, rather than
through a second entrance with a second way of proving who you are. That
is a decision to make when someone needs it, not a stub to leave lying
around.

## A port is shared the way a record is

A port is the person's, seen by nobody else, until they share it. Built:
right-click a port in the list on the Computer page, pick Share, and tick
the people who may reach it: everyone in the org, a group, or a person by
name. What is ticked is exactly what the port reaches. There is no edit or
owner level, because a port is only ever looked at.

**Only with people, and only people who are signed in.** There is no link
that works for whoever holds it. Everyone who opens a shared port is a
member of an org with an account, and we know which one before anything is
let through. That closes off the whole class of problem where a link gets
forwarded, and it costs nothing we actually want: the person you meant to
show it to has an account already, or is invited and then has one.

It arrives where shared things arrive. A port shared with someone appears
on Maslow beside everything else shared with them, not as a link they have
to keep somewhere. Losing the message does not lose the access.

The agent asks for it the way it asks for a record. The same share tool
names a port beside records and types, at view because a port is only ever
looked at, and the ask lands under "waiting on you" beside the brain's
asks. Accepting gives the port in the person's name; the agent shares
nothing itself. The brain's door still reaches nothing on the machine: the
ask is a row, and the computer is only touched when the person says yes.

The ticket knows what a port is. It carries an expiry, the port it is good
for, and a signature over both. A visitor's ticket opens port 3000 and is
refused at the machine's own address, at any other port, and at everything
under `/maslow`. A ticket naming no port opens the whole machine and is
minted for its owner alone.

The check is ours and the traffic is not. The address a visitor follows is
on our own domain, so their session is already there to read. Our server
asks who they are, checks it against the share, and mints a ticket for
that one port. Everything after that goes straight to the machine, so
sharing costs a check and not a detour on every frame.

**The link carries no ticket.** What a person hands out is a plain address
on our own domain, `/port/<machine>/<port>`. If the link held a working
ticket, forwarding the link would forward the permission, which is the
whole thing we are avoiding. The ticket comes into existence only after our
server has looked at who is asking, and it travels in the address the
browser is then sent to.

**The door does not name the person.** It was built and taken out again.
Everyone let through a shared port sees the same thing, so the page has no
use for a name, and giving it one would be the only reason to hand it
anything about the viewer at all. What a page may see is settled before it
answers.

**A visitor's ticket is short, and this is forced.** Ending a share has to
end access, and the only other way to do that is for the machine to ask
our server whether a share still stands, which is the one thing a machine
never does. So a visitor's ticket lives for an hour, and going back to the
link mints a fresh one, passing our check again. The owner's own ticket
stays long, as it is now.

A shared port is other people's traffic on a machine somebody pays for.
Nothing records that yet: the ledger holds resource events, and a visitor
opening a port is not one of them until pricing needs it to be.

### Proxying it correctly

Correctness here comes from not transforming anything, and that is what
the address buys. Because the port is a label and not a path, the app
underneath is at the root of its own host: no HTML rewritten, no links
patched, no scripts adjusted, nothing scanned on the way past. The door
carries bytes and sets headers. That is the whole job, and it is why this
is the clean version and the path prefix was not.

What is left is a short list, and each item is a thing that breaks in
practice.

- **Sockets upgrade.** Anything modern holds one open for live reload
  alone. The door already upgrades a socket for its own use and has to do
  it for any port.
- **Nothing is buffered.** Streamed answers, server-sent events and long
  uploads pass through as they arrive, in both directions, or a page that
  streams appears to hang.
- **The app is told it is on HTTPS.** Inside it is plain HTTP, outside it
  is not, and a framework left to guess writes `http` into its own links
  and its cookies and breaks them.
- **The host is carried, not replaced.** Dev servers refuse hosts they do
  not recognise, which is the single most common way a proxy like this
  fails on the first try, so the machine's own name is passed and allowed.
- **Redirects are made relative to the outside.** An answer pointing at
  the address the app thinks it has would send the person nowhere.
- **Nothing is left holding.** A socket the person walked away from closes
  rather than living on as an open path into their machine.

## How big it is, and where it lives

These are the two facts a person owns about their computer, and both are
plain controls on the page. Neither is a developer's business. Both sit
on the page beside the numbers, SSH and a reset, all in the open.

Size is a ladder of CPU and memory, shown without a price, and changing
rung is a restart of a few seconds on the same disk. Nothing changes the
rung but the person. That much already works; it only has to be somewhere
a person will find it.

Region is the harder of the two, because a disk cannot move the way memory
can.

### North America only

Sixteen places, and no others: Ashburn, Atlanta, Boston, Chicago, Dallas,
Denver, Guadalajara, Los Angeles, Miami, Montreal, Newark, Phoenix,
Querétaro, San Jose, Seattle and Toronto. The picker knows Fly's other
nineteen and stops offering them.

### Forty milliseconds is the budget

A terminal has to echo a keystroke inside about twenty to forty
milliseconds of round trip to feel like a terminal and not like a bad
connection. That number, not the map, is what the region has to satisfy,
and it is stricter than a continent.

Coast to coast does not meet it. San Jose to Ashburn is roughly four
thousand kilometres, which is sixty to seventy milliseconds in real fibre,
comfortably outside the budget and plainly noticeable while typing. Being
on the same continent is not close enough.

Sixteen regions is what rescues it. They are dense enough that almost
anyone in the United States, Canada or Mexico is within a thousand
kilometres of one, which is inside twenty milliseconds. So the goal is
reachable for nearly everybody, and the only way to miss it is to be put
in the wrong one.

That is the whole case for measuring rather than guessing, and for the
move button. A misplacement is not a shrug. It is the difference between a
computer that feels local and one that does not.

### Guess once, then check against the only number that is free

The address a person arrives from decides where their computer is made.
Vercel already says the latitude and longitude of every request, the
picker already takes the nearest region from it, and it is right for most
people. One region is recommended, not sixteen ranked. Nobody is asked to
read a table before they have a computer.

Where a guess goes wrong it goes wrong quietly: a VPN, a corporate exit or
a mobile carrier puts a person's address somewhere they are not, and a
miss inside the same part of the country costs nothing while a miss across
the country costs the whole budget. So the guess is checked, and the check
costs nothing at all.

**The person's own machine is the measurement.** Once their computer
exists they talk to its door directly, many times a minute, and that round
trip is the number that actually matters. Nothing has to be built to
collect it and nothing has to be paid for to keep it. If it comes in under
forty milliseconds the guess was good and the page says nothing. If it
comes in above, the guess was wrong, and the page says so plainly and
offers the move.

That one real number is the only number shown. Nothing is guessed for
the regions the person is not in, because nothing can measure them
honestly. Beside it the page says the address the person arrived from,
the city that address is in when the request said, and the region nearest
it, by name: that is the recommendation, and the move button offers it.

Sixteen always-on machines answering pings would give sixteen real
numbers. They are not worth their standing cost. One free measurement that
arrives the moment it starts to matter is enough to catch every miss that
breaks the budget, which is the only kind worth catching.

### Moving is one button and then it is handled

A person picks a region and nothing else is asked of them. They do not
choose a disk, confirm a copy, or answer a question about what to keep.
They switch a location and we do the rest.

**Nothing of theirs is lost, and that outranks finishing the move.** The
order is fixed and it is the whole safety of this. The machine is stopped
first, so nothing is being written while the disk is read. The disk is
snapshotted. The snapshot is restored into the new region. A machine is
made on it there and has to answer its own door before it counts. Only
then is the old machine destroyed, and only then its disk.

Never the other way around. Until the new machine answers, the old disk is
the only copy of the person's whole Linux, and it is not touched. A move
that fails at any step rolls back to exactly what they had: the new volume
is thrown away, the old machine is started again, and they are running
where they were, having lost nothing but the minutes. The snapshot is kept
for a day after a move that worked, so even a fault we did not think of
has something to go back to.

It is minutes, not seconds, and the page names the step it is on rather
than showing a bar that means nothing. The disk arrives whole. Their
files, their packages, their whole Linux are the same bytes in a new
place, and nothing inside it can tell the difference.

We do not move anyone on our own. A trip is not a move, and a person who
spends a week in another city should not have their computer copied
because of it. What we do is notification: when someone's requests keep arriving
from a region inside the budget while their machine sits outside it, the
page says so and offers the button. Under forty milliseconds there is
nothing to offer and we stay quiet.

## A real editor, and one that is not VS Code

Files opens a real editor, not a text box: syntax colouring, several files
open, find and replace, a cursor that behaves. Editing a file is a thing
people do, and giving them a box with no colour in it would be the same
mistake as the file tree, made smaller.

It is not VS Code's editor. That one is built for a mouse, a keyboard and
a wide screen, weighs several megabytes, and is the reason we are leaving
code-server. What we want is the other kind: an editor made for touch as
well as a keyboard, a fraction of the weight, syntax for everything, and
no opinion about what surrounds it. It is a whole thing rather than a
shadcn component, which is the carve-out code-server had, and it earns it
the same way: it is an editor, and nobody hand-writes one.

## Programs with a picture come later, on the same pipeline

Terminal programs already work and will keep working: `vim`, anything with
a text interface, anything at all a shell can run. That is most of what
"a real program" means on a machine like this.

Programs that draw a window are a different thing, and the honest thing to
say is that they are the same thing as the browser view. A window needs a
display to draw on and a way to send the picture and the clicks; a browser
on the machine needs exactly that too, and we are building it. So a Linux
desktop in a tab is not a second capability to invent. It is the video
path pointed at a desktop instead of at Chromium.

Which is the argument for building that path properly rather than
cheaply, and for building it before anyone asks for this. It is not in
this decision's order. It becomes cheap once the order is done, and it is
expensive before.

## Not decided yet

A person's own Anthropic API key. The wrapper today offers our key or
their Anthropic sign-in, and blanks the API key variable, so someone who
bills their own API account has no way in.

## The order, and what each one is

Nine pull requests. Each stands alone, each is checked before the next, and
none of them points at a later one to finish it.

Steps 1 and 2 are the machine half of
[the room is placements of ports](https://github.com/maslow-tech/maslow/issues/205),
which builds the web half on top of them and defers the door to this order.
They meet exactly: its first step needs an address per port to frame
anything, and its second is the share below. Neither order builds the
other's half.

### 1. An address per port

**What it is.** A request to `3000-<machine>.<domain>` reaches port 3000
inside that machine. The port panel's links stop going through code-server's
proxy. Discovery says what is running rather than `node`.

**What changes.** `apps/computer/door.mjs`: `target()` learns a
`<port>-<machineId>` host label, on loopback for this machine and over the
private network for another's, refusing the four ports that are ours. Its
upgrade handler carries sockets for any port, not just its own. Requests
pass with the host carried, `x-forwarded-proto` set, nothing buffered,
redirects rewritten outward, and an abandoned socket closed.
`apps/computer/stats.mjs`: `ports()` keeps the command line it already reads
and throws away. `apps/web/app/computer/numbers.tsx`: each port links to its
own address, with the command beside it.

**What proves it.** A dev server started by hand on the machine opens at its
own address, its live reload keeps working, and a large upload through it
completes. `pnpm check` stays green.

**Not this one.** No sharing. No removing code-server.

### 2. A port is shared

**What it is.** A person right-clicks a port and gives it to people in their
org. They open a link and land on it. Everybody else, signed in or not, gets
a 404 that says nothing about whether there is anything there.

**What changes.** A migration for the shares, one row per port and whoever
it reaches, which the database enforces: only the computer's owner gives
one, only to a member or a group of their own org, or everyone in it, and
nobody sees a share that neither reaches them nor sits on their own computer. A route of ours, `/port/<machine>/<port>`, reads the visitor's
session, checks the share, mints a ticket for that one port and sends them
on; the link itself carries no ticket, so forwarding it forwards nothing.
`apps/computer/door.mjs`: a ticket names the port it opens and is refused at
the machine's own address, at any other port, and at everything under
`/maslow`.

**What proves it.** The owner and the person shared with are let through.
Another org's members and nobody at all get 404. A ticket for one port is
refused everywhere else on the machine. Saving the sheet with nobody ticked
cuts off the person who had it.

**Not this one.** No links that work without an account, ever.

### 3. Files on the door

**What it is.** The door can list a directory, read a file, write a file,
and take an upload that resumes.

**What changes.** `apps/computer/door.mjs` gains file endpoints behind the
same ticket the numbers already use. Paths are confined to the person's
home. An upload arrives in pieces at an offset and is assembled on the disk,
never held in memory. `apps/web/lib/computer.ts` gains the calls.

**What proves it.** A two gigabyte upload survives the connection dropping
and continues where it stopped. A path trying to escape home is refused.

**Not this one.** No page yet, no previews.

### 4. The Files page

**What it is.** A list of what is there, a rich preview of whatever it is,
a small edit, and somewhere to drop a file. Drawn for a phone.

**What changes.** A new page under `apps/web/app/computer`. Previews are
made on the machine and sent small: a thumbnail for a photo, a poster frame
for a video, the first page of a PDF, office files rendered to PDF. The
image gains what it needs to do that. A real editor for text and code,
touch-capable, not VS Code's.

**What proves it.** A photo, a video, a spreadsheet and a source file each
open on a phone. A list of a thousand files scrolls. An edit saves.

**Not this one.** No editing office files, which is a program's job, later.

### 5. One socket

**What it is.** The terminal, the files that changed, and the browser as
video, all on one socket straight to the door. Claude Code is already
running in the terminal when it opens.

**What changes.** `apps/computer/door.mjs` carries a socket that attaches to
a `tmux` session rather than starting a shell, so closing the tab kills
nothing. The terminal keeps a connection of its own: sharing one with the
video would let a frame in flight hold up a keystroke queued behind it,
which is the one thing a terminal cannot afford. The file changes ride with
the video. The browser encodes video rather than answering screenshots; the
existing `/maslow/browser` polling goes. The Talk pane, the View pane, and
splits drawn by us over tmux's panes. Input never waits on a frame.

**What proves it.** A build left running is still running after the tab
closes and reopens. A page scrolling in the machine's browser stays smooth.
Round trip inside one region is measured and under forty milliseconds.

**Not this one.** No WebRTC. The codec sits behind the socket and can be
swapped without touching what is above it.

**Built 2026-09-11, the machine's half.** The door carries two sockets on
a ticket for the whole machine: `/maslow/talk`, a `node-pty` terminal
running `tmux new-session -A -s main` inside the person's Linux as them,
a plain shell in its first window since 2026-09-11, when Tanmai chose it
over Claude Code starting by itself, so a closed tab detaches
and the next attaches; and `/maslow/view`, on which the browser server's
CDP screencast of its current tab is fed, one picture per change, into a
fresh ffmpeg per viewer making baseline H.264, told to start on its first
picture rather than gather seconds of them as it would for a file, muxed
as FLV so every tag is one whole picture, and sent as Annex B behind a
key-frame byte; a still page is drawn once for a new viewer, since the
screencast speaks only when the page changes. The tabs and which is
current ride the same socket, and a picked, opened or closed tab moves
the pictures to the current one with a fresh key frame. The pointer's
moves go on one request that stays open to the browser server and
straight to the page as mouse moves, so it hovers, and the cursor the
page wants under the pointer comes back by name. Acts go on to the
browser server and come back with their id; a folder of the home is
watched with `fs.watch`, settled for a quarter second; a ping is answered
at once. The browser server stops idling away, since nothing durable may
live in a tab. `$BROWSER` and `xdg-open` on the machine offer an address
on the person's terminal, and a click there opens it on their own device,
with their own logins; the machine's browser is the agent's. The `/maslow/browser` screenshot endpoints are gone.
Measured, driving the capture alone over CDP with twenty wheel scrolls
on a plain page: two shared CPUs give about two and a half pictures a
second, every call slow; two dedicated CPUs give one picture per scroll
with no lag, at least eight a second, limited by the test's own pace.
The capture keeps up with the hand when the CPU does, so smoothness is
the size the person picks. The door sends each picture within a third of
a second. Tried and not taken: the full Chromium's new headless mode,
which gave fewer pictures at twice the load; begin-frame control, on
which this headless shell's page dies at the first frame asked for; and
a lower JPEG quality, which halves the bytes and changes the rate not at
all.

**The browser is a real Chrome (2026-09-11, image `socket-4`).** The
headless shell announced itself as headless, and sites that turn bots
away turned it away: x.com refused outright. Now the full Chromium runs
headed on Xvfb, an X server that draws to memory and no screen, at the
view's own 1280x800, with nothing else changed about how it presents
itself: no stealth plugin, no spoofed fingerprint, no proxy, and
`navigator.webdriver` left as it is. It is opened at boot, so the first
look finds it ready. Checked on a Small machine over the View socket, the
frames decoded with ffmpeg: bot.sannysoft.com shows the user agent green
and every Fingerprint Scanner row green, with WebDriver, Permissions and
the WebGL renderer red, since those say the truth; x.com renders its
sign-in page; github.com's title is on the socket in under half a second
and its first frame in about a second. Twenty wheel scrolls on a text
page gave 17 frames a second, no worse than before. Chrome's processes
sum to about 1.2 GB resident (shared pages counted more than once) and
Xvfb 75 MB, with the whole machine at 680 MB used of 2 GB. A person's
hand works as a hand: the pointer's moves hover, the cursor becomes a
pointer over a link, and a click lands where it was aimed. Whether a
"verify you are human" box then passes is Cloudflare's judgement of the
machine's address as much as of the click: nowsecure.nl passed in two
seconds on the first hover-and-click; two managed challenges, on
scrapingcourse.com and nopecha.com, took the click, showed "Verifying…",
and came back with a new Ray ID and the box again, three times running.
A machine in a datacenter is judged as one, and nothing here pretends
otherwise.

### 6. The person is themselves, and SSH comes out

**What it is.** They are `wile@acme` on their own machine. Reaching it from
your own terminal goes away for now.

**What changes.** `apps/computer/boot.sh` names the account and the host
from what the machine is given. The SSH server, the keys in settings, the
socket that carried it and the ProxyCommand script are deleted.
`docs/dependencies.md` changes with it.

**What proves it.** The prompt reads `wile@acme`. Files keep their owner
across a rename, because Unix owns them by number.

**Not this one.** SSH does not come back here; when it does it comes back
through the same door on a ticket.

**Built 2026-09-11, the name half.** The app gives the machine `PERSON`
and `ORG`, the first name and the org's real slug cut to what Linux
takes, so the prompt reads `wile@acme-rockets` and follows a renamed org;
the boot renames whichever account holds uid 1000 inside the person's
Linux and sets the hostname before anything of theirs runs; `sudo` names
the uid. SSH stays, at Tanmai's word the same day: the server outside
keeps the account `me`, and `ssh computer` lands in the renamed one
inside, since both are the number. How SSH is set up is redesigned in a
later task.

### 7. Size and region are plain controls

**What it is.** Both sit in the open on the Computer page. Sixteen North
American regions, and no others.

**What changes.** `apps/web/app/computer/making.tsx` shows the region by
name beside the size. `apps/web/lib/region.ts` drops the other nineteen
regions.

**What proves it.** A person who opens nothing can see where their
computer is and how big it is.

### 8. The region is checked, and moving is offered

**What it is.** The guess is checked against the round trip to the person's
own machine, which costs nothing. Over forty milliseconds, the page says so
and offers the move. Moving is one button.

**What changes.** The Computer page records the round trip it already makes.
`apps/web/lib/computer.ts` gains a move: stop, snapshot, restore into the
new region, start, verify, and only then destroy the old machine and disk,
with a rollback at every step and the snapshot kept a day.

**What proves it.** A move lands with the same files. A move interrupted
halfway leaves the person running where they were.

### 9. code-server comes out

**What it is.** VS Code leaves the image.

**What changes.** `apps/computer/Dockerfile` and `boot.sh` stop installing
and starting it. Readiness stops meaning "VS Code answers" and means the
door answers. `apps/computer/seed.mjs` stops seeding its settings.
`docs/dependencies.md` and the computer's own decision doc change with it.

**What proves it.** A fresh machine is ready without it. The image is
smaller. Nothing in the product links to it.

**Not this one.** Nothing, this is the last of it.

**Built 2026-09-11.** `code-server` and its settings seed are out of the
image and the boot; `/maslow/health` answers when the door is up and the
browser server behind it answers; the machine's own root answers `ok`;
the Computer page's Open goes to `/computer/terminal`.
