# 2026-09-18 — a port can be public

A port on a person's computer opened to a person, a group or everyone in
the org, and was a 404 to anyone else. That held for what ports were for:
an app the agent built for the person, a widget on the desk, a colleague
looking at it. It failed the moment the port was an API. A program is not a
browser arriving through Maslow: a script on a laptop, a colleague's tool
on their own computer, a webhook from Stripe, none of them has a ticket or
a cookie, and the door refused them all. An API nobody can call is not an
API.

The fix is one more level, not a token scheme on the door. **Public** is a
subject the way everyone is: not a row of a person or a group, one word on
the share, given from the same sheet and the same ask. A public port opens
to anyone on the internet with the address, with no ticket and no cookie.
Every other port stays locked exactly as before, and a public port is
still only that port: nothing else on the machine opens with it.

Public means public. The address is guessable from the machine's id, so
whatever runs on a public port has to assume strangers will hit it. Who
may call is the app's to check, with whatever keys it hands out, and how
hard it may be hit is the app's to limit, which is how every API on the
internet works. The sheet says so in one sentence when the box is ticked.
A stranger on a public port does not count as the person at work at their
computer, so an update waiting on an idle machine still gets its turn.

The door learns which ports are public from our server, the whole list
each time a share changes and again every hour with the SSH keys, and
keeps it on the disk outside the person's Linux, so a door that comes back
still knows and nothing inside the Linux can add one. The agent asks for a
public port with the word `public` in the same share tool, a port alone,
at view, and the person accepts or declines it where every ask waits.

Rate limits, quotas and a domain of the person's own are not here. They
come when a public port is carrying real traffic and one of them is the
thing that hurts.
