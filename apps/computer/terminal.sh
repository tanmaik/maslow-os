#!/bin/bash
# The person's terminal: one tmux session, main, holding every window.
# Every way in — a Terminal window on the desktop, another beside it, a Mac
# over SSH — joins as a session grouped with it, so each keeps its own size
# and its own current window while sharing every window, and goes when its
# way in does; main stays. A Terminal window on the desktop is named by the
# door, so the door can list its windows and turn it to one. One just
# opened starts in a new window of its own, a fresh shell; one coming back
# joins where the session stands and is turned to the window it was on by
# whoever opened it.
cd
tmux has-session -t main 2>/dev/null || tmux new-session -d -s main
if [ -n "$TALK" ]; then
  if [ "$FRESH" = 1 ]; then
    exec tmux new-session -t main -s "$TALK" \; new-window -c "$HOME" \; set-option destroy-unattached on
  fi
  exec tmux new-session -t main -s "$TALK" \; set-option destroy-unattached on
fi
exec tmux new-session -t main \; set-option destroy-unattached on
