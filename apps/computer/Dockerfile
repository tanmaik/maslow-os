# The computer's image: a Debian that is both the outer machine and, copied
# onto the disk on first boot, the person's own Linux. Ours lives under
# /opt/maslow and is bound into theirs read-only on every boot: the boot
# script, the SSH server's settings and VS Code's web build. Kept small,
# since the copy is the first boot.
FROM node:24-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config python3 libkrb5-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/maslow
COPY package.json .
RUN npm install --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-server sudo ca-certificates curl git gnupg less vim nano tmux \
      ripgrep jq unzip zip procps iproute2 python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*
# The person: `me`, uid 1000, at home in /home/me. The base image's node
# user holds that id and becomes them.
RUN usermod -l me -d /home/me -m node && groupmod -n me node
COPY --chmod=0440 etc/sudoers.d/me /etc/sudoers.d/me
COPY --chmod=0644 etc/profile.d/me.sh /etc/profile.d/me.sh
COPY --chmod=0644 etc/pip.conf /etc/pip.conf
RUN visudo -cf /etc/sudoers.d/me
WORKDIR /opt/maslow
COPY --from=build /opt/maslow/node_modules node_modules
COPY package.json ./
COPY --chmod=0755 boot.sh ./
COPY etc/sshd_config etc/settings.json etc/
CMD ["/opt/maslow/boot.sh"]
