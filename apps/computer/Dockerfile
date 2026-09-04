# The bootstrap and the base in one: a Debian with the tools a person and
# their agent reach for, copied onto the volume on first boot and never
# used from the image again. Kept small, since the copy is the first boot.
# The pty is native code, built here and copied in, so nothing compiles
# on the machine.
FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /computer
COPY package.json .
RUN npm install --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg openssh-client less vim nano tmux \
      ripgrep jq unzip zip sudo procps iproute2 python3 \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code vercel pnpm && npm cache clean --force
WORKDIR /computer
COPY --from=build /computer/node_modules node_modules
COPY package.json server.mjs ./
CMD ["node", "server.mjs"]
