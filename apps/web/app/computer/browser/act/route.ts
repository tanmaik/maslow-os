import { browserAct } from "@/lib/computer";
import { principal } from "@/lib/session";

// The shapes a hand on the browser can take, checked before anything is
// passed on.
const KINDS = new Set(["navigate", "click", "type", "key", "scroll"]);
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v);

function isAct(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  if (!KINDS.has(String(a.kind))) return false;
  switch (a.kind) {
    case "navigate":
      return typeof a.url === "string" && a.url.length < 2048;
    case "click":
      return number(a.x) && number(a.y);
    case "type":
      return typeof a.text === "string" && a.text.length < 10_000;
    case "key":
      return typeof a.key === "string" && a.key.length < 40;
    case "scroll":
      return number(a.x) && number(a.y) && number(a.dy);
  }
  return false;
}

// One act of the person's on their computer's browser.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const act = await request.json().catch(() => null);
  if (!isAct(act)) return new Response("That is not an act.", { status: 400 });
  try {
    if (!(await browserAct(p, act)))
      return new Response("Your computer is not ready.", { status: 409 });
  } catch (err) {
    return new Response((err as Error).message, { status: 409 });
  }
  return new Response(null, { status: 204 });
}
