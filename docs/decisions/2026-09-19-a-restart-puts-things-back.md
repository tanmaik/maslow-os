# A restart puts things back

2026-09-19. Tanmai: "on restarts can we make sure the processes spin back
up so it feels like nothing changed", and "when the computer is
restarting, grey out the whole computer and show that it is inactive".

## What a restart is

The machine is what a restart throws away: every process, and with it the
terminal's windows, the servers on ports, and the agents' processes. The
disk stays. The agents were already the door's to reopen, from the
session ids it keeps on the disk. The terminal and the ports were not.

## What comes back

The door remembers, every half minute, to `/data/.was.json`: each window
of the `main` tmux session with its folder, its name where the person
named it, and the job the terminal is given to, which the shell says by
its foreground process group, with the variables that job holds and its
shell does not, since those were on the line; and each server listening
on a port that is not under one of those jobs, once however many ports it
holds, with its folder and command. At the first boot after, once the
machine is ready, the door makes the session again, or adds to one that
holds nothing but the bare shell a terminal opens with, a window per
entry in its folder, names the named ones, waits for each window's
prompt, types each command back in with `send-keys` so it runs in view as
if the person had, and gives the servers that ran outside a window a
window of their own. A `claude` that was running comes back as `claude
--continue`. The file carries the boot id, written only once every window
was made, so a door that restarts without the machine puts nothing back
over a terminal that is still there, and a restore cut short is tried
again at the next boot.

What a process held in memory, and what a line carried besides its words
and its variables, a pipe or a redirect, is what a restart costs, and is
said so.

## What the person sees

The desktop asks after the ports every two seconds; a door silent to two
asks in a row greys the whole desktop under one card that says what the
computer is doing, in the Computer pane's own words and progress, and the
first answer clears it. The card is `apps/web/app/desktop/down.tsx`.

## Weighed

The door measures memory the moment the machine is first ready, before it
puts anything back: the image's own weight, sent with the stats as
`idleMb`. The sweep says so to us when it is over 2 GB, since most of the
growth in what a computer needs comes from what we ship.
