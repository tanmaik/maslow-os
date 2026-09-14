import { asPerson } from "@maslow/db";
import { rememberView } from "@maslow/db/brain-views";

import { principal } from "@/lib/session";

// Longer than any view a person can set from the page, and short enough
// that nothing can be parked in the table.
const MOST = 2000;

// Writes down how the person is looking at one list of their brain. It is
// theirs alone, and nothing but the page that set it ever reads it.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const subject = String(form.get("subject") ?? "");
  const state = String(form.get("state") ?? "");
  if (subject.length > 200 || state.length > MOST) {
    return new Response(null, { status: 400 });
  }
  await asPerson(p, (db) => rememberView(db, subject, state));
  return new Response(null, { status: 204 });
}
