import { addSshKey, sshTarget } from "@/lib/computer";
import { origin } from "@/lib/origin";

// What the one command under SSH in Settings runs on a Mac: a script that
// puts the helper `ssh` goes through the door with on the path, makes the
// Mac a key if it has none and sends the public half back here, and
// writes a Host in ~/.ssh/config that uses that key, so `ssh <name>`
// opens the computer. Safe to run again: a Host of exactly that name is
// rewritten, one that names other hosts too is left alone, and a key
// already registered stays as it is. A stale or forged link gets a script
// that says so, because a shell is what reads the answer.
export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams;
  const to = await sshTarget(
    asked.get("o") ?? "",
    asked.get("c") ?? "",
    asked.get("t") ?? "",
  );
  const script = to
    ? setup(origin(request), request.url, to.name, to.host)
    : `echo '${STALE}' >&2\nexit 1\n`;
  return new Response(script, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

// The script's one call back: the Mac's public key, on the same link.
export async function POST(request: Request) {
  const asked = new URL(request.url).searchParams;
  const said = await addSshKey(
    asked.get("o") ?? "",
    asked.get("c") ?? "",
    asked.get("t") ?? "",
    await request.text(),
  );
  const line = {
    added: "ok",
    stale: STALE,
    invalid: "That is not a public key as ssh-keygen writes it.",
    full: "Your computer already has twenty keys; take one off under SSH in Settings.",
    unreached:
      "Your key is saved, but your computer did not answer. Run this again in a minute.",
  }[said];
  return new Response(`${line}\n`, {
    status: said === "added" ? 200 : 403,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

const STALE = "This link has expired. Open Settings, Access, for a fresh one.";

const setup = (
  site: string,
  link: string,
  name: string,
  host: string,
) => `#!/bin/sh
# Sets this Mac up to reach your Maslow computer: the helper your own ssh
# runs to get through the computer's door, a key of this Mac's that the
# computer is told to accept, and a Host in ~/.ssh/config so that
# \`ssh ${name}\` opens it. Safe to run again.
set -eu
name='${name}'
host='${host}'
mkdir -p "$HOME/.local/bin" "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
curl -fsSL '${site}/maslow-ssh' -o "$HOME/.local/bin/maslow-ssh"
chmod 755 "$HOME/.local/bin/maslow-ssh"
key="$HOME/.ssh/id_ed25519"
[ -f "$key" ] || ssh-keygen -q -t ed25519 -N "" -C "$(whoami)@$(hostname -s)" -f "$key"
[ -f "$key.pub" ] || ssh-keygen -y -f "$key" >"$key.pub"
curl -fsS -X POST --data-binary "@$key.pub" '${link}' >/dev/null
config="$HOME/.ssh/config"
touch "$config"
awk -v name="$name" '/^Host / { mine = (NF == 2 && $2 == name) } !mine { print }' "$config" >"$config.maslow" && mv "$config.maslow" "$config"
printf '\\nHost %s\\n  HostName %s\\n  User me\\n  IdentityFile ~/.ssh/id_ed25519\\n  IdentitiesOnly yes\\n  IdentityAgent none\\n  ProxyCommand ~/.local/bin/maslow-ssh %%h\\n' "$name" "$host" >>"$config"
chmod 600 "$config"
echo "Done: ssh $name opens your computer."
`;
