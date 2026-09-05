import { origin } from "@/lib/origin";
import { abandoned, destination } from "@/lib/session";

// Forgets a sign-in in progress so a different address can be used, where
// the sign-in was.
export async function POST(request: Request) {
  const form = await request.formData();
  return abandoned(destination(origin(request), form.get("next")));
}
