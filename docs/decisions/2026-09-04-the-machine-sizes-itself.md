# The machine sizes itself

2026-09-04

Nobody chooses a size. A machine reports what it has and needs every five
minutes, and the size it is made at next is chosen from that.

**Need is measured by the daemon.** Its report carries, beside the disk, the
machine's memory and how much is available, how many processes the kernel
killed for want of memory since boot, and the one-minute load over its
cores. Each is read where the kernel says it and left out where it does
not; a laptop's daemon says what it can. The row keeps the last report and
the share of memory free at each of the last few.

**The rule.** Memory under 15% available at each of the last three reports,
or any process killed for want of it, wants the next rung. Load is recorded
and not yet acted on.

**The ladder.** Fly presets, smallest first, priced per second from Fly's
list on the day this was written:

| Size                | Per second  | About a month |
| ------------------- | ----------- | ------------- |
| shared-cpu-1x:1024  | $0.00000228 | $5.92         |
| shared-cpu-2x:2048  | $0.00000456 | $11.83        |
| shared-cpu-4x:4096  | $0.00000913 | $23.66        |
| performance-2x:8192 | $0.00003286 | $85.17        |

The last rung is as far as it goes.

**Only at a step boundary.** A running machine is never replaced. When a
look finds the machine off — stopped or suspended — and outgrown, it is
destroyed there, a `resized` event is written at the new size, and the
next attach makes a machine at that size on the same volume. A machine that
is absent is made at the size wanted. What the old machine reported no
longer speaks for the new one.

**The person sees the trade.** The Computer page's status bar names the size
in words, says when the machine has been sized up, and that waking from
sleep is quick up to 2 GB of memory and slower above it; while a bigger
size is wanted, it says what the machine comes back as.

**The meter follows.** Every event carries the size it happened at, so each
running stretch is priced at the size that began it, and a month that
spans a resize is right.
