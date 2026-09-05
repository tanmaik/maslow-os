import { NextResponse } from "next/server";

import { authorizationServer } from "@/lib/oauth";
import { origin } from "@/lib/origin";

// How an app finds this deployment's sign-in.
export async function GET(request: Request) {
  return NextResponse.json(authorizationServer(origin(request)));
}
