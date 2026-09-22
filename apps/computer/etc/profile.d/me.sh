# Our few tools answer to their own names first, so `claude` runs the copy
# in the image until the person's own is installed. Only those names are
# on that path, so everything else the person installs still wins: npm's
# and pnpm's globals, pip's user installs, then the rest of ours.
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="/opt/maslow/bin:$NPM_CONFIG_PREFIX/bin:$PNPM_HOME:$HOME/.local/bin:/opt/maslow/node_modules/.bin:$PATH"
# An address a program opens is offered on the person's terminal, to open
# on their own device with their own logins.
export BROWSER=/opt/maslow/bin/open
# Nothing on this machine calls home: the one word every tool honours.
export DO_NOT_TRACK=1
# A word on the way in: once per shell, for a person at a terminal and
# never for a program.
[ -n "$PS1" ] && [ -t 1 ] && [ -z "$MASLOW_WELCOMED" ] && {
  export MASLOW_WELCOMED=1
  /opt/maslow/bin/welcome
}
