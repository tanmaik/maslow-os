---
name: apps
description: >-
  How an app is built on this computer and shown: a folder in the home served on a port, run as the person in the background, looked at with the browser, then a window on the desktop or a widget placed on it. Read before building anything that runs here.
---

# Building an app here

An app is a folder in the home that serves on a port of this computer.
The person sees it as a window on their desktop, or as a widget lying on
the desktop itself. Read `boardui` before you write any of its screens.

1. Make it in a folder of the home, `~/apps/<name>`. Node, npm, Python,
   git and `sudo` without a password are here; install what you need.
   For a screen: `npm create vite@latest ~/apps/<name> -- --template react-ts`,
   then in that folder `npx boardui@latest init -y` and
   `npx boardui@latest add <the components you need>`.
2. Run it as the person, on `127.0.0.1` and a port above 1024, in the
   background so it outlives this turn, with its output in a file:
   `cd ~/apps/<name> && nohup npm run dev -- --host 127.0.0.1 --port 4310 >~/apps/<name>.log 2>&1 &`
   Then `curl -s http://127.0.0.1:4310 | head -3` to see it answers.
3. Look at it before you show it: `navigate` to `http://127.0.0.1:4310`,
   then `screenshot`, and fix what is wrong. Nothing restarts it after
   the machine restarts; say so, or leave a `start.sh` beside it.
4. Show it. As a window: `open :4310` from the shell puts the port's
   window on the person's desktop. As a widget: the brain's `place` with
   the `port`, a `title`, and where it lies as shares of the desktop,
   `x`, `y`, `w`, `h` from 0 to 1; `desktop` says what is already there
   and `unplace` takes one off. A widget has no title bar and fills its
   whole viewport with no margin or heading of its own: one surface made
   for a glance, not a page. The desktop is dark unless the person picked
   light, and BoardUI's tokens follow.
5. Tell the person with `notify`, naming the port. A port is theirs
   alone until they share it in the Applets window; to have it opened
   to a colleague, ask through the brain's `share`, which asks them.
6. Keep the desktop uncluttered: take off, with `unplace`, what is no
   longer worth a glance.
