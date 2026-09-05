import { createSession } from "@placeholder/db/auth";
import { redeemCode } from "@placeholder/db/oauth";
import { NextResponse } from "next/server";

import { clientOf } from "@/lib/oauth";

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

const refused = (error: string, status = 400) =>
  NextResponse.json({ error }, { status, headers: NO_STORE });

// An app trades the code the person approved for a session of its own. The
// token is a session token, held for as long as a browser's would be:
// until the person signs it out.
export async function POST(request: Request) {
  const form = await body(request);
  if (!form) return refused("invalid_request");
  if (form.get("grant_type") !== "authorization_code")
    return refused("unsupported_grant_type");
  const code = form.get("code");
  const verifier = form.get("code_verifier");
  const redirectUri = form.get("redirect_uri");
  const clientId = form.get("client_id");
  const client = clientOf(clientId);
  if (!code || !verifier || !redirectUri || !client || !clientId)
    return refused("invalid_request");
  const p = await redeemCode(code, { client: clientId, redirectUri, verifier });
  if (!p) return refused("invalid_grant");
  const token = await createSession(p, client.name);
  if (!token) return refused("invalid_grant");
  return NextResponse.json(
    { access_token: token, token_type: "Bearer" },
    { headers: NO_STORE },
  );
}

// The request as a form, whichever way the app sent it.
async function body(request: Request): Promise<URLSearchParams | null> {
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const json = await request.json();
      return new URLSearchParams(
        Object.entries(json).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      );
    }
    return new URLSearchParams(await request.text());
  } catch {
    return null;
  }
}
