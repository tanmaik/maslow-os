import { origin } from "@/lib/origin";
import { signedOut } from "@/lib/session";

// Ends the session: the only way one ends.
export async function POST(request: Request) {
  return signedOut(origin(request));
}
