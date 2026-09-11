# What the person installs lands in their home and comes first: npm's and
# pnpm's globals, pip's user installs. Then ours, bound in from the image.
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$NPM_CONFIG_PREFIX/bin:$PNPM_HOME:$HOME/.local/bin:/opt/maslow/bin:/opt/maslow/node_modules/.bin:$PATH"
# An address a program opens is offered on the person's terminal, to open
# on their own device with their own logins.
export BROWSER=/opt/maslow/bin/open
