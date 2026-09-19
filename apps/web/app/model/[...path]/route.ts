import { asOrg } from "@maslow/db";
import { computerById } from "@maslow/db/computers";

import { deployment } from "@/lib/deployment";
import { MODEL, modelTokenOpens, REASONING } from "@/lib/models";

// A model call can stream for minutes.
export const maxDuration = 300;

// The gateway every agent's model calls go through: the machine carries a
// token, the key stays here, the model is ours whatever was asked for, and
// OpenRouter's answer streams back as it comes. The cap is OpenRouter's,
// on the key, so what a person may spend in a week holds however they
// reach this.
const PATHS = new Set([
  "/v1/messages",
  "/v1/messages/count_tokens",
  "/v1/chat/completions",
]);
const CARRIED = ["anthropic-version", "anthropic-beta", "accept"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const path = `/${(await params).path.join("/")}`;
  if (!PATHS.has(path)) return new Response("Not here.", { status: 404 });
  const models = deployment.models;
  if (models.kind !== "openrouter")
    return new Response("Model keys are off here.", { status: 503 });
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i);
  const [orgId, id] = token?.[1]?.split(".") ?? [];
  const uuid = /^[0-9a-f-]{36}$/;
  const c =
    orgId && id && uuid.test(orgId) && uuid.test(id)
      ? await asOrg(orgId, (q) => computerById(q, id))
      : null;
  if (!c || !c.current || !c.modelKey || !modelTokenOpens(c, token![1]!))
    return new Response("That token is not good here.", { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(await request.text()) as Record<string, unknown>;
  } catch {
    return new Response("The body is JSON.", { status: 400 });
  }
  // A count of tokens is answered here, about four characters to a token
  // over the system words, the messages and the tools, since OpenRouter has
  // no counter to forward it to and the caller only wants a size, not a
  // bill.
  if (path === "/v1/messages/count_tokens") {
    const said = JSON.stringify([
      body.system ?? "",
      body.messages ?? [],
      body.tools ?? [],
    ]);
    return Response.json({ input_tokens: Math.ceil(said.length / 4) });
  }
  body.model = MODEL;
  // How much the model thinks is ours to set, not the caller's.
  body.reasoning = REASONING;
  delete body.thinking;
  // OpenRouter reads these to reach other models; a caller does not set
  // them, so the one-model boundary holds.
  delete body.models;
  delete body.route;
  delete body.provider;
  const headers: Record<string, string> = {
    authorization: `Bearer ${c.modelKey}`,
    "content-type": "application/json",
  };
  for (const name of CARRIED) {
    const v = request.headers.get(name);
    if (v) headers[name] = v;
  }
  const upstream = await fetch(`https://openrouter.ai/api${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: request.signal,
  });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type":
        upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
