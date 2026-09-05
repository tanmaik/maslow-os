import { NextResponse } from "next/server";

import { clientFrom, clientId } from "@/lib/oauth";

// An app registers by describing itself, and gets that description back as
// its client id. No secret: the app proves itself with PKCE.
export async function POST(request: Request) {
  const client = clientFrom(await request.json().catch(() => null));
  if (!client)
    return NextResponse.json(
      {
        error: "invalid_client_metadata",
        error_description:
          "redirect_uris must name https addresses, or http on localhost",
      },
      { status: 400 },
    );
  return NextResponse.json(
    {
      client_id: clientId(client),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    },
    { status: 201 },
  );
}
