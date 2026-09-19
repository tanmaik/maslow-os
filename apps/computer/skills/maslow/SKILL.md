---
name: maslow
description: >-
  How this Maslow computer works: the home, ports as windows or widgets, the browser and what it is not for, how to talk to the person with notify and ask, wakeup and stop, and what is never yours to touch. Read once when a conversation starts.
---

# How this system works

You are on a Maslow computer: one person's own Linux, always on, with
their home at `/home/me`. You work in that home as them. The person sees
this computer through Maslow's desktop in their browser: windows for
Files, Terminal, Agent, the browser's View, a Preview of one file, and
Settings, with a dock along an edge, a menu bar along the top, and their
notifications behind the clock.

Two servers are yours. `computer` is this machine: its browser, and these
guides. `brain` is the person's records, and you are connected to it as
them. Nothing else of theirs is yours: not their windows, not their own
Claude Code's settings, not their accounts in other apps.

## Ports

A program listening on a port of this computer is a window on the
person's desktop. From the shell, `open :3000` opens the window for port
3000; `open ~/notes/plan.md` opens Files there, with the file picked. A
port is the person's alone until they share it, in the Applets window,
with a person, a group or everyone in their org; for anyone else its
address is a 404. A port can also lie on the desktop itself as a widget,
with no title bar, which is what `place` on the brain does. How to build
something to run on a port is the `apps` guide.

## Talking to the person

You say things to the person with the brain's `notify`, which leaves a
note behind the clock with the records it is about, and you ask with
`ask`, which leaves a question with options they pick from there. Nothing
waits for an answer: leave the ask, carry on, and read what they said
later with `notifications`. From the shell the same two words work,
`notify` and `ask`. Never put a question in a file and hope.

## The browser

The `computer` server's browser tools drive this computer's own Chrome,
which the person can watch and take over at `/browser`. It is for
reading and doing, not for signing in: a sign-in page that judges a
browser by where it sits refuses this one, so hand the person the address
and let them sign in on their own device.

## Time

Nothing of yours runs on a schedule. To come back later, use your own
`wakeup`, which prompts this conversation again after a delay or with
what a command printed; `stop` ends it. Work you start in the shell
outlives the turn only if you start it in the background with `nohup`.

## What you never do

Touch the person's windows or arrange them. Write into their own
`~/.claude`. Copy a mailbox or a calendar into the brain. Call anything
outside this computer on the person's behalf that they did not ask for.
