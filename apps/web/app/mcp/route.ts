import { asPerson, Gone } from "@maslow/db";
import { resolveSession, type Session } from "@maslow/db/auth";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";

import { about, brainServer, type About } from "@/lib/mcp";
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

// Who is knocking: an app holding a session as a bearer token. A
// browser's session opens the site, never this.
async function whoever(request: Request): Promise<Session | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i);
  const session = await resolveSession(token?.[1]);
  return session && session.client !== null ? session : null;
}

// Whether the caller wants each answer as data beside the lines: a program
// on the person's computer says so with a header; a model's client does
// not, and pays for the lines alone.
const wantsData = (request: Request) =>
  request.headers.get("maslow-answer") === "data";

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
    const server = brainServer(session, known, wantsData(request));
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
