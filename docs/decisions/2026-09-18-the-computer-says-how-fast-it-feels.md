# 2026-09-18 — the computer says how fast it feels, live, and why

The Computer pane used to measure one number once: five round trips from
the browser to the computer's door when the pane opened, the best of them
shown beside the region. It answered "is my computer in the wrong place"
and nothing else. Asked why the desk felt slow on a given afternoon, it
had nothing to say.

A moment at the desk pays three different trips, and they slow down for
three different reasons.

- **You to your computer.** A keystroke in the terminal, a word to the
  Agent and every frame of the machine's browser go straight from the
  browser to the door and back; our server is not on the path. This is
  the forty-millisecond budget, and distance is what breaks it.
- **You to Maslow.** Every click on a page and every read of the brain
  goes to our server in Ohio and back, once. A person far from Ohio pays
  more here whatever region their computer is in, and nothing but a
  second region for the app would change that.
- **Maslow to your computer.** Files, the ports on the desktop and the
  numbers on the pane are asked of the computer by our server, so they
  pay this on top of the trip to Maslow. Ohio to a North American region
  is tens of milliseconds; it is the reason a folder listing can feel
  slower than a keystroke on the same machine.

The pane now times all three while it is open — the first every two
seconds, the other two every five — and shows the latest beside the best
of the last minute, which is the wire with the noise taken out. The
verdict at the top is written from the best trip to the computer: like a
terminal under forty, and the move offered above it. The rows are named
for what rides on each trip, so a person reads which part of their
afternoon is slow without knowing how the parts are wired.

Two doors were added for it, and nothing else: `/ping`, which answers
with nothing so a browser can time its trip to Maslow, and
`/computer/ping`, which has our server time the door and say the number.
The trip to the computer is still timed against the door's health, which
answers only once the machine's browser server has, so a computer whose
browser is stuck shows it here as well.

A busy computer slows everything on it whatever the distance; the CPU
and memory cards above these rows already say when it is, and this pane
says each thing once.
