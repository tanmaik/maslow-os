# The computer comes out

2026-09-07

Everything that was the computer is gone: the Fly machine with a volume per
person and its daemon, the image, the Computer page with its file browser,
uploads, downloads, folders, terminal and port previews, the daily home
backups, the size ladder, the model gateway and the one model behind it,
Claude Code on the machine and its knock at the brain's door, the usage
page and the live meter, and the tables under all of it. The meter keeps
recording what remains — bytes in the bucket and the brain, recall vectors,
app actions — and nothing shows it.

**Why.** Tanmai: get rid of the computer before we cannot use it or it does
not do what we intended. The file browser and the bucket-staged upload path
were built for a browser, and a lost upload lingering on the page was the
last of several rounds of patching it. What the computer should be is
plainer: SSH and SFTP to a machine that spins up and down and sizes itself,
with files moved the way any Linux box moves them. That is built on purpose
later, not patched out of this.

**What stays.** The bucket, for profile photos and org logos, with its keys.
Every secret and token the computer used — Fly's, OpenRouter's, the link
secret, the machines domain — stays in `.env.development`, on Vercel and on
GitHub, unread, so the return needs no re-provisioning.

**What was destroyed by hand after the deploy.** The two production
machines, their volumes, the backups and staged uploads under `orgs/` in
the production bucket, and both Fly apps.

**Reversed.** The decisions of 2026-09-04 (home is the computer, the
volume is the disk, the OS on the volume, the machine sizes itself,
terminal and previews, backups, hardening), 2026-09-05 (a computer from the
first sign-in, the machine keeps to itself) and 2026-09-06 (Claude Code on
the computer). Git holds them.
