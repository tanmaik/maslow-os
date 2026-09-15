import { MOST, type Mode } from "@maslow/db/arrival";

import { arrive } from "@/lib/arrival";
import { principal } from "@/lib/session";

const MODES = ["off", "bar", "desk"] as const;
const isMode = (v: unknown): v is Mode =>
  typeof v === "string" && (MODES as readonly string[]).includes(v);

// The person's answer to the card that met them: how much their agent
// does on its own, and what they are working toward; or that they
// skipped it, which changes nothing.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const body = (await request.json().catch(() => null)) as {
    mode?: unknown;
    words?: unknown;
  } | null;
  if (body?.mode !== "skip" && !isMode(body?.mode))
    return new Response("Nothing, the bar, the desk, or skip.", {
      status: 400,
    });
  const words =
    typeof body.words === "string" && body.words.trim()
      ? body.words.trim().slice(0, MOST)
      : null;
  await arrive(p, body.mode === "skip" ? null : { mode: body.mode, words });
  return new Response(null, { status: 204 });
}
