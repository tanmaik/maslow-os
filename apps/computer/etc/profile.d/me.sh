# What the person installs lands in their home and comes first: npm's and
# pnpm's globals, pip's user installs.
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$NPM_CONFIG_PREFIX/bin:$PNPM_HOME:$HOME/.local/bin:$PATH"
