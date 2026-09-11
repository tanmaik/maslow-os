#!/bin/bash -l
# Where an SSH login lands, inside the person's Linux as themselves: a
# plain login joins the terminal the Terminal page shows, a command given
# to ssh runs as it would in their shell, and a file app gets the file
# server it asked for.
export USER LOGNAME LANG
USER=$(id -un)
LOGNAME=$USER
LANG=${LANG:-C.UTF-8}
case ${SSH_ORIGINAL_COMMAND-} in
  "") exec /opt/maslow/terminal.sh ssh ;;
  internal-sftp) exec /usr/lib/openssh/sftp-server ;;
  *) exec bash -c "$SSH_ORIGINAL_COMMAND" ;;
esac
