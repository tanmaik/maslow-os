import { createSession } from "@placeholder/db/agents";
import { computersAllowed } from "@placeholder/db/computers";
import { randomUUID } from "node:crypto";

import { ensureFilesystem } from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { defaultModel, offered } from "@/lib/models";
import { principal } from "@/lib/session";

// A new conversation on the person's machine, on the model they picked.
// Answers its id; the browser opens it and speaks to the machine itself.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  // Nothing is made for a conversation that could not be had.
  const models = offered();
  if (models.length === 0 && deployment.production)
    return new Response("This deployment has no model.", { status: 503 });
  if (!(await computersAllowed(p)))
    return new Response("Computers are off for this org.", { status: 403 });
  // Nothing is made for a conversation that could not run.
  if (deployment.production && offered().length === 0)
    return new Response("This deployment offers no model.", { status: 503 });
  const computer = await ensureFilesystem(p);
  if (!computer)
    return new Response("Your computer could not be made.", { status: 503 });
  let asked: { model?: unknown } = {};
  try {
    asked = await request.json();
  } catch {}
  const model =
    typeof asked.model === "string" && models.some((m) => m.id === asked.model)
      ? asked.model
      : defaultModel().id;
  const id = randomUUID();
  await createSession(p, { id, computerId: computer.id, model });
  return Response.json({ id });
}
