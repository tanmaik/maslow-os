import { recordEvents } from "@placeholder/db/agents";

// A machine saying what the agent did in a session, as it happens: its id,
// its secret, and the events since it last said. A stranger gets the same
// 404 as a machine we never made.
export async function POST(request: Request) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const machineId = request.headers.get("fly-machine-id");
  if (!secret || !machineId) return new Response(null, { status: 404 });
  let body: {
    session?: unknown;
    acpSessionId?: unknown;
    events?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const { session, acpSessionId, events } = body;
  if (
    typeof session !== "string" ||
    !Array.isArray(events) ||
    !events.every(
      (e) =>
        Number.isInteger(e?.seq) &&
        typeof e.kind === "string" &&
        e.body &&
        typeof e.body === "object",
    )
  )
    return new Response(null, { status: 400 });
  const known = await recordEvents(
    machineId,
    secret,
    session,
    typeof acpSessionId === "string" ? acpSessionId : null,
    events,
  );
  return new Response(null, { status: known ? 204 : 404 });
}
