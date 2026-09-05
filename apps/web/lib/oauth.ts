// The brain's OAuth: an outside app registers by describing itself, sends
// the person here to approve it, and trades the code it gets for a session.
// The app's description is its client id, so nothing is registered anywhere
// and there is no registry to sweep; the person sees who is asking before
// they approve.

export type Client = { name: string; redirectUris: string[] };

// The longest name an app may call itself.
const MAX_NAME = 100;

// Where an app may be sent back to: an https address, or http on the
// machine itself, as a command-line app listens.
function isRedirectUri(s: unknown): s is string {
  if (typeof s !== "string") return false;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return false;
  }
  if (url.hash) return false;
  return (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  );
}

// The client an app described when registering, or null when the
// description is not one: it needs at least one address to be sent back to,
// and may have a name.
export function clientFrom(body: unknown): Client | null {
  if (typeof body !== "object" || body === null) return null;
  const { redirect_uris, client_name } = body as Record<string, unknown>;
  if (!Array.isArray(redirect_uris) || redirect_uris.length === 0) return null;
  if (!redirect_uris.every(isRedirectUri)) return null;
  const name =
    typeof client_name === "string"
      ? client_name
          .replace(/[\p{Cc}]/gu, "")
          .trim()
          .slice(0, MAX_NAME)
      : "";
  return { name: name || "An app", redirectUris: redirect_uris };
}

export const clientId = (c: Client) =>
  Buffer.from(JSON.stringify({ n: c.name, r: c.redirectUris })).toString(
    "base64url",
  );

// The client a client id describes, or null when the id is not one.
export function clientOf(id: unknown): Client | null {
  if (typeof id !== "string") return null;
  try {
    const { n, r } = JSON.parse(Buffer.from(id, "base64url").toString());
    if (typeof n === "string" && Array.isArray(r) && r.every(isRedirectUri))
      return { name: n, redirectUris: r };
  } catch {
    // Not one of ours.
  }
  return null;
}

// What an app asks for when it sends the person here.
export type AuthorizationRequest = {
  clientId: string;
  client: Client;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
};

// Reads an authorization request. An app that cannot be identified, or that
// asks to be sent somewhere it did not register, is refused on the page and
// never redirected; any other fault goes back to the app as OAuth says.
export function authorizationRequest(
  params: URLSearchParams,
):
  | { ok: true; request: AuthorizationRequest }
  | { ok: false; problem: string; back: URL | null } {
  const clientId = params.get("client_id") ?? "";
  const client = clientOf(clientId);
  const redirectUri = params.get("redirect_uri");
  if (!client) return { ok: false, problem: "unknown app", back: null };
  if (!redirectUri || !client.redirectUris.includes(redirectUri))
    return {
      ok: false,
      problem: "the app asked to be sent somewhere it did not register",
      back: null,
    };
  const state = params.get("state");
  const back = (problem: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", "invalid_request");
    url.searchParams.set("error_description", problem);
    if (state) url.searchParams.set("state", state);
    return { ok: false as const, problem, back: url };
  };
  if (params.get("response_type") !== "code")
    return back("response_type must be code");
  const codeChallenge = params.get("code_challenge");
  if (!codeChallenge || params.get("code_challenge_method") !== "S256")
    return back("a code_challenge with method S256 is required");
  return {
    ok: true,
    request: { clientId, client, redirectUri, codeChallenge, state },
  };
}

// The authorization server this deployment is, as apps discover it.
export const authorizationServer = (origin: string) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: [],
});

// The brain as a protected resource, and where its authorization server is.
export const protectedResource = (origin: string) => ({
  resource: `${origin}/mcp`,
  authorization_servers: [origin],
  bearer_methods_supported: ["header"],
  scopes_supported: [],
});
