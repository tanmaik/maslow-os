import { NextResponse } from "next/server";

import { authorizationServer } from "@/lib/oauth";
import { deployment } from "@/lib/deployment";
import { origin } from "@/lib/origin";

// How an app finds this deployment's sign-in.
export async function GET(request: Request) {
  // A trial has no MCP, so nothing to authorize; the proxy never sees
  // an address with a dot in it.
  if (deployment.trial) return new Response(null, { status: 404 });
  return NextResponse.json(authorizationServer(origin(request)));
}
