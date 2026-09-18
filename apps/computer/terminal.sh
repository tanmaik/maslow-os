#!/bin/bash
# The person's terminal: one tmux session, main, holding every window.
# Every way in — a Terminal window on the desktop, another beside it, a Mac
# over SSH — joins as a session grouped with it, so each keeps its own size
# and its own current window while sharing every window, and goes when its
# way in does; main stays. A Terminal window on the desktop is named by the
# door, so the door can list its windows and turn it to one. One just
# opened starts in a new window of its own, a fresh shell; one coming back
# joins where the session stands and is turned to the window it was on by
# whoever opened it. A Mac over SSH is a shell like any other of theirs:
# a new window named ssh, listed on the desktop's Terminal and turned to
# from there like the rest, and closed when the connection is, with
# whatever was running in it.
cd
tmux has-session -t main 2>/dev/null || tmux new-session -d -s main
if [ -n "$TALK" ]; then
  if [ "$FRESH" = 1 ]; then
    exec tmux new-session -t main -s "$TALK" \; new-window -c "$HOME" \; set-option destroy-unattached on
  fi
  exec tmux new-session -t main -s "$TALK" \; set-option destroy-unattached on
fi
# Without a window of its own, a grouped session lands on the lowest-numbered
# window, whatever the desktop is doing there.
win=$(tmux new-window -d -t main -c "$HOME" -n ssh -P -F '#{window_id}')
tmux new-session -t main \; select-window -t "$win" \; set-option destroy-unattached on
# The connection closed; its shell goes with it, as a Mac's own would.
tmux kill-window -t "$win" 2>/dev/null
exit 0
