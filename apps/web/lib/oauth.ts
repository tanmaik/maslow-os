import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { deployment } from "./deployment";

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
  return { name: nameOf(client_name), redirectUris: redirect_uris };
}

// What an app may call itself: printable, trimmed, no longer than a line.
const nameOf = (v: unknown) =>
  (typeof v === "string"
    ? v
        .replace(/[\p{Cc}]/gu, "")
        .trim()
        .slice(0, MAX_NAME)
    : "") || "An app";

export const clientId = (c: Client) =>
  Buffer.from(JSON.stringify({ n: c.name, r: c.redirectUris })).toString(
    "base64url",
  );

// Whether a client id is an address where the app's description lives, as
// Client ID Metadata Documents have it: https at a named host, with a path.
// On a laptop, http on the machine itself will do, as a smoke serves.
function isMetadataUrl(id: string): boolean {
  if (!isRedirectUri(id)) return false;
  const url = new URL(id);
  return (
    url.pathname !== "/" &&
    (url.protocol === "http:"
      ? deployment.where === "local"
      : !/^(\d+\.\d+\.\d+\.\d+|\[.*\])$/.test(url.hostname))
  );
}

// Whether an address is one the public internet routes to: not loopback,
// private, link-local, unique-local or multicast, so a description is never
// fetched from inside our own network.
function isPublic(address: string): boolean {
  const v4 = address.match(/^(?:::ffff:)?(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  return !(v6 === "::1" || v6 === "::" || /^f[cd]|^fe[89ab]|^ff/.test(v6));
}

// The longest description an app may publish, and how long one is kept.
const MAX_DOCUMENT = 64 * 1024;
const KEEP = 5 * 60 * 1000;
const MOST_KEPT = 256;
const fetched = new Map<string, { client: Client | null; until: number }>();

// Keeps a description, letting the stale and then the oldest go, so the
// set of addresses ever asked about never grows past a page of them.
function keep(id: string, client: Client | null) {
  const now = Date.now();
  for (const [key, k] of fetched) if (k.until <= now) fetched.delete(key);
  while (fetched.size >= MOST_KEPT) {
    fetched.delete(fetched.keys().next().value!);
  }
  fetched.set(id, { client, until: now + KEEP });
}

// Reads a document from an address, connecting to the one network address
// it was checked at, so a second lookup cannot answer differently. Null
// unless the answer is a 200 no larger than a description may be.
function read(
  url: URL,
  address: string,
  family: number,
): Promise<string | null> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        headers: { accept: "application/json" },
        lookup: (_host, _options, done) => done(null, address, family),
        servername: url.hostname,
        timeout: 5000,
      },
      (res) => {
        if (
          res.statusCode !== 200 ||
          Number(res.headers["content-length"]) > MAX_DOCUMENT
        ) {
          res.destroy();
          return resolve(null);
        }
        const parts: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_DOCUMENT) {
            res.destroy();
            resolve(null);
          } else parts.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(parts).toString()));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}

// Reads an app's description from its address. The host must resolve to
// public addresses alone, the document must name itself by that exact
// address, and it must describe a client as registration would.
async function fetchClient(id: string): Promise<Client | null> {
  const kept = fetched.get(id);
  if (kept && kept.until > Date.now()) return kept.client;
  let client: Client | null = null;
  try {
    const url = new URL(id);
    const addresses = await lookup(url.hostname, { all: true });
    const [first] = addresses;
    if (!first) throw new Error("no address");
    if (
      url.protocol === "https:" &&
      !addresses.every((a) => isPublic(a.address))
    ) {
      throw new Error("not a public host");
    }
    const text = await read(url, first.address, first.family);
    const doc = text === null ? null : JSON.parse(text);
    if (doc?.client_id === id) client = clientFrom(doc);
  } catch {
    // Unreachable or not a description: not a client.
  }
  keep(id, client);
  return client;
}

// The client a client id describes, or null when the id is not one: either
// the description itself, as registration hands it back, or an address the
// description is read from.
async function clientOf(id: unknown): Promise<Client | null> {
  if (typeof id !== "string") return null;
  if (isMetadataUrl(id)) return fetchClient(id);
  try {
    const { n, r } = JSON.parse(Buffer.from(id, "base64url").toString());
    if (typeof n === "string" && Array.isArray(r) && r.every(isRedirectUri))
      return { name: nameOf(n), redirectUris: r };
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
export async function authorizationRequest(
  params: URLSearchParams,
): Promise<
  | { ok: true; request: AuthorizationRequest }
  | { ok: false; problem: string; back: URL | null }
> {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri");
  if (!isRedirectUri(redirectUri))
    return {
      ok: false,
      problem: "no address to send the app back to",
      back: null,
    };
  const client = await clientOf(clientId);
  if (!client) return { ok: false, problem: "unknown app", back: null };
  if (!client.redirectUris.includes(redirectUri))
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
  client_id_metadata_document_supported: true,
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
