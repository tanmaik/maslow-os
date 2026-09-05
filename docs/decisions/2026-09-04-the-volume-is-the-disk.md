# The volume is the disk

2026-09-04

A person's files live on the Fly volume their machine mounts, and nowhere
else. The Computer page is that disk, read live from the machine: every
folder down the left, the one being looked at in the middle, the machine's
state along the bottom. Nothing about the disk is kept in the database.

**The daemon serves the disk.** The image runs one small server on the
volume: list, make, move, delete, put a file on from a URL, and hand a
browser a signed download. It answers to the machine's own secret.

**Fly's proxy wakes and suspends the machine.** Every machine has a public
service with autostart and autostop-to-suspend. The app reaches a machine by
id through the app's hostname (`fly-force-instance-id`), which starts it if
it is off; opening the Computer page is what turns the computer on. Nothing
has asked for it for about a minute — 74 seconds, when we timed it — and it
is suspended; the next request wakes it in a few seconds, and a terminal held
open keeps it awake. Nobody starts or stops a
machine by hand; there are no such controls. The sweep reads Fly's own event
log for each machine so a start or suspend the proxy made is metered to the
second.

**A download comes from the machine itself.** The app signs a link naming
the machine; the browser follows it to Fly, and a machine the proxy chose
wrongly replays the request to the right one (`fly-replay`). A file never
passes through Vercel.

**Uploads stage in the bucket, then land.** A browser cannot push 50 GB
through a serverless function, so a file still goes to Tigris in parts,
exactly as before; then the machine pulls it onto the disk and the staged
copy is deleted. The files table now holds only what is on its way. Tigris
is a staging lane and, next, the backup target for the volume; it is not
where files live.

**Development runs real daemons.** The fake Fly boots a daemon process per
machine on a scratch directory per volume, and plays the proxy: force by
instance id, wake on request, replay. The smoke walks a real disk.

**The layout looks ahead.** Files are served from the volume's root today;
the OS that will be copied onto the volume comes in a later change, and the
person's home moves with it.

Reversed: files as bucket objects with paths in a `folders` table
(2026-09-04, earlier the same day).
