# Our few tools answer to their own names first, so `claude` is the one we
# hand a key to rather than a copy installed over it. Only those names are
# on that path, so everything else the person installs still wins: npm's
# and pnpm's globals, pip's user installs, then the rest of ours.
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="/opt/maslow/bin:$NPM_CONFIG_PREFIX/bin:$PNPM_HOME:$HOME/.local/bin:/opt/maslow/node_modules/.bin:$PATH"
# An address a program opens is offered on the person's terminal, to open
# on their own device with their own logins.
export BROWSER=/opt/maslow/bin/open
