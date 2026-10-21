import { NextResponse } from "next/server";

import { protectedResource } from "@/lib/oauth";
import { deployment } from "@/lib/deployment";
import { origin } from "@/lib/origin";

// How an app finds who protects the brain, asked plainly or with the brain's
// own path appended.
export async function GET(request: Request) {
  // A trial has no MCP, so nothing to authorize; the proxy never sees
  // an address with a dot in it.
  if (deployment.trial) return new Response(null, { status: 404 });
  return NextResponse.json(protectedResource(origin(request)));
}
