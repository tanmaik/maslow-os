#!/bin/bash
# The person's terminal: one tmux session, main, a plain login shell in
# its first window, made when it is not there yet and joined from the
# Terminal page or over SSH. The page attaches to it. SSH joins as a
# session grouped with it, so a Mac's terminal and the page each keep
# their own size and current window while sharing every window, and the
# grouped session goes when its SSH does; main stays. Claude Code is the
# word `claude` away, at Tanmai's word on 2026-09-11.
cd
case ${1-} in
  page) exec tmux new-session -A -s main ;;
  ssh)
    tmux has-session -t main 2>/dev/null || tmux new-session -d -s main
    exec tmux new-session -t main \; set-option destroy-unattached on
    ;;
  *) echo "terminal.sh: page or ssh" >&2; exit 64 ;;
esac
