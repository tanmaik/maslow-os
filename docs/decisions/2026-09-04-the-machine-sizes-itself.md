# The machine sizes itself

2026-09-04, the ladder made two-way on 2026-09-05

Nobody chooses a size. A machine reports what it has and needs every five
minutes, and the size it runs at is chosen from that: up aggressively, so
there is always enough; down conservatively, so it cannot flap.

**Need is measured by the daemon.** Its report carries, beside the disk, the
machine's memory and how much is available, how many processes the kernel
killed for want of memory since boot, the one-minute load over its cores,
and how many terminals are open on it. Each is read where the kernel says
it and left out where it does not; a laptop's daemon says what it is told.
The row keeps the last three hours of reports: the share of memory free and
the load at each.

**Up.** One report with under 25% of memory free, or load over 1.0 at two
reports in a row, or any process killed for want of memory, wants the next
rung; under 10% free wants two. It happens at the next quiet moment, and at
once after a kill, since the alternative is crashes. While it waits, the
Computer page's status bar says "more memory is on its way" and offers
"Restart with more memory now", which goes at once.

**Down.** Three hours in which every report had over 70% of memory free and
load under 0.2, none of it within three hours of the last change of size,
allows one rung down, at a quiet moment, never below the first rung. It
says nothing on the page; the usage page's runs say the machine "had room
to spare and came back smaller".

**A quiet moment** is a report less than ten minutes old with no terminal
open and load under 0.5 for its minute.

**The ladder.** Fly presets, smallest first, priced per second from Fly's
list on the day this was written:

| Size                | Per second  | About a month |
| ------------------- | ----------- | ------------- |
| shared-cpu-1x:1024  | $0.00000228 | $5.99         |
| shared-cpu-2x:2048  | $0.00000456 | $11.98        |
| shared-cpu-4x:4096  | $0.00000913 | $23.99        |
| performance-2x:8192 | $0.00003286 | $86.36        |

The last rung is as far as it goes.

**A change of size is a cold boot on the same disk.** The reason goes on
the record (`out-of-memory`, `short-of-memory`, `room-to-spare`,
`asked-bigger`), then the machine's own record of its stops at Fly's time,
then `destroyed`, then `resized` at the new size, then a machine is made at
that size on the same volume and started. What the old machine reported no
longer speaks for the new one, and the daemon brings back what was running.

**The person sees the machine.** The status bar names the size in words
with the last report's figures — "1 shared CPU, 1 GB memory · CPU 12% ·
memory 41% used" — and, for a day after a size-up, "sized up to 2 GB at
10:14 so nothing ran out", or ", as you asked".

**The meter follows.** Every event carries the size it happened at, so each
running stretch is priced at the size that began it, and a month that
spans a resize is right. The sweep cuts its rows at the turn of a month, so
a month's figure is the sum of that month's rows and never a guessed share
of one that straddles the date.

Reversed: up only, and only when a look found the machine off (2026-09-04,
earlier the same day).
