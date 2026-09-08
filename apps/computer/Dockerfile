# The computer's image: a Debian that is both the outer machine and, copied
# onto the disk on first boot, the person's own Linux. Ours lives under
# /opt/maslow and is bound into theirs read-only on every boot: the boot
# script, the SSH server's settings, VS Code's web build, Claude Code, and
# the browser tool with its Chromium. Built from the repo's root, so the
# browser package comes along. Kept small, since the copy is the first
# boot.
FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config python3 libkrb5-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/maslow
COPY apps/computer/package.json .
RUN npm install --omit=dev
WORKDIR /opt/maslow/browser
COPY packages/browser/package.json .
RUN npm install --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server sudo ca-certificates curl git gnupg less vim nano tmux \
      ripgrep jq unzip zip procps iproute2 python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*
# The person: `me`, uid 1000, at home in /home/me. The base image's node
# user holds that id and becomes them. The account has no password and is
# not locked either: the SSH server refuses a locked one whatever the key.
RUN usermod -l me -d /home/me -m node && groupmod -n me node && usermod -p '*' me
COPY --chmod=0440 apps/computer/etc/sudoers.d/me /etc/sudoers.d/me
COPY --chmod=0644 apps/computer/etc/profile.d/me.sh /etc/profile.d/me.sh
COPY --chmod=0644 apps/computer/etc/pip.conf /etc/pip.conf
RUN visudo -cf /etc/sudoers.d/me
WORKDIR /opt/maslow
COPY --from=build /opt/maslow/node_modules node_modules
COPY --from=build /opt/maslow/browser/node_modules browser/node_modules
COPY apps/computer/package.json ./
COPY packages/browser/package.json browser/
COPY packages/browser/bin browser/bin
COPY packages/browser/src browser/src
# The browser tool's Chromium, headless, with what it needs from Debian,
# kept with ours so it is never on the person's disk.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/maslow/browsers
RUN cd browser && npx playwright install --with-deps chromium-headless-shell && rm -rf /var/lib/apt/lists/*
COPY --chmod=0755 apps/computer/boot.sh ./
COPY apps/computer/door.mjs apps/computer/stats.mjs apps/computer/seed.mjs apps/computer/backup.mjs ./
COPY apps/computer/etc/sshd_config apps/computer/etc/settings.json apps/computer/etc/mcp.json etc/
CMD ["/opt/maslow/boot.sh"]
