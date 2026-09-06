import { sessionForMachine } from "@placeholder/db/agents";

import { bootstrapFor } from "@/lib/agent";

// A machine asking how to run a session: with its id and its secret, and
// the session's id. A stranger, or another machine's session, gets a 404.
export async function POST(request: Request) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const machineId = request.headers.get("fly-machine-id");
  if (!secret || !machineId) return new Response(null, { status: 404 });
  let session: unknown;
  try {
    session = (await request.json()).session;
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof session !== "string") return new Response(null, { status: 400 });
  const s = await sessionForMachine(machineId, secret, session);
  if (!s) return new Response(null, { status: 404 });
  return Response.json(bootstrapFor(s, { machineId, secret }));
}
