# 2026-09-04 — a profile photo and a logo are in the bucket

The owner: profile photos and org logos "are part of the bucket", so they are
metered like everything else in it.

A photo or logo is saved with its size and the moment, on the person's row
and every membership's copy for the photo, on the org for the logo. The
meter reads them as byte-seconds over the window, and live bytes. A photo is the member's, on their line. The logo belongs to
the org, and the org's owner pays for the org, so it is on the principal's
line: whoever holds the org pays for its logo, and it moves with a handover.

Replacing one deletes the object it replaces. The route meters the member to
that moment first, so the replaced bytes are in the ledger to the second; the
transaction that forgets the old key owes its deletion as an orphan, paid at
once and retried by the sweep, so a delete that refuses never leaves an object
nobody records. Deleting an org owes its logo the same way; a person's photo
outlives any one membership and is never deleted for one.

Keys are no longer the bytes' hash alone: two people saving the same bytes
shared one object, and the first to replace theirs would have taken the
other's. Every put makes a key of its own.

A person in several orgs is shown, and charged for, their photo in each. A
photo or logo saved before this carries no size and is not metered until it
is replaced.
