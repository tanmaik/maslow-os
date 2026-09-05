# A computer from the first sign-in, running until it is powered off

2026-09-05

A person's computer is provisioned and powered on at their first sign-in,
runs until they power it off, and powers back on when they ask; it is
sized while it runs.

**Every org starts with computers on**, in production too. The database
default for `orgs.computers` is on; the sign-in that founds an org no longer
says. The switch in Settings stays as an owner's off-ramp for pausing an
org: off, no machine is made or started for anyone in it, every machine in
it is stopped by the sweep within the hour, and disks are kept until a
member is purged. The Computer page's "Computers are off for this org"
appears only then, and says an owner turned them off. Orgs that existed
before this change keep their switch as it was set.

**The first sign-in makes the computer**, behind the response: once the
session is opened, the filesystem is made if it is missing and a machine is
made on it and started, in `after()`, so sign-in never waits for Fly and a
failure there is logged and keeps nobody out. The row is recorded before
anything is made, as before; the lease on the row means a sign-in and a
first look racing make exactly one computer, and the look waits for the
one that holds it. A person opening their computer within a minute or two
of signing in finds it ready, or the daemon's "Your computer is being set
up; a minute." A wake, when Fly ever stopped one, is seconds; the first
make, with the operating system copied onto the volume, two to three
minutes, and it starts at sign-in so the page finds it done.

**Nothing puts a machine to sleep.** Every machine is made with
`autostop: "off"` and `autostart: true`: Fly's proxy never stops it for
idleness and starts it if it is ever off. A machine made before this
change still carries its old configuration — Fly cannot change a machine's
services without a restart — so it is replaced by the sweep the first time
it is found stopped or suspended, which, since it still autostops, is
within an hour of idleness; the new one runs on the same disk. A machine
on an image that is not the image answers no link of ours, so it is
replaced whatever it is doing, by the sweep or by the page's own look, and
the sweep makes and starts the replacement, so nothing a person has stays
down. A machine Fly holds made and never started is started like one it
stopped. Running all month at the
first size, one shared CPU and 1 GB, is about $6 at Fly's list price; the
usage page says so, computed from the price, and the Computer page's status
bar says "Stopped" for a machine Fly stopped, and "Powered off" for one the
person powered off.

**Money is said as a person reads it.** The top-right meter is one figure,
the month at this rate — "≈ $6 / month", cents below a dollar, "under 1¢ /
month" when tiny — and its hover is three short rows: so far this month,
right now, then the top sources by the hour. The usage page opens with the
same three figures in a strip and keeps its tables; the exact figure, to
four decimals, lives only in a table's cost column.

**Power off and Power on** are the person's, in the Computer menu beside
Back up now and Reset the system. Power off destroys the machine and keeps
the disk: Fly's own record of its stops goes on the record first, then
`destroyed` at that moment, so the meter stops there; the row's `off_at`
says it is off, and neither a look, a sign-in, the sweep nor the ladder
makes a machine while it is, and the daily backup passes it by, since the
disk is not changing. A power-off that failed partway leaves a machine
standing beside a row that says off; the sweep lets go of it within the
hour. The page then says "Your computer is powered off. Its disk and files
are kept; only the disk is charged." with a Power on button in place of the
file browser, since the listing needs the daemon. Power on clears the flag
under the row's lease, so six at once clear it once, and builds compute
again on the same disk, running. Asked for more memory while a build or a
resize holds the row, the computer says it is busy rather than pretending.
An owner's switch in Settings overrides both.

**The ladder goes both ways.** The daemon reports every five minutes: the
share of memory free, the one-minute load over its cores, what the kernel
killed for want of memory since boot, and how many terminals are open. The
row keeps the last three hours of reports. After each report, and at every
sweep, the ladder has its word:

- _Up_, aggressively: one report with under 25% of memory free, or load
  over 1.0 at two reports in a row, or any process killed for want of
  memory, wants the next rung — two rungs if under 10% was free. It happens
  at the next quiet moment, or at once after a kill, since the alternative
  is crashes.
- _Down_, conservatively: three hours in which every report had over 70%
  free and load under 0.2, none of it within three hours of the last change
  of size, allows one rung down, at a quiet moment, never below the first
  rung.
- A _quiet moment_ is a report less than ten minutes old with no terminal
  open and load under 0.5 for its minute.
- _Manual_: while a rung up is wanted and waiting for a quiet moment, the
  status bar says "more memory is on its way" and offers "Restart with more
  memory now"; that goes at once.

A change of size is a cold boot on the same disk: the machine's own record
of its stops goes on the record, then the reason (`out-of-memory`,
`short-of-memory`, `room-to-spare`, `asked-bigger`), then `destroyed`, then
`resized` at the new size, then a machine is made at it and started. What
the old machine reported no longer speaks for the new one. The daemon
brings back what was running on boot.

**The status bar shows the machine.** The size in words, then the last
report's figures — "1 shared CPU, 1 GB memory · CPU 12% · memory 41% used"
— and a word when a size-up is pending or, for a day after, happened:
"sized up to 2 GB at 10:14 so nothing ran out", or ", as you asked". A
size-down is quiet; the usage page's runs say why each machine came back.

**A person who never returns** holds a disk and, unless they powered it
off, a running machine at the first size. The rule for stopping or removing
untouched computers is a later decision; the owner names the number.

Replaces: orgs founded in production starting with computers off
(2026-09-04, "a usage page … owners switch computers on per org"); the
filesystem alone made at sign-in and compute at the first look, with Fly's
proxy suspending a machine after about a minute idle (2026-09-04, "The
volume is the disk"); a size change only while the machine was found off,
and up only (2026-09-04, "The machine sizes itself").
