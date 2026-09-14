#!/bin/bash
# Boots the computer: the person's Linux and home onto the disk, the
# kernel's views and ours bound into it, the person named as themselves,
# then the door outside and the browser as the person. Every step is safe
# to run again, so a boot cut off anywhere is finished by the next.
set -euo pipefail

DISK=/data
OS=$DISK/os
HOME_DIR=$DISK/home
# Who the person is on their machine, as the app gave it: their first name
# at their org, so a prompt reads wile@acme. A machine made by hand, given
# nothing or something Linux would refuse, is me at computer.
PERSON=${PERSON:-me}
ORG=${ORG:-computer}
[[ $PERSON =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || PERSON=me
[[ $ORG =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || ORG=computer

# A reset asked for through the door: the person's Linux is thrown away
# and copied fresh below; their home, its own folder, is not touched. The
# ask stands until the copy is whole, so a boot cut off mid-way finishes.
if [ -e "$DISK/.reset-asked" ]; then
  echo "resetting the operating system; home is kept"
  rm -f "$DISK/.os-ready"
  rm -rf "$OS"
fi

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
  rm -f "$DISK/.reset-asked"
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

# What the person's Linux sees: the kernel, ours read-only, their home.
for d in proc sys dev; do mount --rbind "/$d" "$OS/$d"; done
mount -t tmpfs tmpfs "$OS/run"
mount --bind /opt/maslow "$OS/opt/maslow"
mount -o remount,bind,ro "$OS/opt/maslow"
mount --bind "$HOME_DIR" "$OS/home/me"

# The person is themselves: the account with their number takes their
# name, and the machine is called after their org. Files are owned by the
# number, so the rename touches nothing of theirs, and nothing of theirs
# runs yet, so it is safe.
# A name Debian already uses for an account of its own, bin or man, is
# taken with a number after it rather than stopping the boot.
was=$(chroot "$OS" getent passwd 1000 | cut -d: -f1)
name=$PERSON
n=1
while [ "$(chroot "$OS" getent passwd "$name" | cut -d: -f3)" != "" ] &&
  [ "$(chroot "$OS" getent passwd "$name" | cut -d: -f3)" != 1000 ] ||
  [ "$(chroot "$OS" getent group "$name" | cut -d: -f3)" != "" ] &&
  [ "$(chroot "$OS" getent group "$name" | cut -d: -f3)" != 1000 ]; do
  n=$((n + 1))
  name="$PERSON$n"
done
if [ "$was" != "$name" ]; then
  chroot "$OS" usermod -l "$name" "$was"
  chroot "$OS" groupmod -n "$name" "$was"
fi
hostname "$ORG" || true
echo "$ORG" >"$OS/etc/hostname"

# The deployment's own files, current from the image on every boot.
for f in etc/resolv.conf etc/hosts etc/sudoers.d/me etc/profile.d/me.sh etc/pip.conf; do
  cp "/$f" "$OS/$f"
done
cp /opt/maslow/etc/tmux.conf "$OS/etc/tmux.conf"
chmod 0440 "$OS/etc/sudoers.d/me"
echo "127.0.1.1 $ORG" | tee -a /etc/hosts >>"$OS/etc/hosts"
# Every interactive shell, login or not, gets the person's PATH.
grep -q profile.d/me.sh "$OS/etc/bash.bashrc" ||
  echo '. /etc/profile.d/me.sh' >>"$OS/etc/bash.bashrc"
# The SSH server drops `me` into their Linux only while its root is
# root's and not writable by others; whatever root inside did to it, a
# boot puts that back.
chown root:root "$OS"
chmod 755 "$OS"

# The key Claude Code inside runs on, given to the machine by our server;
# a machine without one runs on the person's own account.
if [ -n "${MODEL_KEY:-}" ]; then
  printf 'export MASLOW_MODEL_KEY=%q\n' "$MODEL_KEY" >"$OS/etc/profile.d/maslow-model-key.sh"
else
  rm -f "$OS/etc/profile.d/maslow-model-key.sh"
fi
# Ours on the path of every shell, a bare `ssh computer claude` included,
# which reads no profile: `claude` and `claude-code-acp` are the wrappers
# that read the key and the person's choice at every start, `auth` is
# that choice, and `xdg-open` opens an address in the computer's own
# browser. Every login shell reads the same choice, so an editor that
# starts Claude Code its own way finds the same auth.
ln -sf /opt/maslow/bin/claude "$OS/usr/local/bin/claude"
ln -sf /opt/maslow/bin/claude-code-acp "$OS/usr/local/bin/claude-code-acp"
ln -sf /opt/maslow/bin/auth "$OS/usr/local/bin/auth"
ln -sf /opt/maslow/bin/open "$OS/usr/local/bin/xdg-open"
ln -sf /opt/maslow/bin/xclip "$OS/usr/local/bin/xclip"
rm -f "$OS/usr/local/bin/model" "$OS/etc/profile.d/maslow-model.sh"
ln -sf /opt/maslow/bin/auth-env "$OS/etc/profile.d/maslow-auth.sh"
# A choice made under the old name, model mine or ours, is kept under the
# new one, auth own or managed, once, and the old file goes. Done inside
# the person's Linux as the person, since the files are theirs: a link
# they left among them then reaches only what they already reach.
chroot --userspec=1000:1000 "$OS" /bin/sh -c '
  cd /home/me/.config/maslow 2>/dev/null || exit 0
  [ -f model ] || exit 0
  [ -e auth ] || { [ "$(cat model)" = mine ] && echo own || echo managed; } >auth
  rm -f model
' || true

# Claude Code inside reaches the brain with a session of the owner's,
# given to the machine by our server; a machine our server cannot be
# reached from, as a laptop's, has none.
if [ -n "${BRAIN_URL:-}" ]; then
  printf 'export MASLOW_BRAIN_URL=%q\nexport MASLOW_BRAIN_TOKEN=%q\n' "$BRAIN_URL" "${BRAIN_TOKEN:-}" >"$OS/etc/profile.d/maslow-brain.sh"
else
  rm -f "$OS/etc/profile.d/maslow-brain.sh"
fi

# Claude Code knows the browser and the brain, and starts in auto: ours
# are seeded into the person's files and kept current there, except where
# the person changed one. Ten seconds at most each, so nothing in the home
# can hold the boot.
timeout 10 node /opt/maslow/seed.mjs "$HOME_DIR" mcp || echo "mcp: could not be seeded; left alone"
timeout 10 node /opt/maslow/seed.mjs "$HOME_DIR" settings || echo "settings: could not be seeded; left alone"
# And it knows the skin Maslow wears: BoardUI's skill, ours in the image,
# is a link among the person's skills, so it follows the image and what
# Claude Code builds for them looks like Maslow. Made as the person, so a
# link they left among their files reaches only what they already reach.
chroot --userspec=1000:1000 "$OS" /bin/sh -c '
  mkdir -p /home/me/.claude/skills && [ -d /home/me/.claude/skills ] || exit 0
  [ -L /home/me/.claude/skills/boardui ] || [ ! -e /home/me/.claude/skills/boardui ] || exit 0
  ln -sfn /opt/maslow/skills/boardui /home/me/.claude/skills/boardui
' || echo "skill: could not be linked; left alone"

# Claude Code lives in the person's Linux, where it updates itself the way
# Claude Code does and `claude update` works. The image carries a copy too,
# read-only under ours, which cannot update itself and is what the first
# boot runs while this one arrives. Installed once, as the person, behind
# the boot, so nothing waits on the network.
chroot --userspec=1000:1000 --groups=1000 "$OS" \
  /usr/bin/env -i HOME=/home/me PATH=/usr/local/bin:/usr/bin:/bin \
  /bin/bash -lc '
    [ -x "$HOME/.local/bin/claude" ] && exit 0
    curl -fsSL https://claude.ai/install.sh | bash && exit 0
    npm install -g @anthropic-ai/claude-code
  ' >/dev/null 2>&1 &

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
# The door, outside the person's Linux, is what the internet reaches: it
# joins the terminal and the view to what runs inside.
keep node /opt/maslow/door.mjs &
# The browser, ours, outside the person's Linux but run as the person, so
# it updates with the image and reaches only their home; Claude Code
# inside finds it on 8082. Its profile, logins included, is on the disk.
# It is a real, headed Chrome on a display nobody looks at, Xvfb, as big
# as the largest pane it is ever drawn into: a headless one announces
# itself, and sites that turn bots away turn it away too.
keep Xvfb :99 -screen 0 2560x1600x24 -nolisten tcp &
mkdir -p "$DISK/browser"
chown 1000:1000 "$DISK/browser"
keep chroot --userspec=1000:1000 --groups=1000 / \
  /usr/bin/env -i HOME=/data/home BROWSER_PROFILE=/data/browser BROWSER_PATHS=/home/me=/data/home \
  PLAYWRIGHT_BROWSERS_PATH=/opt/maslow/browsers DISPLAY=:99 BROWSER_HEADED=1 \
  /usr/local/bin/node /opt/maslow/browser/bin/browser-mcp.mjs --http 8082 &

# A stop is a hard stop: what is still in memory is written to the disk
# first, so the last seconds of work survive a restart or a new image.
trap 'sync; kill 0' TERM INT
wait
