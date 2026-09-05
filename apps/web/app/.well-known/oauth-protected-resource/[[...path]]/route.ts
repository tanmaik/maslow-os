import { NextResponse } from "next/server";

import { protectedResource } from "@/lib/oauth";
import { origin } from "@/lib/origin";

// How an app finds who protects the brain, asked plainly or with the brain's
// own path appended.
export async function GET(request: Request) {
  return NextResponse.json(protectedResource(origin(request)));
}
