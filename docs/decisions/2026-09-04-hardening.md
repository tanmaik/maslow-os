# What three adversarial reviews changed

2026-09-04

Three reviewers, each with a fresh context, went at the Computer as a
first-time customer, as the person on call for it, and as an attacker. What
they found and what changed:

**A link wakes nobody unless it is real.** Every link a browser follows to a
machine (download, terminal, preview) is signed with a key the whole
deployment holds, `LINK_SECRET`, bound to what it is for and which machine.
Any machine checks it before a word is said to the machine it names; a
forged or stale link is refused where it lands. The preview cookie is a
signed link of its own, good for a day, `Secure`, and the plain port is
gone. A previewed app cannot set cookies on the hostname or replay.

**A machine's secret is the person's, not the org's.** It lives in
`computer_secrets`, readable by its owner, the machine itself and the sweep.
Nothing an org-wide query can reach opens a colleague's shell.

**Machines carry no project-wide secret.** The Vercel bypass secret is gone
from them; a preview's machines cannot reach us, exactly as a laptop's, and
say so.

**Production's bucket is production's.** Previews and laptops use a second
bucket with its own keys, `placeholder-uploads-dev`; production's keys sit
on the Production target alone. No key outside production reaches a
customer's backups.

**An org goes with everything, and owes first.** Deleting an org writes what
the vendors hold for it to the orphans ledger in the same transaction, then
cascades; the debts are settled at once and by the sweep.

**A disk grows when it is full, by one step.** Never on a number the machine
reported. A backup is one a day and no larger than twice the disk. A part
is 16 MB, so backing up does not squeeze a 1 GB machine.

**A boot never wipes.** The first-boot marker sits beside the operating
system, out of the shell's reach; a copy cut short is finished, and a boot
that cannot set up says so and tries again in a minute.

**One sweep at a time, on the database's clock.** An advisory lock, windows
from `now()`, and the sweep reconciles Fly's inventory against ours: an
unrecorded machine or volume is an incident in the log, a volume Fly lost is
forgotten, and a machine on an old image is replaced while it is off. That is
how machines are updated.

**A person's paths stay on the disk.** Symlinks are resolved and must land
under the root; a restore drops the links an archive carries. Downloads
resume. Dotfiles are the person's and are shown.

**The customer is told.** Every refusal is a sentence with its status, never
a bare 500; every outcome shows on the page; the uploader repeats what the
server said. A shell survives a page load: it is a session, picked up again
by id, kept half an hour without a socket. Deleting a folder asks. Every kept
backup can be restored, and a restore runs on its own with the page saying
so. The footer names the size and the place in words and shows the same
figure as the meter.

**Every machine has its own origin** (2026-09-05): `*.computers.maslow.tech`
and `*.computers-preview.maslow.tech` point at the two Fly apps with
wildcard certificates, and every link a browser follows goes to
`<machine>.<domain>`. A previewed app's cookies, storage and service
workers are its machine's alone. A link or cookie that names a machine
other than its origin's is refused.

**Still open:** a removed member's disk is kept until purged; there is no
reconciliation against invoices yet.
