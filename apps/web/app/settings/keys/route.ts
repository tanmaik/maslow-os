import { asOrg } from "@maslow/db";
import { computerOf, setKeys } from "@maslow/db/computers";

import { pushKeys, sshKeysOf } from "@/lib/computer";
import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Takes one key, named by its fingerprint, off the ones that open the
// person's computer over SSH, and gives the machine the rest at once; a
// machine that does not answer is said so, since it still holds the key
// until it next takes them.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const remove = String(form.get("remove") ?? "");
  await asOrg(p.orgId, async (q) => {
    const c = await computerOf(q, p.userId);
    if (!c) return;
    const kept = sshKeysOf(c.authorizedKeys).filter(
      (k) => k.fingerprint !== remove,
    );
    await setKeys(q, c.id, kept.map((k) => k.line).join("\n"));
  });
  const back = (notice: string) =>
    Response.redirect(`${origin(request)}/settings?keys=${notice}`, 303);
  try {
    await pushKeys(p);
  } catch (err) {
    console.error(`keys: ${(err as Error).message}`);
    return back("unreached");
  }
  return back("removed");
}
