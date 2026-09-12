# The computer's image: a Debian that is both the outer machine and, copied
# onto the disk on first boot, the person's own Linux. Ours lives under
# /opt/maslow and is bound into theirs read-only on every boot: the boot
# script, the door with the terminal it opens, the SSH server's settings,
# Claude Code, the browser tool with its Chromium and the display it
# draws on, the encoder that makes the browser into video, the 1Password
# CLI, and what pictures a file for the Files window.
# Built from the repo's
# root, so the browser package comes along. Kept small, since the copy is
# the first boot; the PDF renderer and the display are the pieces of that
# on Debian's side, the rest arrives from npm under ours.
FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config python3 && rm -rf /var/lib/apt/lists/*
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
      poppler-utils xvfb \
    && rm -rf /var/lib/apt/lists/*
# The person: uid 1000, at home in /home/me. The base image's node user
# holds that id and becomes them; the boot gives the account their own
# name on their own Linux, while the SSH server outside keeps `me`. The
# account has no password and is not locked either: the SSH server
# refuses a locked one whatever the key.
RUN usermod -l me -d /home/me -m node && groupmod -n me node && usermod -p '*' me
COPY --chmod=0440 apps/computer/etc/sudoers.d/me /etc/sudoers.d/me
COPY --chmod=0644 apps/computer/etc/profile.d/me.sh /etc/profile.d/me.sh
COPY --chmod=0755 apps/computer/bin/claude apps/computer/bin/claude-code-acp apps/computer/bin/auth apps/computer/bin/open /opt/maslow/bin/
COPY --chmod=0644 apps/computer/bin/auth-env /opt/maslow/bin/
COPY --chmod=0644 apps/computer/etc/pip.conf /etc/pip.conf
RUN visudo -cf /etc/sudoers.d/me
WORKDIR /opt/maslow
COPY --from=build /opt/maslow/node_modules node_modules
COPY --from=build /opt/maslow/browser/node_modules browser/node_modules
COPY apps/computer/package.json ./
COPY packages/browser/package.json browser/
COPY packages/browser/bin browser/bin
COPY packages/browser/src browser/src
# The browser tool's Chromium, the full browser, with what it needs from
# Debian, kept with ours so it is never on the person's disk. It runs
# headed on a display of its own (Xvfb, above) so that to a site it is an
# ordinary Chrome, not a headless one.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/maslow/browsers
RUN cd browser && npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
# What turns a document into a page we can show: LibreOffice, unpacked
# under ours rather than installed into Debian, so the whole of it is
# bound in read-only and never copied onto the person's disk. It reads its
# own configuration from two fixed places, which are links to ours. Debian
# ships its registry in a hidden folder and links each file into the
# place it is read from when the package installs; unpacking runs none of
# that, so the links are made here. The typefaces it draws with are
# Debian's, small and theirs to keep.
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-liberation2 fonts-dejavu-core \
    && apt-get install -y --no-install-recommends --download-only \
      libreoffice-writer libreoffice-calc libreoffice-impress \
    && mkdir -p /opt/maslow/office \
    && for d in /var/cache/apt/archives/*.deb; do dpkg -x "$d" /opt/maslow/office; done \
    && ln -s /opt/maslow/office/usr/lib/libreoffice /usr/lib/libreoffice \
    && ln -s /opt/maslow/office/etc/libreoffice /etc/libreoffice \
    && ln -s /usr/lib/libreoffice/share/.registry/*.xcd /etc/libreoffice/registry/ \
    && ln -s /usr/lib/libreoffice/share/.registry/res/*.xcd /etc/libreoffice/registry/res/ \
    && rm -rf /var/cache/apt/archives/*.deb /var/lib/apt/lists/*
# The 1Password CLI, from 1Password's own apt repository, unpacked under
# ours so `op` is on every person's path from the image and never on
# their disk. The person signs in to it themselves.
RUN curl -sS https://downloads.1password.com/linux/keys/1password.asc \
      | gpg --dearmor -o /usr/share/keyrings/1password-archive-keyring.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/amd64 stable main" \
      >/etc/apt/sources.list.d/1password.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends --download-only 1password-cli \
    && mkdir -p /opt/maslow/op \
    && dpkg -x /var/cache/apt/archives/1password-cli_*.deb /opt/maslow/op \
    && ln -s /opt/maslow/op/usr/bin/op /opt/maslow/bin/op \
    && rm -rf /var/cache/apt/archives/*.deb /var/lib/apt/lists/* /etc/apt/sources.list.d/1password.list
COPY --chmod=0755 apps/computer/boot.sh apps/computer/terminal.sh apps/computer/ssh-login.sh ./
COPY apps/computer/door.mjs apps/computer/stats.mjs apps/computer/seed.mjs apps/computer/backup.mjs apps/computer/files.mjs ./
COPY apps/computer/etc/sshd_config apps/computer/etc/mcp.json apps/computer/etc/tmux.conf etc/
CMD ["/opt/maslow/boot.sh"]
