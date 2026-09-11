import { sshTarget } from "@/lib/computer";
import { origin } from "@/lib/origin";

// What the Computer page's one command runs on a Mac: a script that puts
// the helper `ssh` goes through the door with on the path and a Host in
// ~/.ssh/config, so `ssh <name>` opens the computer. Safe to run again:
// a Host already there only has its address brought up to date, since a
// computer that moved has a new one. A stale or forged link gets a
// script that says so, because a shell is what reads the answer.
export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams;
  const to = await sshTarget(
    asked.get("o") ?? "",
    asked.get("c") ?? "",
    asked.get("t") ?? "",
  );
  const script = to
    ? setup(origin(request), to.name, to.host)
    : "echo 'This link has expired. Open the Computer page for a fresh one.' >&2\nexit 1\n";
  return new Response(script, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

const setup = (site: string, name: string, host: string) => `#!/bin/sh
# Sets this Mac up to reach your Maslow computer: the helper your own ssh
# runs to get through the computer's door, and a Host in ~/.ssh/config so
# that \`ssh ${name}\` opens it. Safe to run again.
set -eu
name='${name}'
host='${host}'
mkdir -p "$HOME/.local/bin" "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
curl -fsSL '${site}/maslow-ssh' -o "$HOME/.local/bin/maslow-ssh"
chmod 755 "$HOME/.local/bin/maslow-ssh"
config="$HOME/.ssh/config"
touch "$config"
if grep -q "^Host $name\$" "$config"; then
  awk -v name="$name" -v host="$host" '
    /^Host / { mine = ($2 == name) }
    mine && /^[ \\t]*HostName / { $0 = "  HostName " host }
    { print }' "$config" >"$config.maslow" && mv "$config.maslow" "$config"
  chmod 600 "$config"
  echo "This Mac was already set up: ssh $name opens your computer."
else
  printf '\\nHost %s\\n  HostName %s\\n  User me\\n  ProxyCommand ~/.local/bin/maslow-ssh %%h\\n  # IdentityFile ~/.ssh/id_ed25519\\n' "$name" "$host" >>"$config"
  chmod 600 "$config"
  echo "Done: ssh $name opens your computer."
fi
`;
