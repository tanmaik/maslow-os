#!/bin/bash
# Boots the computer: the person's Linux and home onto the disk, the
# kernel's views and ours bound into it, then the SSH server outside and
# VS Code inside, as the person. Every step is safe to run again, so a
# boot cut off anywhere is finished by the next.
set -euo pipefail

DISK=/data
OS=$DISK/os
HOME_DIR=$DISK/home

# The image's own Debian becomes the person's Linux, copied once, one
# entry at a time so nothing is ever half there.
if [ ! -e "$DISK/.os-ready" ]; then
  echo "copying the operating system onto the disk"
  mkdir -p "$OS"
  for entry in /*; do
    name=${entry#/}
    case $name in proc | sys | dev | run | tmp | data | opt) continue ;; esac
    [ -e "$OS/$name" ] && continue
    rm -rf "$OS/$name.copying"
    cp -a "$entry" "$OS/$name.copying"
    mv "$OS/$name.copying" "$OS/$name"
  done
  date -u +%FT%TZ >"$DISK/.os-ready"
fi
mkdir -p "$OS"/{proc,sys,dev,run,tmp,opt/maslow,home/me}
chmod 1777 "$OS/tmp"

# The home is its own folder on the disk, so a reset of the Linux never
# touches it. A new one starts from the skeleton.
if [ ! -d "$HOME_DIR" ]; then
  mkdir -p "$HOME_DIR"
  cp -a /etc/skel/. "$HOME_DIR"
  chown -R 1000:1000 "$HOME_DIR"
fi

# The machine is called computer, so a prompt reads me@computer.
hostname computer || true

# What the person's Linux sees: the kernel, ours read-only, their home.
for d in proc sys dev; do mount --rbind "/$d" "$OS/$d"; done
mount -t tmpfs tmpfs "$OS/run"
mount --bind /opt/maslow "$OS/opt/maslow"
mount -o remount,bind,ro "$OS/opt/maslow"
mount --bind "$HOME_DIR" "$OS/home/me"

# The deployment's own files, current from the image on every boot.
for f in etc/resolv.conf etc/hosts etc/sudoers.d/me etc/profile.d/me.sh etc/pip.conf; do
  cp "/$f" "$OS/$f"
done
chmod 0440 "$OS/etc/sudoers.d/me"
echo "127.0.1.1 computer" | tee -a /etc/hosts >>"$OS/etc/hosts"
# Every interactive shell, login or not, gets the person's PATH.
grep -q profile.d/me.sh "$OS/etc/bash.bashrc" ||
  echo '. /etc/profile.d/me.sh' >>"$OS/etc/bash.bashrc"
# The SSH server drops `me` into their Linux only while its root is
# root's and not writable by others; whatever root inside did to it, a
# boot puts that back.
chown root:root "$OS"
chmod 755 "$OS"

# VS Code starts plain: no welcome page, no AI panel, dot files hidden, a
# port that opens shows inside VS Code. Written once; the person owns it
# from then on.
SETTINGS=$HOME_DIR/.local/share/code-server/User/settings.json
if [ ! -e "$SETTINGS" ]; then
  mkdir -p "$(dirname "$SETTINGS")"
  cp /opt/maslow/etc/settings.json "$SETTINGS"
  chown -R 1000:1000 "$HOME_DIR/.local"
fi

# The image carries no package lists; the person's Linux fetches its own
# behind the boot, so the first install finds its package.
chroot "$OS" apt-get update -qq >/dev/null 2>&1 &

# The SSH server's identity lives on the disk; keys that open it are
# written beside it by the app.
mkdir -p /run/sshd "$DISK/ssh" "$DISK/keys"
[ -e "$DISK/ssh/ssh_host_ed25519_key" ] ||
  ssh-keygen -q -t ed25519 -N "" -f "$DISK/ssh/ssh_host_ed25519_key"

# Each server is kept running; what ends is started again.
keep() {
  while :; do
    "$@" || echo "$1 ended with $?"
    sleep 1
  done
}
keep /usr/sbin/sshd -D -e -f /opt/maslow/etc/sshd_config &
keep chroot --userspec=1000:1000 --groups=1000 "$OS" \
  /usr/bin/env -i HOME=/home/me USER=me LOGNAME=me SHELL=/bin/bash LANG=C.UTF-8 TERM=xterm-256color \
  AUTH="${AUTH:-none}" PASSWORD="${PASSWORD:-}" \
  /bin/bash -lc 'cd && exec code-server --host :: --port 8080 --auth "$AUTH" --app-name Maslow --disable-telemetry --disable-update-check --disable-workspace-trust --disable-getting-started-override /home/me' &

trap 'kill 0' TERM INT
wait
