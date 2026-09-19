# 2026-09-18 — computers behind one interface

Everything the app asks of the place its computers run is one interface
of ours, `Cloud` in `apps/web/lib/clouds.ts`, and each place is a file
under `apps/web/lib/clouds/` that implements it: Fly today,
`clouds/fly.ts`. A cloud is added, or taken away, in one file and one
line. The person sees no difference.

## Why

the customer wants Maslow inside their own AWS account, where a computer
cannot be a Fly machine. The field guide already says every vendor sits
behind an interface of ours, so a second supplier is a second
implementation and never a second code path. The computers were the one
vendor that did not: `fly.ts` was called by name from the computer, the
relay, sharing and five screens, every request to a machine's door built
Fly's address itself, and the app read machines in Fly's own shape. This
is the first step of the plan for the customer, and it ships to the product
as it is today.

## What it is

- **One interface, in our words.** A disk made, grown, copied and filled
  back from a copy; a machine made on it, reshaped to a newer image,
  started, stopped, restarted, tagged and destroyed; both listed; the
  relay's machine made and reshaped; and where a machine's door is
  reached. A machine is described as the product reads it, not as any
  vendor answers: running, stopped, changing or gone; its region, image,
  size, what it was told when made, its tags and its disks. A disk is
  ready, filling or gone, with its size; a copy of one is ready or not.
  Each implementation translates its vendor's answers into these.
- **One line picks the cloud.** The app imports `cloud` from
  `apps/web/lib/cloud.ts`, which names this deployment's implementation.
  Nothing else imports one.
- **The door is written once.** Every request this server makes to a
  machine's door is in `apps/web/lib/door.ts`, against the address and
  headers the cloud gives for that machine. On Fly that is the app's name
  on Fly's edge, told which machine by a header. How another cloud
  reaches a door is that cloud's to answer and changes nothing here.
- **Each cloud says where it can put a computer.** Its regions, each a
  name and a place on the earth, and its own guess at the region nearest
  this server are the cloud's; `apps/web/lib/region.ts` finds the nearest
  of them to the person and never names one. The page is handed the list
  by the server, so it holds none of its own.
- **Images are named by label.** The app names an image `door-76` or
  `sync-1`, and the cloud knows where its images are kept: on Fly, its
  registry. What the cloud answers about a machine comes back with the
  label. A migration renames an update already waiting in the database
  from Fly's whole address to its label, so the app only ever sees
  labels.
- **What the cloud refuses carries its name.** `CloudRefused` says which
  cloud answered, so the page still says "Fly answered 503", and a disk
  gone from under a machine is `DiskGone`, whichever cloud said so.
- **A check keeps it so.** `pnpm check:cloud`, part of `pnpm check`,
  refuses any app file other than `lib/cloud.ts` that imports from
  `lib/clouds/`, and any code that runs in the browser whose imports
  reach the cloud at all, however many files away, since that code is the
  server's. It names no vendor, so it holds for every cloud added after
  Fly.

## What it is not

- Not AWS. No code of it is here, and no deployment can pick anything
  but Fly or none.
- Not the machine or the scripts. The door, `apps/computer/door.mjs`, and
  the reap and its helper, `scripts/reap-computers.mjs` and
  `scripts/fly.mjs`, still speak to Fly directly; the reap reads each
  vendor's own list by design.
