# 2026-09-14 — updates are scheduled

A new image is an update, not a restart. The sweep no longer moves a
machine the moment its image is behind; it records on the computer's row
that an update is ready and to which image, and the person says when it is
taken.

## Why

Every computer is remade onto the image of the day at the first sweep
after the image moves. That is how Claude Code, the browser tool and the
door stay current without anything on a person's disk updating itself
behind them, and it was right while nobody was living on these machines.
It is wrong now: a restart takes the machine down for about a minute, and
it lands whenever we happen to push an image. A person mid-sentence in a
terminal, or with a dev server serving a colleague, loses both without
being asked.

Tanmai, 2026-09-13: "we should have an update system like MaslowOS." An
operating system does not restart while you are typing.

## What an update is

- **Ready, not taken.** The sweep finds a machine behind the image of the
  day, writes `update_image` and `update_ready_at` on
  its row, and writes `update ready` to the ledger. The machine is left
  alone. A newer image asks again: a choice made about the last one never
  carries an unseen change on.
- **Said in three quiet places.** A notification behind the clock; a
  line in the Maslow menu and in About This Computer; a row on Settings →
  Computer that says the image and offers **Update**. Nothing interrupts,
  and nothing takes an update on its own.
- **Update asks first.** A dialog names what will stop: every port
  serving, by number and by the program serving it, and every program
  running in a tmux window. Then the machine is remade onto the image and
  the pane watches it come back.

## What still restarts without asking

Everything the machine cannot run without: a size the person changed, the
person's own name, the brain coming within reach, a key being minted. Each
of those is a restart the person already asked for or a machine that is
wrong, and the image of the day comes with it.

## Where it lives

All of it is on the computer's row and in the ledger. Nothing about an
update is written to the machine, and the machine is never asked whether
it wants one: the door only says what is running.
