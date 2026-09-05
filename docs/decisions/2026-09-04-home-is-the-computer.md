# The person's home folder is their computer

2026-09-04

The person is an ordinary user in the operating system on the volume:
`me`, uid 1000, at home in `/home/me`. That home is the disk the Computer
page shows and where every shell opens, as them. What they install and
sign into lands there and stays: npm's globals go to `~/.npm-global`,
pnpm's to `~/.local/share/pnpm`, pip's to `~/.local`, and gh, Claude Code,
Vercel, git and ssh keep their sign-ins in the home as they always did.
Claude Code updates itself into the home's npm prefix.

**sudo is for the package managers, and nothing else.** `apt`, `apt-get`
and `dpkg` run as root without a password; anything else is refused on the
spot, with no password to ask for. `sudo rm -rf /usr` is refused. A package
manager run as root can in principle do anything, so the rule is a guard
against a slip, not a wall; the wall is the reset below. The daemon's own
environment, and the machine's secret in it, is root's and unreadable from
a shell.

**The system beside the home can be reset.** "Reset the system" on the
Computer page puts a fresh operating system from the image around the home
as it is: the home is backed up first and the reset waits for that — a
backup finished within the hour stands, since none can be taken within an
hour of it — every shell closes, the old system is set aside, the home is taken out of it,
the rest is deleted and the image is copied onto the volume the way a
first boot does. Cut off anywhere, the next boot finishes it. The page
says how it went — done at a time, refused with nothing changed, or
stopped partway — never nothing. A laptop has no system to reset and says
so, after the backup. Nothing else we control repairs a disk
without a backup first; restore stays onto an empty disk only, so there is
nothing there to back up.

**A backup on demand**, at most one an hour whoever asked for the last
one, said plainly when refused. The sweep still asks daily; seven are kept
whoever asked. One backup at a time per person, and none within an hour of
the last, is the database's rule; the daily cadence is the sweep's, and a
backup on demand counts as the day's. A backup is a stream from the daemon
that started it: a daemon that boots had none on its way, and says so, so
the row it left open is let go of and another can be taken.

**The Finder hides what a Mac hides.** A name beginning with a dot —
`.bashrc`, `.cache`, `.local` — is on the disk, in the shell and in the
daemon's listing for the tools, and not on the Computer page.

**The package lists are the system's own.** The image carries none, so a
boot brings the system's up to date in the background, and the first
`sudo apt-get install` on a fresh machine finds its package. The last
reset's outcome is kept beside the operating system, so a boot that
finished a reset cut off can still say it was done.

**Disks from before.** A system copied from an older image has the base
image's `node` user at uid 1000 and the person's files in root's home. On
the first boot of this daemon the user is renamed to `me`, root's home is
moved into `/home/me` once — root's own dotfiles that were never touched
stay behind, so the home keeps its own — and everything in the home is
made the person's. The sudo rule, the profile that puts the home first on
the path, and pip's setting are put into the system on the volume from the
image on every boot, so a disk from before has them too.

Reversed: every shell runs as root, and the person's files are root's
home (2026-09-04, earlier the same day, in "The operating system is on the
volume").
