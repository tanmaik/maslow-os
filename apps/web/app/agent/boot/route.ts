import { finishLostTurns } from "@placeholder/db/agents";

// A machine that has just booted, saying which conversations it still has
// mid-turn. Any other conversation of its the app thought was working lost
// its turn with the machine, and is finished here. A stranger gets the same
// 404 as a machine we never made.
export async function POST(request: Request) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const machineId = request.headers.get("fly-machine-id");
  if (!secret || !machineId) return new Response(null, { status: 404 });
  let body: { inFlight?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  const { inFlight } = body;
  if (
    !Array.isArray(inFlight) ||
    !inFlight.every((id) => typeof id === "string")
  )
    return new Response(null, { status: 400 });
  const known = await finishLostTurns(machineId, secret, inFlight);
  return new Response(null, { status: known ? 204 : 404 });
}
