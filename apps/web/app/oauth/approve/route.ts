import { issueCode } from "@maslow/db/oauth";

import { authorizationRequest } from "@/lib/oauth";
import { principal } from "@/lib/session";

// The person's answer to an app asking in: approved, a code goes back to the
// app's address; refused, the app is told so. The request is read again from
// the form, the same way the page read it.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const asked = await authorizationRequest(
    new URLSearchParams(
      [...form.entries()].filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    ),
  );
  if (!asked.ok) {
    if (!asked.back) return new Response(asked.problem, { status: 400 });
    return Response.redirect(asked.back, 303);
  }
  const { clientId, client, redirectUri, codeChallenge, state } = asked.request;
  const back = new URL(redirectUri);
  if (state) back.searchParams.set("state", state);
  if (form.get("decision") === "allow") {
    back.searchParams.set(
      "code",
      await issueCode(p, {
        client: clientId,
        clientName: client.name,
        redirectUri,
        codeChallenge,
      }),
    );
  } else {
    back.searchParams.set("error", "access_denied");
  }
  return Response.redirect(back, 303);
}
