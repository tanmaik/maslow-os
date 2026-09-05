import { resolveSession } from "@placeholder/db/auth";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextResponse } from "next/server";

import { brainServer } from "@/lib/mcp";
import { origin } from "@/lib/origin";

// The brain as an MCP server, for an app holding a session as a bearer
// token. Every request stands alone, answered in one JSON body, so it runs
// wherever the app does.
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i);
  const session = await resolveSession(token?.[1]);
  if (!session) {
    return NextResponse.json(
      { error: "invalid_token" },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${origin(request)}/.well-known/oauth-protected-resource"`,
        },
      },
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = brainServer(session);
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}

// Nothing streams from here and there is no session to end.
const notAllowed = () =>
  new Response(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notAllowed;
export const DELETE = notAllowed;
