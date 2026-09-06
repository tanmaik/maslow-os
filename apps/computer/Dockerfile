# The bootstrap and the base in one: a Debian with the tools a person and
# their agent reach for, copied onto the volume on first boot and never
# used from the image again. Kept small, since the copy is the first boot.
# The pty is native code, built here and copied in, so nothing compiles
# on the machine. Claude Code is installed here with the daemon's deps and
# bound into the operating system at boot, so it updates with the image.
FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /computer
COPY package.json .
RUN npm install --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg openssh-client less vim nano tmux \
      ripgrep jq unzip zip sudo procps iproute2 python3 python3-pip python3-venv \
    && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g vercel pnpm && npm cache clean --force
# The person: an ordinary user, uid 1000, at home in /home/me. The base
# image's node user holds that id and becomes them. sudo is for the
# package managers alone; what they install with npm and pip lands in
# their home.
RUN usermod -l me -d /home/me -m node && groupmod -n me node
COPY --chmod=0440 etc/sudoers.d/me /etc/sudoers.d/me
COPY --chmod=0644 etc/profile.d/me.sh /etc/profile.d/me.sh
COPY --chmod=0644 etc/pip.conf /etc/pip.conf
RUN visudo -cf /etc/sudoers.d/me
WORKDIR /computer
COPY --from=build /computer/node_modules node_modules
COPY package.json server.mjs ./
CMD ["node", "server.mjs"]
