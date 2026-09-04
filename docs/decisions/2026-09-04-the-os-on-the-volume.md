# The operating system is on the volume

2026-09-04

A computer whose installs vanish at every boot is not a computer. The image
now carries a whole Debian with the tools a person and their agent reach
for: node, git, gh, Claude Code, the Vercel CLI, build tools, editors. On
the first boot the daemon copies the image's root onto the volume, once;
on every boot it binds the kernel's views into that copy and every shell
runs inside it, as root, at home. `apt install`, `npm i -g`, `gh auth
login`, `vercel login`, dotfiles: all of it lands on the volume and stays.

**The person's files are root's home** in that operating system. The
Computer page is that home; a shell can go anywhere.

**The daemon still runs from the image.** It is what copies, binds and
serves; a new image brings a new daemon and nothing else, since the
operating system on the volume is never overwritten. Updating that
operating system on a schedule is a later change.

**Backups cover home**, not the operating system: what was installed can be
installed again, what was made cannot. The first-boot copy is a minute or
so; the page says the computer is being set up until it is.

**A laptop has no operating system on the volume.** The fake machine's
shell is the laptop's own, with its home on the fake volume, because the
field guide forbids Docker in development.
