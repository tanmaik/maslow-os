# 2026-09-14 — the heartbeat

The agent runs on its own. Every so often, on a clock the person set, and
whenever they press Run now, their computer starts Claude Code as them
with nothing but a brief, and it does what it finds worth doing with
their brain, their apps and their machine, then stops. That run is the
heartbeat.

## Why

Everything the agent does today, a person starts: a message in the Agent
window, a terminal, a tool call from Claude Code on their laptop. The
brain fills, the desk changes, a note appears, only while someone is
typing at it. Tanishk, 2026-09-14: the product is "too human-in-the-loop"
and should be "more magical" — things should "just automatically pop up
on my screen if they're deemed important." The person cannot be the
clock. The machine already is one: it never sleeps, it is them, and it
holds their brain and their apps.

## What a heartbeat is

- **A run, not a daemon.** Each heartbeat is one `claude -p` session,
  started by the door as the person, in their Linux, from their home, on
  a session of ours (`MASLOW_AUTH=managed`) so it never spends what they
  provided. It knows what any session of theirs knows: the brain and the
  browser as MCP servers, the notice tool, their files and tools. It ends
  when the agent stops, or at an hour; twenty minutes was the first
  ceiling, and a first run that reads a mailbox went past it every time. What it spends is capped by
  the weekly cap on the person's key and nothing else: a per-run dollar
  budget was tried and dropped on 2026-09-15, since Claude Code cannot
  price the models our key pays for and its guess tripped the budget in
  minutes. Nothing waits on its answer and nothing reads what it prints;
  what it did is in the brain's log and on the disk, like any session.
- **A share wakes it.** A run has a reason, and the brief says it: the
  clock came round, the person pressed Run now, or someone shared
  something with them. When a share lands — from the brain's pages, a
  chosen set, or an accepted ask — the app asks the computer of everyone
  it reached for a run now, naming who shared what by id alone — a
  title or a name a colleague wrote is data the agent reads through the
  brain's tools, never words in the run's own brief — so their agent can
  read it and decide, within seconds, whether it belongs on their desk.
  The sharer's own is not woken; a computer whose cadence is Off is not
  woken either, since Off means the agent does nothing on its own. An
  ask the person answers wakes their own agent the same way, told which
  ask, so what it asked for is acted on when they answer and not at the
  next tick of the clock. A reason that arrives while a run is going
  waits for the run after it.
- **The brief is mechanisms.** `/opt/maslow/etc/heartbeat.md` says what
  is here — that nobody started the run, what the brain's tools are, how
  to leave a note or ask a question, that `~/.maslow/heartbeat/` is its
  own and lasts between runs — and nothing of what matters, how much to
  write, or when to speak. That is the agent's judgment, as everywhere
  else in Maslow; a person who wants it to behave a certain way tells it
  in their home, in a `CLAUDE.md` or a file in that folder, in their own
  words.
- **The cadence is the person's.** A row on Settings → Computer: Off, 15
  min, 30 min, Hourly, Daily, and Run now. Off is the default and loses
  nothing: every page for writing and reading a brain by hand is the same
  with the heartbeat off. How much a person hands to the agent is theirs
  to decide, and onboarding will ask.
- **One at a time, and the clock is on the disk.** The door runs one
  heartbeat at a time; Run now while one is going is refused in the
  door's words. How often, whether one is going and what came of the
  last live in `/data/.heartbeat.json`, outside the person's Linux, so a
  machine restarted or remade for an update keeps its clock, and the
  first run after a boot waits a minute for the browser to be up. The
  app writes the cadence on the computer's row, gives it to the door
  when it is set, and gives it again every hour in the sweep, so a
  machine made fresh has it within the hour.
- **The machine says what happened.** `/maslow/stats` carries the
  heartbeat beside the numbers: the row shows running since when, or
  when the last ran and how long it took, and the end of what a run that
  did not finish printed. The ledger carries nothing new: what a run
  spends is on the person's key, which the sweep already reads.

## What it is not

- Not a place for the product to put instructions. A heartbeat that
  ships with "check your inbox" or "arrange the desk" is a feature we
  wrote, running on their machine; those are the agent's calls or the
  person's asks.
- Not a queue, not a report. Nothing lists the runs; the log and the
  brain already say what changed and who changed it.
- Not the sweep. The sweep is ours, hourly, about resources; the
  heartbeat is theirs, on their clock, about their work.
