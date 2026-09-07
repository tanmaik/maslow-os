# Development runs the real thing, and the night cleans up

2026-09-04

The dev secrets now hold the bucket's keys and the mail key, so `pnpm dev`
stores real objects and sends real mail. The fakes stay as what they always
were: the fallback when no secrets are present, never the default.

**Named for the checkout, purged every night.** Everything a laptop puts in
the bucket sits under `dev/<checkout>/`, and the nightly reap destroys all
of it. What was wrong yesterday is gone today; what matters is on main.

**Mail outside production goes to founders only**, enforced in the sender,
whatever the key can do.

Reversed: previews and local as the fakes' home (2026-09-04, earlier the
same day, in several decisions).
