import { asPerson, Gone, isUuid } from "@placeholder/db";
import { personBehindMachine } from "@placeholder/db/agents";
import { resolveSession, type Session } from "@placeholder/db/auth";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";

import { about, brainServer, type About } from "@/lib/mcp";
import { machineFrom } from "@/lib/machine";
import { origin } from "@/lib/origin";

// A stranger, or a token whose membership is gone, is told where to sign in.
const refused = (request: Request) =>
  NextResponse.json(
    { error: "invalid_token" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${origin(request)}/.well-known/oauth-protected-resource"`,
      },
    },
  );

// Who is knocking: the person's own machine, speaking as itself, naming
// the conversation it is having if it is having one; or an app holding a
// session as a bearer token. A browser's session opens the site, never
// this.
async function whoever(request: Request): Promise<Session | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i);
  const session = await resolveSession(token?.[1]);
  if (session) return session.client === null ? null : session;
  const machine = machineFrom(request);
  if (!machine) return null;
  const conversation = request.headers.get("x-agent-session");
  if (conversation && !isUuid(conversation)) return null;
  return personBehindMachine(
    machine.machineId,
    machine.secret,
    conversation ?? undefined,
  );
}

// The brain as an MCP server. Every request stands alone, answered in one
// JSON body, so it runs wherever the app does. The one that opens a
// connection is told whose brain this is and what is in it, with the
// membership held until the answer is made.
export async function POST(request: Request) {
  const session = await whoever(request);
  if (!session) return refused(request);
  const answer = async (known: About | null) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = brainServer(session, known);
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  };
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  if (body?.method !== "initialize") return answer(null);
  try {
    return await asPerson(session, async (q) =>
      answer(await about(q, session)),
    );
  } catch (err) {
    if (err instanceof Gone) return refused(request);
    throw err;
  }
}

// Nothing streams from here and there is no session to end.
const notAllowed = () =>
  new Response(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
