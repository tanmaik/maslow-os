# Development runs the real thing, and the night cleans up

2026-09-04

The dev secrets now hold the preview Fly app's token, the bucket's keys and
the mail key, so `pnpm dev` makes real machines, stores real objects and
sends real mail. The fakes stay as what they always were: the fallback when
no secrets are present, never the default.

**Named for the checkout, purged every night.** Everything a laptop makes
on Fly is named `dev-<checkout>-`, everything in the bucket sits under
`dev/<checkout>/`, and the nightly reap destroys all of it. A row whose
volume is gone forgets it and the next look makes a new filesystem. What was
wrong yesterday is gone today; what matters is on main.

**A machine cannot reach a laptop.** Its reports and backups go to a URL
only the laptop can see, so on a laptop they fail and the console says so.
Everything else, waking, files, terminal, previews, is the real thing.

**Mail outside production goes to founders only**, enforced in the sender,
whatever the key can do.

Reversed: previews and local as the fakes' home (2026-09-04, earlier the
same day, in several decisions).
