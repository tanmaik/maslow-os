import { asOrg } from "@maslow/db";
import { computerOf, setKeys } from "@maslow/db/computers";

import { pushKeys, SSH_KEY } from "@/lib/computer";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

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
  if (lines.length > 20 || lines.some((l) => !SSH_KEY.test(l)))
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
