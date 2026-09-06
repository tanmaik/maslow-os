import { isUuid } from "@placeholder/db";

import { machineFrom } from "@/lib/backups";
import { landedOn } from "@/lib/files";

// A machine saying how a landing went, by the id it was given with the
// file. A stranger gets the same 404 as a machine we never made.
export async function POST(request: Request) {
  const m = await machineFrom(request);
  if (!m) return new Response(null, { status: 404 });
  const body = await request.json().catch(() => null);
  const id = String(body?.id ?? "");
  if (!isUuid(id)) return new Response(null, { status: 400 });
  await landedOn(m, id, {
    ok: body?.ok === true,
    // A machine's own words, cut to a sentence and stripped of anything
    // that could forge a line in a log or grow a column without bound.
    error: String(body?.error ?? "no reason given")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .slice(0, 200),
  });
  return new Response(null, { status: 204 });
}
