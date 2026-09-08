import { asOrg } from "@placeholder/db";
import { computerOf, setKeys } from "@placeholder/db/computers";

import { pushKeys } from "@/lib/computer";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// One public key per line, as ssh-keygen writes it: the kind, the key,
// and a comment if any.
const KEY =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+=*( [^\r\n]*)?$/;

// Sets the public keys that open the person's computer over SSH, and
// gives them to the machine at once.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const text = String(form.get("keys") ?? "");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const back = (notice: string) =>
    Response.redirect(`${origin(request)}/settings?keys=${notice}`, 303);
  if (lines.length > 20 || lines.some((l) => !KEY.test(l)))
    return back("invalid");
  const keys = lines.join("\n");
  await asOrg(p.orgId, async (q) => {
    const c = await computerOf(q, p.userId);
    if (c) await setKeys(q, c.id, keys);
  });
  await pushKeys(p).catch((err: Error) =>
    console.error(`keys: ${err.message}`),
  );
  return back("saved");
}
