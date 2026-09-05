# The machine keeps to itself

2026-09-05

Ten reviewers went at the Computer, each along one dimension. The machine is
the person's, and they are root on it by design — `apt`, `apt-get` and `dpkg`
run as root there and stay that way. What that root reaches is the decision:

**A machine holds its own link key and no other's.** The deployment's key,
`LINK_SECRET`, never leaves the app. Each machine is made with
`LINK_KEY`, the deployment's key through that machine's name, and signs and
checks its links with that alone. A shell with root reads its own machine's
environment and finds a key that opens its own machine.

**A machine on an old image is replaced whatever it is doing.** It was
replaced only while it was off, which was tolerable when every image held
the same key and is not now: a machine from the last image answers none of
this one's links, so waiting for it to fall idle is waiting with a computer
that does not work. The sweep replaces it, and so does the page's own look,
so the first view after a deploy lands on the new image. The volume holds
everything and the next look makes the machine on it.

**A link for another machine is replayed unread.** No machine can check a
link it does not hold the key for, so a link naming another machine goes
there and is answered there. A forged link therefore costs a wake and buys
nothing; that is the price of the key not being shared, and it is worth it.
The wake is metered to the owner of the machine the link names. A link
past its expiry is refused where it lands and never replayed; a fresh forged
one wakes the machine, as any request to that machine's hostname would,
and the proxy suspends it again once it is idle. A rate limit on replays
would bound nothing, since the hostname wakes it too, and would refuse real
traffic on a deployment without a domain per machine, where every request
for one machine may land on another first.

**A terminal link names its session.** The session is inside the signature,
so one link opens the one shell it was made for, and the tab that owns a
session asks the app for its own link. A machine holds eight shells at once;
at the cap, the shell whose tab has been gone longest makes room for the
new one, and only when every shell has a tab is one refused. Sockets are
pinged every thirty seconds and closed when they stop answering, so a lid
closed on a terminal does not hold a shell or keep the machine from being
sized.

**A path is confined by its parent, not by its name.** The folder a path
sits in is resolved before the name is put back on it, so a symlink made in
the shell reaches nothing outside the home even when the name it points at
is not there yet. This is a check followed by a write, since Node has no way
to open a path one component at a time: a shell that swaps a folder for a
link in the instant between the two can make the daemon write outside the
home. Only the person's own shell can do that, on their own machine, where
they are root already; it is defence in depth, not a boundary.

**The daemon survives its clients.** Its death is the machine's — every
shell, server and job goes with it — so every socket and every spawned
process has its `error` heard, and what escapes a handler is logged rather
than fatal. A bad WebSocket frame and a spawn that fails are the client's
problem, not the machine's.

**A landing belongs to the id that started it.** Two files cannot share an
id, and an id cannot move to another path: either would land one person's
file with another's bytes. A reset waits for what is on its way onto the
disk rather than taking the home out from under it.

**A home in use can still be backed up.** `tar` says 1 when a file changed
while it was read and hands over a whole archive; that is a warning, not a
failed backup. A machine that is used is a machine with backups.

**The first copy of the system onto the volume is whole or absent.** Each
top-level entry is copied aside and moved into place, so a boot cut off
mid-copy leaves nothing half-switched and the next boot finishes the job.

**Nothing upstream outlives the browser that asked for it.** A preview
forwards to a port on the machine; when either end goes, so does the other.

**Still open:** the size ladder and the disk still trust what the machine
reports about itself; there is no ceiling on machines per deployment; and
`/proc` is bound into the chroot, which a root shell uses to read its own
daemon's environment — its own machine's, now, which is the point.
