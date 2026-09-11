#!/bin/bash
# The person's terminal: one tmux session, main, made with Claude Code in
# its first window when it is not there yet, and joined from the Terminal
# page or over SSH. The page attaches to it. SSH joins as a session
# grouped with it, so a Mac's terminal and the page each keep their own
# size and current window while sharing every window, and the grouped
# session goes when its SSH does; main stays. Claude Code is the first
# window's command, given when the session is made rather than as tmux's
# default command, which would start it in every window opened after.
#
# When Claude Code exits it leaves the terminal as it was, modes like
# mouse tracking still on, so the shell that follows gets a terminal reset
# whole (ESC c) and one plain line on how to start it again. The shell
# around it survives a Ctrl-C that lands before Claude Code has taken its
# own, which Claude Code still gets: a trap is not inherited.
FIRST='trap : INT; claude; printf "\033c"; echo "Claude Code exited. Type claude to start it again."; exec bash'
cd
case ${1-} in
  page) exec tmux new-session -A -s main "$FIRST" ;;
  ssh)
    tmux has-session -t main 2>/dev/null || tmux new-session -d -s main "$FIRST"
    exec tmux new-session -t main \; set-option destroy-unattached on
    ;;
  *) echo "terminal.sh: page or ssh" >&2; exit 64 ;;
esac
