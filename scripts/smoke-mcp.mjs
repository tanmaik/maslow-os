// The brain's MCP server and the OAuth in front of it, walked as an app
// would: discovery, registration, the person's approval, the code traded for
// a token, the tools called with it, and the agent disconnected from
// settings. Returns true when every check passed.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";

import { ID } from "../packages/brain/src/ids.ts";
import { asOrg } from "../packages/db/src/index.ts";
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
  "list",
  "get",
  "graph",
  "write",
  "edit",
  "remove",
  "restore",
  "share",
  "unlink",
  "merge",
  "unmerge",
  "history",
  "redefine",
  "undefine",
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
    (await page(authorize())).includes("Sign in as one of the seeded people"),
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
  // An app's session opens the brain and nothing else; a browser's opens
  // the site and not the brain.
  const settings = (cookie) =>
    fetch(`${base}/settings`, { headers: { cookie }, redirect: "manual" });
  const asBrowser = await settings(wile);
  const asCookie = await settings(`session=${grant.access_token}`);
  const asBearer = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${wile.split("=")[1]}` },
  });
  check(
    "an app's token is not a browser's, nor a browser's an app's",
    asBrowser.status === 200 &&
      (await asBrowser.text()).includes("Access") &&
      asCookie.status === 307 &&
      new URL(asCookie.headers.get("location") ?? "", base).pathname === "/" &&
      asBearer.status === 401,
    `settings as the browser: ${asBrowser.status}; as the app: ${asCookie.status} to ${asCookie.headers.get("location")}; brain as the browser: ${asBearer.status}`,
  );
  check(
    "a code is spent once",
    (await token({ ...exchange, code: fresh })).status === 400,
    "invalid_grant",
  );

  // The brain, as the app holding the token.
  let seq = 0;
  const rpc = (bearer, method, params, headers = {}) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
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
  const told = init.result?.instructions ?? "";
  check(
    "initialize says whose brain, what it holds, and how to treat it",
    init.result?.serverInfo?.name === "brain" &&
      told.includes("Wile Coyote's brain in Acme Rockets") &&
      told.includes("connected to it as Claude") &&
      /It holds \d+ records: /.test(told) &&
      /mind, not a mirror/.test(told),
    told.split("\n")[0]?.slice(0, 100) ?? JSON.stringify(init).slice(0, 80),
  );
  const listed = await (await rpc(grant.access_token, "tools/list", {})).json();
  const names = (listed.result?.tools ?? []).map((t) => t.name);
  check(
    "the doors are the tools",
    DOORS.every((n) => names.includes(n)),
    names.join(" "),
  );
  // A call as a model's client makes it; asking for data, as a program on
  // the person's computer does.
  const call = async (bearer, name, args, headers = {}) => {
    const res = await (
      await rpc(bearer, "tools/call", { name, arguments: args }, headers)
    ).json();
    const text = res.result?.content?.[0]?.text ?? JSON.stringify(res.error);
    const refused = res.result?.isError === true || !res.result;
    const lines = text.split("\n");
    // The lines that name a record or an edge, and each one's id.
    const rows = lines.filter((l) => ID.test(l.split(" ")[0] ?? ""));
    return {
      refused,
      text,
      lines,
      rows,
      ids: rows.map((l) => l.split(" ")[0]),
      data: res.result?.structuredContent,
    };
  };
  const asData = { "maslow-answer": "data" };
  const mine = await call(grant.access_token, "list", { limit: 200 });
  const acme = seeds[orgs[0].slug];
  check(
    "read is Wile's brain only, a line each",
    mine.rows.length >= acme.records.length &&
      mine.lines[0] === `${mine.rows.length} records` &&
      mine.rows.every((l) => !l.includes(" shared:")),
    `${mine.rows.length} records, all Wile's`,
  );
  const vocabulary = await call(grant.access_token, "catalog", {});
  check(
    "the catalog is Wile's own vocabulary, and says who is in the org",
    /^types \([1-9]\d* yours\):$/.test(vocabulary.lines[0] ?? "") &&
      !vocabulary.lines.some((l) => l.startsWith("shared in")) &&
      vocabulary.lines.some((l) => /^people \([2-9]\d*\):$/.test(l)) &&
      vocabulary.lines.includes(`"Road Runner" ${orgs[0].users[1].email}`) &&
      vocabulary.lines.some((l) => l.endsWith("(the person)")),
    vocabulary.lines.filter((l) => /^people|@/.test(l)).join(" | ") ||
      vocabulary.text,
  );
  const badSince = await call(grant.access_token, "list", {
    since: "yesterday",
  });
  check(
    "a malformed time is refused at the door, not in the database",
    badSince.refused && /since/.test(badSince.text),
    badSince.text.replace(/\s+/g, " ").slice(0, 80),
  );
  const claim = {
    type: "claim",
    source: "claude",
    sourceRef: "smoke-1",
    title: "Wile owes Road Runner an anvil",
  };
  const undefinedType = await call(grant.access_token, "write", {
    records: [claim],
  });
  check(
    "an undefined type is refused with a sentence",
    undefinedType.refused && /define it/.test(undefinedType.text),
    undefinedType.text,
  );
  const written = await call(grant.access_token, "write", {
    types: [{ name: "claim" }],
    records: [claim],
  });
  const same = await call(grant.access_token, "write", { records: [claim] });
  check(
    "write, idempotently",
    written.lines[0] === "1 record (1 changed), 0 edges changed" &&
      written.lines[1] === "defined type claim" &&
      same.lines[0] === "1 record (0 changed), 0 edges changed" &&
      same.lines[1]?.startsWith(`${same.ids[0]} claim `) &&
      same.ids[0] === written.ids[0],
    `${written.lines[0]} then ${same.lines[0]}`,
  );
  const claimId = written.ids[0];
  const log = await call(grant.access_token, "history", { of: claimId });
  // The same answers as data, for a program that asked; the lines stay.
  const dataRead = await call(grant.access_token, "list", { limit: 3 }, asData);
  const dataGet = await call(
    grant.access_token,
    "get",
    { ids: [claimId] },
    asData,
  );
  const dataLog = await call(
    grant.access_token,
    "history",
    { of: claimId },
    asData,
  );
  const dataWrite = await call(
    grant.access_token,
    "write",
    { records: [claim] },
    asData,
  );
  check(
    "asked for data, a tool answers with the same thing beside its lines",
    mine.data === undefined &&
      dataRead.data?.records?.map((r) => r.id).join() === dataRead.ids.join() &&
      dataRead.lines[0].startsWith("3 records") &&
      dataGet.data?.records?.[0]?.id === claimId &&
      Array.isArray(dataGet.data.records[0].edges) &&
      dataLog.data?.changes?.[0]?.subjectId === claimId &&
      dataLog.data.changes[0].seq > 0 &&
      dataWrite.data?.records?.[0] === claimId &&
      dataWrite.data.changed === 0,
    `${dataRead.data?.records?.length ?? "no"} records as data, ${dataLog.data?.changes?.length ?? "no"} changes, write ${JSON.stringify(dataWrite.data)}`,
  );
  check(
    "the log says the model wrote it, in one line",
    log.lines[1]?.startsWith("#") &&
      log.lines[1].includes(`record ${claimId} created by=Claude:`),
    log.lines[1] ?? log.text,
  );
  const restsOn = mine.ids[0];
  const linked = await call(grant.access_token, "write", {
    edges: [
      {
        from: { id: claimId },
        verb: "rests_on",
        to: { id: restsOn },
      },
    ],
  });
  const got = await call(grant.access_token, "get", { ids: [claimId] });
  const link = got.lines.find((l) => l.startsWith("  → rests_on "));
  check(
    "get carries links, with what is at the other end",
    linked.lines[0]?.endsWith("1 edge changed") &&
      got.lines[0]?.startsWith(`${claimId} claim `) &&
      got.lines[0].includes(`"Wile owes`) &&
      link?.includes(`${restsOn} "`) &&
      /edge=\S+$/.test(link),
    link ?? got.text,
  );
  const edgeId = link?.match(/edge=(\S+)/)?.[1];
  const hidden = await call(grant.access_token, "unlink", { ids: [edgeId] });
  const unlinkedGet = await call(grant.access_token, "get", { ids: [claimId] });
  const relinked = await call(grant.access_token, "restore", {
    edges: [edgeId],
  });
  const relinkedGet = await call(grant.access_token, "get", { ids: [claimId] });
  check(
    "a link is hidden, not erased, and comes back",
    hidden.lines[0] === `unlinked ${edgeId}` &&
      !unlinkedGet.lines.some((l) => l.startsWith("  → rests_on ")) &&
      relinked.lines[0] === `restored edges ${edgeId}` &&
      relinkedGet.lines.some((l) => l.startsWith("  → rests_on ")),
    `${hidden.text} / ${relinked.text}`,
  );
  const retitled = await call(grant.access_token, "edit", {
    changes: [{ id: claimId, title: "Wile owes Road Runner two anvils" }],
  });
  const ownLog = await call(grant.access_token, "history", {
    of: claimId,
    limit: 1,
  });
  const last = Number(ownLog.lines[1]?.match(/^#(\d+) /)?.[1]);
  const claimLog = await call(grant.access_token, "history", {
    of: claimId,
    limit: 200,
  });
  const first = Number(claimLog.lines.at(-1)?.match(/^#(\d+) /)?.[1]);
  const early = await call(grant.access_token, "revert", { changes: [first] });
  const undone = await call(grant.access_token, "revert", { changes: [last] });
  const backAgain = await call(grant.access_token, "get", { ids: [claimId] });
  check(
    "a change is walked back by its number, the latest only",
    retitled.lines[0]?.includes("two anvils") &&
      last > first &&
      early.refused &&
      /is not the latest change/.test(early.text) &&
      undone.lines[0] === `record ${claimId} as before #${last}` &&
      backAgain.lines[0]?.includes('"Wile owes Road Runner an anvil"'),
    `${early.text} / ${undone.text}`,
  );
  const walked = await call(grant.access_token, "graph", {
    from: [claimId],
    verbs: ["rests_on"],
    direction: "out",
  });
  const capped = await call(grant.access_token, "graph", {
    from: [claimId],
    limit: 1,
  });
  check(
    "graph walks out along a verb, and no further than the limit",
    walked.lines[0] === "2 records, 1 edge" &&
      capped.lines[0] === "1 record, 0 edges" &&
      walked.lines.some(
        (l) => l.startsWith(`${claimId} claim`) && l.endsWith(" d0"),
      ) &&
      walked.lines.some(
        (l) => l.startsWith(`${restsOn} `) && l.endsWith(" d1"),
      ),
    walked.lines[0] ?? walked.text,
  );

  // The vocabulary bends after the fact: a field is added, renamed and
  // retyped only as far as its values allow, a type is renamed with its
  // records, and neither leaves while anything depends on it.
  await call(grant.access_token, "write", {
    types: [
      {
        name: "claim",
        properties: [{ name: "strength", datatype: "number" }],
      },
    ],
  });
  const edited = await call(grant.access_token, "edit", {
    changes: [{ id: claimId, props: { strength: 3 } }],
  });
  const retyped = await call(grant.access_token, "redefine", {
    fields: [{ type: "claim", name: "strength", datatype: "text" }],
  });
  check(
    "a field is not retyped over values that would not fit",
    edited.lines[0]?.includes('{"strength":3}') &&
      retyped.refused &&
      retyped.text ===
        "strength of 1 claim record is not a text, removed ones included; fix them first",
    retyped.text,
  );
  const renamedField = await call(grant.access_token, "redefine", {
    fields: [{ type: "claim", name: "strength", newName: "weight" }],
    types: [{ name: "claim", newName: "conclusion" }],
  });
  const conclusions = await call(grant.access_token, "list", {
    type: "conclusion",
  });
  check(
    "a type and a field are renamed and their records follow",
    renamedField.lines.includes("type claim → conclusion") &&
      renamedField.lines.includes("claim.weight: number") &&
      conclusions.ids[0] === claimId &&
      conclusions.rows[0].includes('{"weight":3}'),
    conclusions.rows[0] ?? conclusions.text,
  );
  const stuck = await call(grant.access_token, "undefine", {
    types: ["conclusion"],
  });
  const dropped = await call(grant.access_token, "undefine", {
    fields: [{ type: "conclusion", name: "weight" }],
  });
  const now = await call(grant.access_token, "get", { ids: [claimId] });
  const moved = await call(grant.access_token, "edit", {
    changes: [{ id: claimId, type: "note", props: {} }],
  });
  const gone = await call(grant.access_token, "undefine", {
    types: ["conclusion"],
  });
  check(
    "a type leaves only once nothing live is of it; a field takes its values",
    stuck.refused &&
      stuck.text ===
        "records are still conclusion; change or remove them first" &&
      dropped.lines[0] === "removed field conclusion.weight from 1 record" &&
      !now.lines[0].includes("weight") &&
      moved.lines[0]?.startsWith(`${claimId} note `) &&
      gone.lines[0] === "removed type conclusion",
    `${stuck.text} / ${dropped.text} / ${moved.lines[0]} / ${gone.text}`,
  );

  // A removed type is hidden, not erased: it leaves the catalog, its name
  // stays its own, a removed record of it waits for it, and restore brings
  // it back as it was, with its fields.
  const scrap = await call(grant.access_token, "write", {
    types: [
      { name: "scrap", properties: [{ name: "grade", datatype: "number" }] },
    ],
    records: [
      {
        type: "scrap",
        source: "claude",
        sourceRef: "scrap-1",
        title: "A scrap",
        props: { grade: 2 },
      },
      {
        type: "scrap",
        source: "claude",
        sourceRef: "scrap-2",
        title: "An ungraded scrap",
      },
    ],
  });
  const [scrapId, ungradedId] = scrap.ids;
  const graded = await call(grant.access_token, "list", {
    type: "scrap",
    orderBy: { property: "grade", direction: "desc" },
    limit: 1,
  });
  const tail = await call(grant.access_token, "list", {
    type: "scrap",
    orderBy: { property: "grade", direction: "desc" },
    cursor: graded.lines[0]?.match(/cursor=(\S+)/)?.[1],
  });
  check(
    "ordering by a field keeps records that lack it, after the rest",
    scrap.lines.includes("defined field scrap.grade") &&
      graded.ids[0] === scrapId &&
      tail.ids[0] === ungradedId &&
      tail.lines[0] === "1 record",
    `${graded.lines[0]} / ${tail.lines[0]}`,
  );
  await call(grant.access_token, "remove", { ids: [scrapId, ungradedId] });
  const scrapGone = await call(grant.access_token, "undefine", {
    types: ["scrap"],
  });
  const without = await call(grant.access_token, "catalog", {});
  const reuse = await call(grant.access_token, "write", {
    types: [{ name: "scrap" }],
  });
  const tooSoon = await call(grant.access_token, "restore", { ids: [scrapId] });
  const scrapLog = await call(grant.access_token, "history", {
    of: scrapId,
    limit: 1,
  });
  const tooSoonBack = await call(grant.access_token, "revert", {
    changes: [Number(scrapLog.lines[1]?.match(/^#(\d+) /)?.[1])],
  });
  const back = await call(grant.access_token, "restore", { types: ["scrap"] });
  const withIt = await call(grant.access_token, "catalog", {});
  const restored = await call(grant.access_token, "restore", {
    ids: [scrapId, ungradedId],
  });
  check(
    "a removed type is hidden with its records and comes back before them",
    scrapGone.lines[0] === "removed type scrap" &&
      !without.lines.some((l) => l === "scrap") &&
      reuse.refused &&
      reuse.text ===
        "type scrap is removed; restore it, or choose another name" &&
      tooSoon.refused &&
      tooSoon.text ===
        `record ${scrapId} is a scrap, which is removed; restore the type first` &&
      tooSoonBack.refused &&
      tooSoonBack.text === tooSoon.text &&
      back.lines[0] === "restored type scrap" &&
      withIt.lines.includes("  grade: number") &&
      restored.lines[0] === `restored ${scrapId} ${ungradedId}`,
    `${scrapGone.text} / ${reuse.text} / ${tooSoon.text} / ${back.text} / ${restored.text}`,
  );

  // A name that would forge a line is refused.
  const forged = await call(grant.access_token, "write", {
    types: [{ name: "note removed" }],
  });
  check(
    "a forged name is refused",
    forged.refused && forged.text.includes("that print"),
    forged.text,
  );

  // The person's apps: nothing until one is connected; then find names the
  // actions that fit, run runs one as the person, and an app not connected
  // is refused with where to connect it.
  const none = await call(grant.access_token, "apps", {});
  const begun = await fetch(`${base}/settings/connections`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({ intent: "connect", app: "pigeon" }),
    redirect: "manual",
  });
  await fetch(begun.headers.get("location"), {
    headers: { cookie: wile },
    redirect: "manual",
  });
  const apps = await call(grant.access_token, "apps", {});
  const account = apps.lines[0]?.match(/account=(pretend_[0-9a-f]{8})/)?.[1];
  const fits = await call(grant.access_token, "find", {
    task: "send a message to someone",
  });
  const sent = await call(grant.access_token, "run", {
    action: "PIGEON_SEND",
    inputs: { to: "Road Runner", body: "Beep." },
  });
  const unconnected = await call(grant.access_token, "run", {
    action: "SUNDIAL_TODAY",
  });
  const short = await call(grant.access_token, "run", {
    action: "PIGEON_SEND",
    inputs: { to: "Road Runner" },
  });
  const named = await call(grant.access_token, "find", {
    task: "today's events",
    apps: ["sundial"],
  });
  check(
    "apps: find names what fits, run runs it as the person",
    none.text.startsWith("no apps connected") &&
      apps.lines[0] === `pigeon "Carrier Pigeon" account=${account} ACTIVE` &&
      fits.lines[0] === "PIGEON_SEND (pigeon) — Sends a message by pigeon." &&
      fits.lines[1] === "  to: string, required — Who." &&
      sent.lines[0] === "source=pigeon action=PIGEON_SEND" &&
      sent.lines[2] ===
        `{"id":"pgn_1","sent":true,"to":"Road Runner","from":"${account}"}` &&
      unconnected.refused &&
      unconnected.text === "connect sundial in settings first" &&
      named.refused &&
      named.text === "connect sundial in settings first" &&
      short.refused &&
      short.text === "missing body",
    `${apps.lines[0]} / ${fits.lines[0]} / ${unconnected.text} / ${named.text}`,
  );
  // A second account in the same app: apps names both, run refuses until
  // told which, and runs in the one named.
  const again = await fetch(`${base}/settings/connections`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({ intent: "connect", app: "pigeon" }),
    redirect: "manual",
  });
  const verified = await fetch(again.headers.get("location"), {
    headers: { cookie: wile },
    redirect: "manual",
  });
  const second = verified.headers
    .get("location")
    ?.match(/account=(pretend_[0-9a-f]{8})/)?.[1];
  await fetch(`${base}/settings/connections`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({
      intent: "rename",
      account: second,
      name: "home",
    }),
    redirect: "manual",
  });
  const two = await call(grant.access_token, "apps", {});
  const which = await call(grant.access_token, "run", {
    action: "PIGEON_SEND",
    inputs: { to: "Road Runner", body: "Beep." },
  });
  const chosen = await call(grant.access_token, "run", {
    action: "PIGEON_SEND",
    inputs: { to: "Road Runner", body: "Beep." },
    account: second,
  });
  const nobody = await call(grant.access_token, "run", {
    action: "PIGEON_SEND",
    inputs: { to: "Road Runner", body: "Beep." },
    account: "pretend_00000000",
  });
  check(
    "two accounts in one app: run is told which",
    two.lines.length === 2 &&
      two.lines[1] ===
        `pigeon "Carrier Pigeon" account=${second} "home" ACTIVE` &&
      which.refused &&
      which.text ===
        `pigeon has 2 accounts; say which: ${account}, ${second} "home"` &&
      chosen.lines[0] === "source=pigeon action=PIGEON_SEND" &&
      chosen.lines[2].endsWith(`,"from":"${second}"}`) &&
      nobody.refused &&
      nobody.text === "no account pretend_00000000 in pigeon",
    `${two.lines[1]} / ${which.text} / ${nobody.text}`,
  );
  // What Wile spent, as the ledger holds it: nothing shows it yet.
  const spent = (resource) =>
    asOrg(
      orgs[0].id,
      async (q) =>
        (
          await q.query(
            "select coalesce(sum(quantity), 0)::float8 as q from usage where user_id = $1 and resource = $2",
            [orgs[0].users[0].id, resource],
          )
        ).rows[0].q,
    );
  const charged = await spent("actions");
  check(
    "every action is on the meter: the search and the two runs that ran",
    charged === 3,
    `${charged} actions`,
  );

  // Search finds a record by its words first and then by what it is about,
  // catching up the vectors of whatever changed since it was last asked.
  const wanted = mine.rows[1]?.match(/"([^"]*)"/)?.[1] ?? "";
  const recalled = await call(grant.access_token, "search", {
    query: `anything about ${wanted}`,
    limit: 3,
  });
  check(
    "search finds a record by its words and its meaning",
    recalled.lines[0] === "3 records, by words then by meaning" &&
      recalled.lines[1]?.split(" ")[1] === mine.ids[1] &&
      /^(words|0\.\d\d) /.test(recalled.lines[1]),
    recalled.lines[1]?.slice(0, 60) ?? recalled.text,
  );
  const wordless = await call(grant.access_token, "search", { query: "?!" });
  check(
    "a question without a word is refused",
    wordless.refused && wordless.text === "a search needs a word",
    wordless.text,
  );
  const metered = await spent("vectors");
  check(
    "every token search spent is on the meter",
    metered > 0,
    `${metered} tokens`,
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
    across.text === "no records",
    across.text,
  );

  // A colleague's Claude sees the colleague's own types and the one type
  // Wile shared with the org, read as Wile's and never reshaped by them.
  const roadRunner = await signIn(orgs[0].users[1].id);
  const colleagueCode = (
    await decide("allow", roadRunner)
  ).to?.searchParams.get("code");
  const colleagueGrant = await (
    await token({ ...exchange, code: colleagueCode })
  ).json();
  const theirs = await call(colleagueGrant.access_token, "catalog", {});
  const theirLog = await call(colleagueGrant.access_token, "history", {
    limit: 200,
  });
  check(
    "the log shows a colleague the share that reached them, and who joined",
    theirLog.lines.some((l) =>
      / share \S+ created by=colleague: type lift to everyone at view$/.test(l),
    ) &&
      theirLog.lines.some((l) => / member \S+ created by=/.test(l)) &&
      !theirLog.lines.some((l) =>
        /record \S+ created by=colleague: claim /.test(l),
      ),
    theirLog.lines.find((l) => / share /.test(l)) ?? theirLog.lines[0],
  );
  const lift = theirs.lines.find((l) => l.startsWith("lift owner="));
  const lifts = await call(colleagueGrant.access_token, "list", {
    type: "lift",
    owner: orgs[0].users[0].id,
  });
  const shared = await call(colleagueGrant.access_token, "search", {
    query: "a barbell exercise",
    type: "lift",
    limit: 1,
  });
  // The agent's share only asks; the colleague sees nothing until the
  // person accepts.
  const asked = await call(grant.access_token, "share", {
    records: [claimId],
    to: [orgs[0].users[1].email],
    level: "view",
    reason: "Road Runner should know what Wile owes.",
  });
  const notYet = await call(colleagueGrant.access_token, "get", {
    ids: [claimId],
  });
  check(
    "share asks, and shares nothing until the person accepts",
    /^asked \S+ as notification \S+: 1 item to 1 party at view; the person decides$/.test(
      asked.lines[0] ?? "",
    ) && notYet.text === "no records",
    `${asked.lines[0]} / ${notYet.text}`,
  );
  // A file on the person's computer is asked for the same way, at view or
  // edit, and only with a computer to share it from.
  const askedFile = await call(grant.access_token, "share", {
    files: ["/home/me/plans/roadmap.md"],
    to: [orgs[0].users[1].email],
    level: "edit",
    reason: "Road Runner is drafting the roadmap too.",
  });
  check(
    "share asks for a file, or says there is no computer",
    /^asked \S+ as notification \S+: 1 item to 1 party at edit; the person decides$/.test(
      askedFile.lines[0] ?? "",
    ) || /no computer ready/.test(askedFile.text),
    askedFile.lines[0] ?? askedFile.text,
  );
  // The desktop is the agent's to arrange, and a widget is an app on a port
  // of the person's computer: put down, listed, moved by its id alone,
  // and taken off. A colleague's desktop is their own.
  const noDesk = await call(grant.access_token, "desktop", {});
  const noShown = await call(grant.access_token, "place", { x: 0.5 });
  const putDown = await call(grant.access_token, "place", {
    port: 3000,
    title: "Launch board",
    x: 0.1,
    y: 0.05,
    w: 0.3,
    h: 0.3,
  });
  const widgetId = putDown.lines[0]?.split(" ")[0] ?? "";
  const onDesk = await call(grant.access_token, "desktop", {});
  const shifted = await call(grant.access_token, "place", {
    id: widgetId,
    x: 0.5,
  });
  const theirDesk = await call(colleagueGrant.access_token, "desktop", {});
  const takenOff = await call(grant.access_token, "unplace", { id: widgetId });
  const cleared = await call(grant.access_token, "desktop", {});
  const noWidget = await call(grant.access_token, "unplace", { id: widgetId });
  check(
    "the agent places a widget on the desktop, moves it, and takes it off",
    noDesk.text === "nothing is on the desktop" &&
      noShown.refused &&
      noShown.text === "a widget shows a port" &&
      /^[a-z0-9]{4,16} "Launch board" \/port\/\S+\/3000 at 0\.10,0\.05 size 0\.30×0\.30$/.test(
        putDown.lines[0] ?? "",
      ) &&
      onDesk.text === putDown.text &&
      shifted.lines[0]?.startsWith(`${widgetId} "Launch board"`) &&
      shifted.lines[0]?.includes("at 0.50,0.05") &&
      theirDesk.text === "nothing is on the desktop" &&
      takenOff.text === `took ${widgetId} off the desktop` &&
      cleared.text === "nothing is on the desktop" &&
      noWidget.refused,
    `${putDown.lines[0]} / ${shifted.lines[0]} / ${takenOff.text} / ${cleared.text} / ${noWidget.text}`,
  );
  const notTheirs = await call(colleagueGrant.access_token, "redefine", {
    types: [{ name: "lift", newName: "lifts" }],
  });
  check(
    "a colleague's catalog is their own and what was shared",
    theirs.lines.includes("shared in (1):") &&
      lift === `lift owner=${orgs[0].users[0].email}` &&
      !theirs.lines.some((l) => l.startsWith("person ")) &&
      lifts.lines[0] === "3 records" &&
      shared.lines[0] === "1 record, by words then by meaning" &&
      lifts.ids.includes(shared.lines[1]?.split(" ")[1]) &&
      notTheirs.refused &&
      notTheirs.text === "lift is a colleague's type; only they change it",
    `${theirs.lines[0]}; ${lift ?? theirs.text}; ${lifts.lines[0]}; ${shared.lines[0]}; ${notTheirs.text}`,
  );

  // Settings lists the agent; disconnecting it ends its access.
  const sessionId = grant.access_token.split(".")[1];
  check(
    "settings lists the agent",
    (await page(`${base}/settings?pane=access`, wile)).includes(sessionId),
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
    name: "list",
    arguments: { limit: 1 },
  });
  await sdkClient.close();
  check(
    "the SDK client connects and reads",
    held.tokens?.token_type === "Bearer" &&
      DOORS.every((n) => sdkTools.includes(n)) &&
      sdkRead.content[0].text.startsWith("1 record"),
    `${sdkTools.length} tools`,
  );

  // An app that publishes its description at an address, as Claude Code
  // does, is read from there, at a name that has to be looked up: the page
  // names it, and the token endpoint takes the address as its client id.
  // It registers its callback without a port, as a command-line app that
  // takes whatever port is free does.
  const described = createServer((req, res) => {
    const at = `http://localhost:${described.address().port}${req.url}`;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        client_id: req.url === "/client.json" ? at : "https://elsewhere.test",
        client_name: "Described",
        redirect_uris: ["http://localhost/callback"],
      }),
    );
  });
  await new Promise((r) => described.listen(0, r));
  const documentAt = (name) =>
    `http://localhost:${described.address().port}/${name}`;
  const askDescribed = { ...ask, client_id: documentAt("client.json") };
  const describedConsent = await page(authorize(askDescribed), wile);
  const describedCode = new URL(
    (
      await fetch(`${base}/oauth/approve`, {
        method: "POST",
        headers: { cookie: wile },
        body: new URLSearchParams({ ...askDescribed, decision: "allow" }),
        redirect: "manual",
      })
    ).headers.get("location") ?? redirectUri,
  ).searchParams.get("code");
  const describedGrant = await (
    await token({
      ...exchange,
      code: describedCode,
      client_id: askDescribed.client_id,
    })
  ).json();
  const describedRead = await call(describedGrant.access_token, "list", {
    limit: 1,
  });
  const misnamed = await page(
    authorize({ ...ask, client_id: documentAt("other.json") }),
    wile,
  );
  described.close();
  check(
    "an app described at an address is read from it",
    server.client_id_metadata_document_supported === true &&
      describedConsent.includes("Connect Described?") &&
      describedRead.lines[0]?.startsWith("1 record") &&
      misnamed.includes("unknown app"),
    describedRead.lines[0] ?? describedRead.text,
  );
  return ok;
}
