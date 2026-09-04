import { origin } from "@/lib/origin";
import { abandoned } from "@/lib/session";

// Forgets a sign-in in progress so a different address can be used.
export async function POST(request: Request) {
  return abandoned(origin(request));
}
