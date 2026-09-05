// The brain's MCP server and the OAuth in front of it, walked as an app
// would: discovery, registration, the person's approval, the code traded for
// a token, the tools called with it, and the agent disconnected from
// settings. Returns true when every check passed.
import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import { orgs } from "../packages/db/src/seed.ts";

// The SDK is the web app's; the smoke borrows it to be the client.
const sdk = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { Client } = sdk("@modelcontextprotocol/sdk/client/index.js");
const { UnauthorizedError } = sdk("@modelcontextprotocol/sdk/client/auth.js");
const { StreamableHTTPClientTransport } = sdk(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
);

const TOKEN = /^[0-9a-f-]{36}\.[0-9a-f-]{36}$/;
const DOORS = [
  "catalog",
  "read",
  "get",
  "graph",
  "write",
  "edit",
  "remove",
  "restore",
  "unlink",
  "merge",
  "unmerge",
  "history",
];

export async function smokeMcp(stack, signIn) {
  const { seeds } = await import("../packages/brain/src/seed.ts");
  const base = stack.url;
  let ok = true;
  const check = (label, pass, detail) => {
    console.log(
      `${pass ? "ok  " : "FAIL"}  mcp: ${label.padEnd(36)} ${detail}`,
    );
    ok &&= pass;
  };
  const page = async (url, cookie) =>
    (
      await (await fetch(url, { headers: cookie ? { cookie } : {} })).text()
    ).replaceAll("<!-- -->", "");

  // An app finds the brain's authorization server from the brain.
  const resource = await (
    await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)
  ).json();
  const server = await (
    await fetch(`${base}/.well-known/oauth-authorization-server`)
  ).json();
  check(
    "discovery",
    resource.resource === `${base}/mcp` &&
      resource.authorization_servers[0] === base &&
      server.authorization_endpoint === `${base}/oauth/authorize` &&
      server.token_endpoint === `${base}/oauth/token` &&
      server.registration_endpoint === `${base}/oauth/register` &&
      server.code_challenge_methods_supported.includes("S256"),
    resource.resource,
  );

  // It registers by describing itself; an address off the machine and off
  // https is refused.
  const redirectUri = "http://localhost:7/callback";
  const register = (body) =>
    fetch(`${base}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const registered = await register({
    client_name: "Claude",
    redirect_uris: [redirectUri],
  });
  const client = await registered.json();
  check(
    "register",
    registered.status === 201 &&
      typeof client.client_id === "string" &&
      client.token_endpoint_auth_method === "none",
    `answered ${registered.status}`,
  );
  const elsewhere = await register({
    client_name: "Elsewhere",
    redirect_uris: ["http://elsewhere.test/callback"],
  });
  check(
    "plain http elsewhere refused",
    elsewhere.status === 400,
    `answered ${elsewhere.status}`,
  );

  // It sends the person to approve it. Signed out, that is the sign-in;
  // signed in, it says who is asking and as whom.
  const verifier = randomBytes(32).toString("base64url");
  const ask = {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state: "xyz",
  };
  const authorize = (params = ask) =>
    `${base}/oauth/authorize?${new URLSearchParams(params)}`;
  check(
    "authorize signed out is the sign-in",
    (await page(authorize())).includes("Pick a person from the pill"),
    "sign-in page",
  );
  const wile = await signIn(orgs[0].users[0].id);
  const consent = await page(authorize(), wile);
  check(
    "consent names the app, the person, the org",
    consent.includes("Connect Claude?") &&
      consent.includes("Wile Coyote") &&
      consent.includes("Acme Rockets"),
    "Connect Claude?",
  );
  const unregistered = await fetch(
    authorize({ ...ask, redirect_uri: "https://elsewhere.test/callback" }),
    { headers: { cookie: wile }, redirect: "manual" },
  );
  check(
    "unregistered address refused on the page",
    unregistered.status === 200 &&
      (await unregistered.text()).includes("did not register"),
    `answered ${unregistered.status}`,
  );
  const noPkce = await fetch(authorize({ ...ask, code_challenge: "" }), {
    headers: { cookie: wile },
    redirect: "manual",
  });
  const noPkceTo = noPkce.headers.get("location") ?? "";
  check(
    "a fault goes back to the app as an error",
    noPkce.status === 307 &&
      noPkceTo.startsWith(`${redirectUri}?`) &&
      noPkceTo.includes("error=invalid_request") &&
      noPkceTo.includes("state=xyz"),
    noPkceTo.slice(redirectUri.length) || `answered ${noPkce.status}`,
  );

  // The person answers.
  const decide = async (decision, cookie = wile) => {
    const res = await fetch(`${base}/oauth/approve`, {
      method: "POST",
      headers: cookie ? { cookie } : {},
      body: new URLSearchParams({ ...ask, decision }),
      redirect: "manual",
    });
    const to = res.headers.get("location");
    return { status: res.status, to: to ? new URL(to) : null };
  };
  const denied = await decide("deny");
  check(
    "deny sends the app away with access_denied",
    denied.status === 303 &&
      denied.to?.searchParams.get("error") === "access_denied" &&
      denied.to?.searchParams.get("state") === "xyz",
    denied.to?.search ?? `answered ${denied.status}`,
  );
  const allowed = await decide("allow");
  const code = allowed.to?.searchParams.get("code") ?? "";
  check(
    "allow sends a code back",
    allowed.status === 303 &&
      allowed.to?.origin + allowed.to?.pathname === redirectUri &&
      TOKEN.test(code) &&
      allowed.to?.searchParams.get("state") === "xyz",
    TOKEN.test(code) ? "code and state" : (allowed.to?.search ?? ""),
  );
  check(
    "approve signed out",
    (await decide("allow", "")).status === 401,
    "401",
  );

  // The app trades the code in, with the verifier it made the challenge
  // from. A wrong verifier burns the code; a right one spends it.
  const token = (body) =>
    fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
  const exchange = {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    client_id: client.client_id,
  };
  const wrong = await token({ ...exchange, code_verifier: "not-it" });
  check(
    "wrong verifier refused and burns the code",
    wrong.status === 400 &&
      (await wrong.json()).error === "invalid_grant" &&
      (await token(exchange)).status === 400,
    `answered ${wrong.status}`,
  );
  const fresh = (await decide("allow")).to?.searchParams.get("code");
  const issued = await token({ ...exchange, code: fresh });
  const grant = await issued.json();
  check(
    "code traded for a token",
    issued.status === 200 &&
      grant.token_type === "Bearer" &&
      TOKEN.test(grant.access_token ?? ""),
    `answered ${issued.status}`,
  );
  check(
    "a code is spent once",
    (await token({ ...exchange, code: fresh })).status === 400,
    "invalid_grant",
  );

  // The brain, as the app holding the token.
  let seq = 0;
  const rpc = (bearer, method, params) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, params }),
    });
  const hello = {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  };
  const stranger = await rpc("nobody", "initialize", hello);
  const challenge = stranger.headers.get("www-authenticate") ?? "";
  check(
    "a stranger is refused and told where to sign in",
    stranger.status === 401 &&
      challenge.includes(
        `resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      ),
    challenge || `answered ${stranger.status}`,
  );
  const init = await (
    await rpc(grant.access_token, "initialize", hello)
  ).json();
  check(
    "initialize",
    init.result?.serverInfo?.name === "brain" &&
      /mind, not a mirror/.test(init.result?.instructions ?? ""),
    init.result?.protocolVersion ?? JSON.stringify(init).slice(0, 80),
  );
  const listed = await (await rpc(grant.access_token, "tools/list", {})).json();
  const names = (listed.result?.tools ?? []).map((t) => t.name);
  check(
    "the doors are the tools",
    DOORS.every((n) => names.includes(n)),
    names.join(" "),
  );
  const call = async (bearer, name, args) => {
    const res = await (
      await rpc(bearer, "tools/call", { name, arguments: args })
    ).json();
    const text = res.result?.content?.[0]?.text ?? JSON.stringify(res.error);
    const refused = res.result?.isError === true || !res.result;
    return { refused, text, value: refused ? null : JSON.parse(text) };
  };
  const mine = await call(grant.access_token, "read", { limit: 200 });
  const acme = seeds[orgs[0].slug];
  check(
    "read is Wile's brain only",
    mine.value?.records.length >= acme.records.length &&
      mine.value.records.every((r) => r.ownerId === orgs[0].users[0].id),
    `${mine.value?.records.length ?? mine.text} records, all Wile's`,
  );
  const badSince = await call(grant.access_token, "read", {
    since: "yesterday",
  });
  check(
    "a malformed time is refused at the door, not in the database",
    badSince.refused && /since/.test(badSince.text),
    badSince.text.replace(/\s+/g, " ").slice(0, 80),
  );
  const claim = {
    kind: "claim",
    layer: "derived",
    source: "claude",
    sourceRef: "smoke-1",
    title: "Wile owes Road Runner an anvil",
    confidence: 0.8,
  };
  const undefinedKind = await call(grant.access_token, "write", {
    records: [claim],
  });
  check(
    "an undefined kind is refused with a sentence",
    undefinedKind.refused && /define it/.test(undefinedKind.text),
    undefinedKind.text,
  );
  const written = await call(grant.access_token, "write", {
    kinds: [{ name: "claim", description: "Something the model concluded." }],
    records: [claim],
  });
  const same = await call(grant.access_token, "write", { records: [claim] });
  check(
    "write, idempotently",
    written.value?.changed === 1 &&
      same.value?.changed === 0 &&
      same.value.records[0] === written.value.records[0],
    `${written.value?.changed ?? written.text} then ${same.value?.changed}`,
  );
  const claimId = written.value?.records[0];
  const log = await call(grant.access_token, "history", { of: claimId });
  check(
    "the log says the model wrote it",
    log.value?.[0]?.author === "model:Claude",
    log.value?.[0]?.author ?? log.text,
  );
  const got = await call(grant.access_token, "get", { ids: [claimId] });
  check(
    "get carries edges",
    got.value?.[0]?.id === claimId && Array.isArray(got.value[0].edges),
    got.value ? "record with edges" : got.text,
  );

  // Another org's Claude sees nothing of Wile's.
  const marge = await signIn(orgs[1].users[0].id);
  const margeCode = (await decide("allow", marge)).to?.searchParams.get("code");
  const margeGrant = await (
    await token({ ...exchange, code: margeCode })
  ).json();
  const across = await call(margeGrant.access_token, "get", { ids: [claimId] });
  check(
    "another org's token sees none of it",
    across.value?.length === 0,
    `${across.value?.length ?? across.text} records`,
  );

  // Settings lists the agent; disconnecting it ends its access.
  const sessionId = grant.access_token.split(".")[1];
  check(
    "settings lists the agent",
    (await page(`${base}/settings`, wile)).includes(sessionId),
    "listed by its session",
  );
  const disconnected = await fetch(`${base}/settings/agents`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({ session: sessionId }),
    redirect: "manual",
  });
  const after = await rpc(grant.access_token, "tools/list", {});
  check(
    "a disconnected agent's token is worthless",
    disconnected.headers.get("location")?.endsWith("agent=disconnected") &&
      after.status === 401,
    `answered ${after.status}`,
  );

  // The SDK's own client, which is what Claude Code runs, gets in end to
  // end: it discovers the server, registers, is sent to the page, and
  // trades what the person's approval sent back for a working connection.
  let held = {};
  const provider = {
    redirectUrl: redirectUri,
    clientMetadata: {
      client_name: "Claude Code",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    },
    clientInformation: () => held.client,
    saveClientInformation: (c) => (held.client = c),
    tokens: () => held.tokens,
    saveTokens: (t) => (held.tokens = t),
    redirectToAuthorization: (url) => (held.sentTo = url),
    saveCodeVerifier: (v) => (held.verifier = v),
    codeVerifier: () => held.verifier,
  };
  const sdkClient = new Client({ name: "smoke", version: "0" });
  const connect = () =>
    sdkClient.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        authProvider: provider,
      }),
    );
  const refused = await connect().then(
    () => null,
    (err) => err,
  );
  check(
    "the SDK client is sent to sign in",
    refused instanceof UnauthorizedError &&
      held.sentTo?.pathname === "/oauth/authorize" &&
      (await page(held.sentTo, wile)).includes("Connect Claude Code?"),
    held.sentTo?.pathname ?? String(refused),
  );
  const sdkApproved = await fetch(`${base}/oauth/approve`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({
      ...Object.fromEntries(held.sentTo?.searchParams ?? []),
      decision: "allow",
    }),
    redirect: "manual",
  });
  const sdkCode = new URL(
    sdkApproved.headers.get("location") ?? redirectUri,
  ).searchParams.get("code");
  await new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    authProvider: provider,
  }).finishAuth(sdkCode);
  await connect();
  const sdkTools = (await sdkClient.listTools()).tools.map((t) => t.name);
  const sdkRead = await sdkClient.callTool({
    name: "read",
    arguments: { limit: 1 },
  });
  await sdkClient.close();
  check(
    "the SDK client connects and reads",
    held.tokens?.token_type === "Bearer" &&
      DOORS.every((n) => sdkTools.includes(n)) &&
      JSON.parse(sdkRead.content[0].text).records.length === 1,
    `${sdkTools.length} tools`,
  );
  return ok;
}
