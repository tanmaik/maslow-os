// Boots the stack on a fresh database of its own, signs in as a person from
// each org through the development sign-in, checks that each sees only their
// own org, and that an invited email is admitted into the inviting org. This
// is the merge gate.
import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { sizeFor } from "../apps/web/lib/computer.ts";
import { measure } from "../apps/web/lib/meter.ts";
import { KINDS } from "../apps/web/lib/orphans.ts";
import {
  dollars,
  LADDER,
  monthly,
  PRICES,
  rate,
  sizeName,
  spent,
} from "../apps/web/lib/prices.ts";
import {
  createSession,
  foundOrg,
  membershipsOf,
  personOf,
  signIn as admit,
} from "../packages/db/src/auth.ts";
import { KEPT } from "../packages/db/src/computers.ts";
import { asEmail, asOrg, asPerson } from "../packages/db/src/index.ts";
import { orgs } from "../packages/db/src/seed.ts";
import { allow } from "../packages/db/src/throttle.ts";

import { IDLE_MS, startFakeFly } from "./fake-fly.mjs";
import { smokeBrain } from "./smoke-brain.mjs";
import { smokeConnections } from "./smoke-connections.mjs";
import { smokeDb } from "./smoke-db.mjs";
import { smokeMcp } from "./smoke-mcp.mjs";
import { freePort, root, startStack } from "./stack.mjs";

// The smoke carries no credentials: a checkout's pulled config must not reach
// it. Next leaves a variable alone once it is set, even to nothing.
const noCredentials = Object.fromEntries(
  [
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "RESEND_API_KEY",
    "MAIL_FROM",
    "POSTHOG_KEY",
    "STORAGE_ENDPOINT",
    "STORAGE_REGION",
    "STORAGE_BUCKET",
    "STORAGE_ACCESS_KEY",
    "STORAGE_SECRET_KEY",
    "COMPOSIO_API_KEY",
  ].map((k) => [k, ""]),
);

// Everything this run writes — the database, the fake machines' disks, the
// local store — lives in a directory of its own and dies with it, so a
// checkout's own data, the last run's and a run beside it never reach it.
await fs.mkdir(path.join(root, ".local"), { recursive: true });
const scratch = await fs.mkdtemp(path.join(root, ".local", "smoke-"));

// Fly is faked: computers are built and run against a server in this process.
const fake = await startFakeFly({ dir: path.join(scratch, "computers") });
const webPort = await freePort();
const stack = await startStack({
  webPort,
  stdio: "ignore",
  dataDir: path.join(scratch, "pg"),
  distDir: ".next-smoke",
  fresh: true,
  secrets: false,
  env: {
    ...noCredentials,
    UPLOADS_DIR: path.join(scratch, "uploads"),
    FLY_API_TOKEN: "fake",
    FLY_COMPUTERS_APP: "fake",
    FLY_API_HOST: fake.url,
    FLY_MACHINES_HOST: fake.url,
    LINK_SECRET: "smoke-link",
    FLY_REPORT_URL: `http://127.0.0.1:${webPort}/computer/report`,
    FLY_NAME_PREFIX: "pr0-",
    CRON_SECRET: "smoke",
    FILES_PART_SIZE: "3600",
  },
});

// Signs in as a seeded person and returns the session cookie.
async function signIn(userId) {
  const res = await fetch(`${stack.url}/auth/dev`, {
    method: "POST",
    body: new URLSearchParams({ user: userId }),
    redirect: "manual",
  });
  const cookie = res.headers.get("set-cookie")?.match(/session=[^;]+/)?.[0];
  if (res.status !== 303 || !cookie)
    throw new Error(`dev sign-in as ${userId} answered ${res.status}`);
  return cookie;
}

async function page(cookie) {
  const res = await fetch(stack.url, { headers: cookie ? { cookie } : {} });
  return (await res.text()).replaceAll("<!-- -->", "");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A membership's computer row, as the org sees it.
async function rowOf(orgId, userId) {
  const { asOrg } = await import("../packages/db/src/index.ts");
  return asOrg(
    orgId,
    async (q) =>
      (
        await q.query(
          "select id, machine_id, volume_id, state, size, off_at, busy_until from computers where user_id = $1",
          [userId],
        )
      ).rows[0],
  );
}

// Waits for a membership's computer to be made and running, as a sign-in
// makes it behind the response; `not` names a machine that must have been
// replaced first.
async function built(orgId, userId, { not = null } = {}) {
  for (let i = 0; i < 240; i++) {
    const r = await rowOf(orgId, userId);
    if (r?.machine_id && r.machine_id !== not && r.state === "started")
      return r;
    await sleep(250);
  }
  throw new Error(
    `no running computer for ${userId} within a minute: ${JSON.stringify(await rowOf(orgId, userId))}`,
  );
}

let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(40)} ${detail}`);
  failed ||= !ok;
};

try {
  await stack.ready();

  const out = await page();
  check(
    "signed out",
    out.includes("Pick a person from the pill"),
    "sign-in page",
  );

  // The first org signs in again at the end: its second visit reuses a pooled
  // connection where an old org setting exists as '' rather than missing.
  for (const org of [...orgs, orgs[0]]) {
    const html = await page(await signIn(org.users[0].id));
    const got = html.match(/(\d+) members?/);
    check(
      `${org.users[0].firstName} (${org.name})`,
      new RegExp(`<h1[^>]*>${org.name}</h1>`).test(html) &&
        Number(got?.[1]) === org.users.length,
      got?.[0] ?? "no match",
    );
  }

  // A signed-in browser stays signed in: every visit renews the cookie for the
  // longest life a browser grants. Signing out deletes the session, and the
  // old cookie is worthless afterwards.
  const marge = await signIn(orgs[1].users[0].id);
  const visit = await fetch(stack.url, {
    headers: { cookie: marge },
    redirect: "manual",
  });
  const renewed = visit.headers.get("set-cookie") ?? "";
  check(
    "session renewed on visit",
    renewed.includes(marge) && /max-age=34560000/i.test(renewed),
    renewed.match(/max-age=\d+/i)?.[0] ?? "no set-cookie",
  );
  const bye = await fetch(`${stack.url}/auth/sign-out`, {
    method: "POST",
    headers: { cookie: marge },
    redirect: "manual",
  });
  check(
    "sign out",
    bye.status === 303 &&
      /^session=;/.test(bye.headers.get("set-cookie") ?? ""),
    `answered ${bye.status}, ${bye.headers.get("set-cookie")?.split(";")[0]}`,
  );
  check(
    "old cookie worthless after sign-out",
    (await page(marge)).includes("Pick a person from the pill"),
    "sign-in page",
  );

  // Acme invites an email; when the identity provider vouches for it, the
  // person lands in Acme. Admission is the same function the callback calls,
  // run against this stack's database.
  const wile = await signIn(orgs[0].users[0].id);
  const invited = await fetch(`${stack.url}/invite`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({ email: "hire@acme-rockets.test" }),
    redirect: "manual",
  });
  check(
    "invite",
    invited.headers.get("location")?.endsWith("/settings?invite=sent") === true,
    `answered ${invited.status} → ${invited.headers.get("location")?.split("?")[1]}`,
  );
  const settingsPage = async (cookie) =>
    (
      await (
        await fetch(`${stack.url}/settings`, { headers: { cookie } })
      ).text()
    ).replaceAll("<!-- -->", "");
  check(
    "invitation pending",
    (await settingsPage(wile)).includes("hire@acme-rockets.test"),
    "listed",
  );
  const anonymous = await fetch(`${stack.url}/invite`, {
    method: "POST",
    body: new URLSearchParams({ email: "x@y.test" }),
    redirect: "manual",
  });
  check(
    "invite signed out",
    anonymous.status === 401,
    `answered ${anonymous.status}`,
  );

  process.env.DATABASE_URL = `postgres://app@127.0.0.1:${stack.pgPort}/postgres`;
  const hire = await admit({
    email: "hire@acme-rockets.test",
    firstName: "New",
    lastName: "Hire",
  });
  const after = await page(wile);
  check(
    "invited person admitted",
    hire.orgId === orgs[0].id &&
      /3 members?/.test(after) &&
      !/invited/.test(
        (await settingsPage(wile))
          .split("hire@acme-rockets.test")[1]
          ?.slice(0, 200) ?? "",
      ),
    after.match(/\d+ members?/)?.[0] ?? "no match",
  );
  const stranger = await admit({
    email: "solo@example.test",
    firstName: "Solo",
    lastName: null,
  });
  check(
    "uninvited person gets an org of one",
    !orgs.some((o) => o.id === stranger.orgId),
    stranger.orgId,
  );

  // Inviting an address that already belongs to someone, or one already
  // invited, says so instead of pretending.
  const twice = await fetch(`${stack.url}/invite`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({ email: "hire@acme-rockets.test" }),
    redirect: "manual",
  });
  check(
    "inviting a member says so",
    twice.headers.get("location")?.endsWith("/settings?invite=member") === true,
    twice.headers.get("location") ?? "no redirect",
  );
  await fetch(`${stack.url}/invite`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({ email: "later@acme-rockets.test" }),
    redirect: "manual",
  });
  const again = await fetch(`${stack.url}/invite`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({ email: "later@acme-rockets.test" }),
    redirect: "manual",
  });
  check(
    "inviting twice says pending",
    again.headers.get("location")?.endsWith("/settings?invite=pending") ===
      true,
    again.headers.get("location") ?? "no redirect",
  );

  // A real session id under the wrong org is nobody.
  const [, wileSession] = wile.replace("session=", "").split(".");
  check(
    "session under another org",
    (await page(`session=${orgs[1].id}.${wileSession}`)).includes(
      "Pick a person from the pill",
    ),
    "sign-in page",
  );

  // Abuse limits: a key gets its limit of hits per window and no more, and
  // two first sign-ins racing for one email both land on one row.
  const hits = [];
  for (let i = 0; i < 4; i++) hits.push(await allow("email:x@y.test", 3, 600));
  check(
    "throttle",
    hits.join() === "true,true,true,false",
    hits.map((h) => (h ? "ok" : "no")).join(" "),
  );
  const raced = await Promise.all(
    [1, 2, 3].map(() =>
      admit({ email: "race@example.test", firstName: "Race", lastName: null }),
    ),
  );
  check(
    "racing first sign-ins share one row",
    new Set(raced.map((r) => r.userId)).size === 1,
    `${new Set(raced.map((r) => r.userId)).size} rows`,
  );
  // Settings: the org and the person can be renamed, a logo lands in local
  // storage and is served back, a member can be removed but not oneself, and
  // an invitation can be withdrawn. Every write stays inside the org.
  const otto = await signIn("20000000-0000-4000-8000-000000000002");
  const margeOwner = await signIn("20000000-0000-4000-8000-000000000001");
  const settings = async (path, body, cookie = margeOwner) =>
    fetch(`${stack.url}${path}`, {
      method: "POST",
      body,
      headers: { cookie },
      redirect: "manual",
    });
  const orgForm = new FormData();
  orgForm.set("name", "Blue Whale Bakery & Co");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  orgForm.set("logo", new File([png], "l.png", { type: "image/png" }));
  const renamed = await settings("/settings/org", orgForm);
  const afterRename = await settingsPage(margeOwner);
  check(
    "org renamed, logo stored",
    renamed.headers.get("location")?.endsWith("?org=saved") &&
      afterRename.includes("Blue Whale Bakery &amp; Co") &&
      /\/uploads\/[0-9a-f]{32}\.png/.test(afterRename),
    `${renamed.status} ${renamed.headers.get("location")?.split("?")[1]}`,
  );
  const logoUrl = afterRename.match(/\/uploads\/[0-9a-f]{32}\.png/)?.[0];
  const served = await fetch(`${stack.url}${logoUrl}`);
  check(
    "logo served back",
    served.status === 200 && served.headers.get("content-type") === "image/png",
    `${served.status} ${served.headers.get("content-type")}`,
  );
  const wileHome = await page(wile);
  check(
    "rename stays in its org",
    /<h1[^>]*>Acme Rockets<\/h1>/.test(wileHome) &&
      !/<h1[^>]*>[^<]*Bakery/.test(wileHome),
    "Acme unchanged",
  );
  const profileForm = new FormData();
  profileForm.set("first_name", "Otto");
  profileForm.set("last_name", "L.");
  await settings("/settings/profile", profileForm, otto);
  check(
    "profile renamed",
    (await page(otto)).includes("Sign out, Otto L."),
    "Sign out, Otto L.",
  );
  const selfRemove = await settings(
    "/settings/members",
    new URLSearchParams({ remove: "20000000-0000-4000-8000-000000000001" }),
  );
  check(
    "cannot remove oneself",
    selfRemove.headers.get("location")?.endsWith("member=self"),
    selfRemove.headers.get("location")?.split("?")[1],
  );
  const pim = await signIn("20000000-0000-4000-8000-000000000003");
  await built(orgs[1].id, "20000000-0000-4000-8000-000000000003");
  // Pim writes a note before leaving. Removed, he is a past member: hidden
  // from the roster, listed under past members, his note kept under the
  // membership he held. Brought back, or invited back, he is the same member
  // with the same note. Purged, he and the note are gone.
  const noted = await fetch(`${stack.url}/brain/records`, {
    method: "POST",
    headers: { cookie: pim },
    body: new URLSearchParams({
      kind: "note",
      title: "Ovens",
      body: "Preheat by five.",
    }),
    redirect: "manual",
  });
  check(
    "member writes a note",
    noted.status === 303,
    `answered ${noted.status}`,
  );
  const pimId = "20000000-0000-4000-8000-000000000003";
  const remove = (cookie = margeOwner) =>
    settings(
      "/settings/members",
      new URLSearchParams({ remove: pimId }),
      cookie,
    );
  const pimRemove = await remove();
  const afterRemove = await settingsPage(margeOwner);
  // A form button that acts on Pim, whichever order its attributes render in.
  const button = (name) =>
    new RegExp(`<button(?=[^>]*name="${name}")(?=[^>]*value="${pimId}")`);
  check(
    "member removed",
    pimRemove.headers.get("location")?.endsWith("member=removed") &&
      !button("remove").test(afterRemove) &&
      afterRemove.includes("Show 1 past member") &&
      button("restore").test(afterRemove),
    "off the roster, under past members",
  );
  check(
    "removed member's session is dead",
    (await page(pim)).includes("Pick a person from the pill"),
    "sign-in page",
  );
  check(
    "a member sees no past members",
    !(await settingsPage(otto)).includes("Show 1 past member"),
    "no past members for Otto",
  );
  const bakery = orgs.find((o) => o.users.some((u) => u.id === pimId));
  const pimSeed = bakery.users.find((u) => u.id === pimId);
  // Read as the org naming the old membership, which no person can be now.
  const pimNotes = () =>
    asOrg(bakery.id, async (q) => {
      await q.query("select set_config('app.member_id', $1, true)", [pimId]);
      return (
        await q.query(
          "select count(*)::int as n from records where title = 'Ovens'",
        )
      ).rows[0].n;
    });
  const pimEvents = () =>
    asOrg(bakery.id, async (q) => {
      await q.query("select set_config('app.member_id', $1, true)", [pimId]);
      return (
        await q.query(
          "select count(*)::int as n from events where person_id = $1",
          [pimId],
        )
      ).rows[0].n;
    });
  check(
    "a leaver's notes keep their author",
    (await pimNotes()) === 1,
    "1 note",
  );
  // A request that resolved Pim before his removal cannot act as him after.
  const stalePim = await asPerson(
    { orgId: bakery.id, personId: pimSeed.personId, userId: pimId },
    async (q) => q.query("select 1"),
  ).then(
    () => "acted",
    (err) => err.constructor.name,
  );
  check("a stale principal is refused", stalePim === "Gone", stalePim);
  const memberRestore = await settings(
    "/settings/members",
    new URLSearchParams({ restore: pimId }),
    otto,
  );
  check(
    "member cannot bring back",
    memberRestore.status === 403,
    `answered ${memberRestore.status}`,
  );
  const restored = await settings(
    "/settings/members",
    new URLSearchParams({ restore: pimId }),
  );
  const pimAgain = await signIn(pimId);
  const pimBrain = await (
    await fetch(`${stack.url}/brain`, { headers: { cookie: pimAgain } })
  ).text();
  check(
    "a past member brought back has their notes",
    restored.headers.get("location")?.endsWith("member=restored") &&
      (await settingsPage(margeOwner)).includes("pim@bluewhale.test") &&
      pimBrain.includes("Ovens"),
    `${restored.headers.get("location")?.split("?")[1]}, Ovens on his brain page`,
  );
  await remove();
  const reinvite = await fetch(`${stack.url}/invite`, {
    method: "POST",
    headers: { cookie: margeOwner },
    body: new URLSearchParams({ email: pimSeed.email }),
    redirect: "manual",
  });
  const pimBack = await admit({
    email: pimSeed.email,
    firstName: "Pim",
    lastName: null,
  });
  check(
    "a leaver invited back is the same member",
    reinvite.headers.get("location")?.endsWith("invite=sent") &&
      pimBack.orgId === bakery.id &&
      pimBack.userId === pimId &&
      (await membershipsOf(pimBack)).some((m) => m.orgId === bakery.id) &&
      (await pimNotes()) === 1,
    `${reinvite.headers.get("location")?.split("?")[1]}, same membership, 1 note`,
  );
  await remove();
  const volumesBeforeLivePurge = fake.volumes.size;
  const purgeLive = await settings(
    "/settings/members",
    new URLSearchParams({ purge: "20000000-0000-4000-8000-000000000002" }),
  );
  check(
    "only a past member can be purged",
    purgeLive.headers.get("location")?.endsWith("member=gone") &&
      (await settingsPage(margeOwner)).includes("otto@bluewhale.test"),
    "Otto still in",
  );
  const memberPurge = await settings(
    "/settings/members",
    new URLSearchParams({ purge: pimId }),
    otto,
  );
  check(
    "a purge by a member or of a live member destroys nothing",
    memberPurge.status === 403 && fake.volumes.size === volumesBeforeLivePurge,
    `member answered ${memberPurge.status}; ${fake.volumes.size} volumes still`,
  );
  const volumesBeforePurge = fake.volumes.size;
  const machinesBeforePurge = fake.machines.size;
  const purged = await settings(
    "/settings/members",
    new URLSearchParams({ purge: pimId }),
  );
  const pimSignIn = await fetch(`${stack.url}/auth/dev`, {
    method: "POST",
    body: new URLSearchParams({ user: pimId }),
    redirect: "manual",
  });
  check(
    "a purged member, their notes and their log are gone",
    purged.headers.get("location")?.endsWith("member=purged") &&
      !(await settingsPage(margeOwner)).includes("past member") &&
      (await pimNotes()) === 0 &&
      (await pimEvents()) === 0 &&
      pimSignIn.status === 400,
    `${purged.headers.get("location")?.split("?")[1]}, ${await pimNotes()} notes, ${await pimEvents()} events, sign-in ${pimSignIn.status}`,
  );
  check(
    "a purged member's computer is gone from Fly",
    fake.volumes.size === volumesBeforePurge - 1 &&
      fake.machines.size === machinesBeforePurge - 1,
    `${volumesBeforePurge} → ${fake.volumes.size} volumes, ${machinesBeforePurge} → ${fake.machines.size} machines`,
  );
  const svgForm = new FormData();
  svgForm.set("name", "Blue Whale Bakery & Co");
  svgForm.set(
    "logo",
    new File(
      ["<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"],
      "x.svg",
      {
        type: "image/png",
      },
    ),
  );
  const svg = await settings("/settings/org", svgForm);
  check(
    "svg refused whatever it claims to be",
    svg.headers.get("location")?.endsWith("org=image"),
    svg.headers.get("location")?.split("?")[1],
  );
  check(
    "served image is nosniff",
    served.headers.get("x-content-type-options") === "nosniff",
    served.headers.get("x-content-type-options") ?? "missing",
  );
  const acmeRemove = await settings(
    "/settings/members",
    new URLSearchParams({ remove: "10000000-0000-4000-8000-000000000002" }),
  );
  check(
    "removal stays in its org",
    (await settingsPage(wile)).includes("beep@acme-rockets.test"),
    `Road Runner still in Acme (${acmeRemove.status})`,
  );
  await settings(
    "/invite",
    new URLSearchParams({ email: "new@bluewhale.test" }),
  );
  const withdrawn = await settings(
    "/settings/members",
    new URLSearchParams({ uninvite: "new@bluewhale.test" }),
  );
  check(
    "invitation withdrawn",
    withdrawn.headers.get("location")?.endsWith("member=uninvited") &&
      !(await settingsPage(margeOwner)).includes("new@bluewhale.test"),
    "gone from the list",
  );
  // Roles: Marge owns the bakery, Otto is a member. A member may not touch
  // the org or the roster; the principal cannot be demoted; a promoted member
  // can.
  const asMember = await settings("/settings/org", orgForm, otto);
  check(
    "member cannot rename the org",
    asMember.status === 403,
    `answered ${asMember.status}`,
  );
  const memberRemove = await settings(
    "/settings/members",
    new URLSearchParams({ remove: "20000000-0000-4000-8000-000000000001" }),
    otto,
  );
  check(
    "member cannot remove",
    memberRemove.status === 403,
    `answered ${memberRemove.status}`,
  );
  const demotePrincipal = await settings(
    "/settings/members",
    new URLSearchParams({ demote: "20000000-0000-4000-8000-000000000001" }),
    margeOwner,
  );
  check(
    "the principal stays an owner",
    demotePrincipal.headers.get("location")?.endsWith("member=principal"),
    demotePrincipal.headers.get("location")?.split("?")[1],
  );
  const promoted = await settings(
    "/settings/members",
    new URLSearchParams({ promote: "20000000-0000-4000-8000-000000000002" }),
    margeOwner,
  );
  const ottoNow = await signIn("20000000-0000-4000-8000-000000000002");
  const ottoRenames = await settings("/settings/org", orgForm, ottoNow);
  check(
    "promoted member becomes an owner",
    promoted.headers.get("location")?.endsWith("member=owner") &&
      ottoRenames.status === 303,
    `promote ${promoted.headers.get("location")?.split("?")[1]}, then rename ${ottoRenames.status}`,
  );

  // Marge holds the bakery. An owner cannot remove her, demote her or hand
  // the org over; she can hand it to Otto, and then she is an owner like any
  // other.
  const margeId = "20000000-0000-4000-8000-000000000001";
  const ottoRemovesMarge = await settings(
    "/settings/members",
    new URLSearchParams({ remove: margeId }),
    ottoNow,
  );
  const ottoHandsOver = await settings(
    "/settings/members",
    new URLSearchParams({ handover: margeId }),
    ottoNow,
  );
  check(
    "only the principal hands the org over",
    ottoRemovesMarge.headers.get("location")?.endsWith("member=principal") &&
      ottoHandsOver.status === 403,
    `remove ${ottoRemovesMarge.headers.get("location")?.split("?")[1]}, hand over ${ottoHandsOver.status}`,
  );
  const handedElsewhere = await settings(
    "/settings/members",
    new URLSearchParams({ handover: "10000000-0000-4000-8000-000000000001" }),
    margeOwner,
  );
  check(
    "the org cannot be handed outside it",
    handedElsewhere.headers.get("location")?.endsWith("member=gone"),
    handedElsewhere.headers.get("location")?.split("?")[1],
  );
  const handed = await settings(
    "/settings/members",
    new URLSearchParams({ handover: "20000000-0000-4000-8000-000000000002" }),
    margeOwner,
  );
  const afterHandOver = await settingsPage(ottoNow);
  check(
    "the principal hands the org over",
    handed.headers.get("location")?.endsWith("member=handed") &&
      /otto@bluewhale\.test[\s\S]*?principal<\/span>/.test(afterHandOver) &&
      afterHandOver.includes("Delete Blue Whale Bakery"),
    "Otto holds the bakery and may delete it",
  );
  // A demotion that lands first is honoured by a request that was already
  // authorised: Otto demotes Marge, then Marge's request — carrying a cookie
  // that resolved to owner a moment ago — cannot rename the org.
  await settings(
    "/settings/members",
    new URLSearchParams({ demote: margeId }),
    ottoNow,
  );
  const staleOwner = await settings("/settings/org", orgForm, margeOwner);
  check(
    "a demoted owner's next write is refused",
    staleOwner.status === 403,
    `answered ${staleOwner.status}`,
  );
  await settings(
    "/settings/members",
    new URLSearchParams({ promote: margeId }),
    ottoNow,
  );
  await settings(
    "/settings/members",
    new URLSearchParams({ handover: margeId }),
    ottoNow,
  );
  // A body with no Content-Length is bounded while it streams.
  const big = new Uint8Array(4 * 1024 * 1024);
  const bigForm = new FormData();
  bigForm.set("name", "x");
  bigForm.set("logo", new File([big], "big.png", { type: "image/png" }));
  const chunked = await fetch(`${stack.url}/settings/org`, {
    method: "POST",
    body: bigForm,
    headers: { cookie: ottoNow },
    redirect: "manual",
  });
  check(
    "oversized upload refused",
    chunked.status === 413,
    `answered ${chunked.status}`,
  );

  // A withdrawn invitation admits nobody: the person signs in and gets an org
  // of their own instead.
  await settings(
    "/invite",
    new URLSearchParams({ email: "late@bluewhale.test" }),
    ottoNow,
  );
  await settings(
    "/settings/members",
    new URLSearchParams({ uninvite: "late@bluewhale.test" }),
    ottoNow,
  );
  const late = await admit({
    email: "late@bluewhale.test",
    firstName: "Late",
    lastName: null,
  });
  check(
    "withdrawn invitation admits nobody",
    late.orgId !== "00000000-0000-4000-8000-000000000002" &&
      late.role === "owner",
    `own org, ${late.role}`,
  );

  // One person, two orgs. Otto is a member of the bakery and of the
  // observatory: signed into one, the header offers the other; switching
  // yields a session in that org and nothing from the first leaks across;
  // a membership that is not his is refused.
  const ottoHome = await page(ottoNow);
  check(
    "a person in two orgs is offered the other",
    /<h1[^>]*>Blue Whale Bakery/.test(ottoHome) &&
      /<button[^>]*value="30000000-0000-4000-8000-000000000002"[^>]*>Switch to Chartreuse Observatory</.test(
        ottoHome,
      ),
    "bakery, with the observatory offered",
  );
  const switched = await fetch(`${stack.url}/auth/switch`, {
    method: "POST",
    body: new URLSearchParams({
      membership: "30000000-0000-4000-8000-000000000002",
    }),
    headers: { cookie: ottoNow },
    redirect: "manual",
  });
  const ottoObs = switched.headers
    .get("set-cookie")
    ?.match(/session=[^;]+/)?.[0];
  const obsHome = ottoObs ? await page(ottoObs) : "";
  check(
    "switching org yields that org",
    switched.status === 303 &&
      /<h1[^>]*>Chartreuse Observatory<\/h1>/.test(obsHome) &&
      !/marge@|pim@/.test(await settingsPage(ottoObs)),
    `${switched.status}, observatory, no bakery people`,
  );
  const notMine = await fetch(`${stack.url}/auth/switch`, {
    method: "POST",
    body: new URLSearchParams({
      membership: "10000000-0000-4000-8000-000000000001",
    }),
    headers: { cookie: ottoNow },
    redirect: "manual",
  });
  check(
    "cannot switch into an org one is not in",
    notMine.status === 403,
    `answered ${notMine.status}`,
  );
  // A person already in an org may found another of their own: they land
  // in it as its owner, keep the orgs they were in, and its computer is
  // made at that landing like any other first sign-in.
  const madeOrg = await fetch(`${stack.url}/auth/new-org`, {
    method: "POST",
    headers: { cookie: ottoNow },
    body: new URLSearchParams({ name: "Otto's Own" }),
    redirect: "manual",
  });
  const ottoOwn = madeOrg.headers
    .get("set-cookie")
    ?.match(/session=[^;]+/)?.[0];
  const ownOrgId = ottoOwn?.replace("session=", "").split(".")[0];
  const ownHome = ottoOwn ? await page(ottoOwn) : "";
  const ownMember = ownOrgId
    ? await asOrg(
        ownOrgId,
        async (q) => (await q.query("select id, role from users")).rows[0],
      )
    : null;
  const ownComputer = ownMember ? await built(ownOrgId, ownMember.id) : null;
  check(
    "a person in an org founds another of their own, and lands in it with its computer",
    madeOrg.status === 303 &&
      !orgs.some((o) => o.id === ownOrgId) &&
      ownMember?.role === "owner" &&
      /<h1[^>]*>Otto&#x27;s Own/.test(ownHome) &&
      ownHome.includes("Switch to Blue Whale Bakery") &&
      fake.machines.get(ownComputer?.machine_id)?.state === "started",
    `answered ${madeOrg.status}; ${ownHome.match(/<h1[^>]*>([^<]*)/)?.[1] ?? "no org"} as ${ownMember?.role}, machine ${fake.machines.get(ownComputer?.machine_id)?.state}`,
  );

  // The same form sent twice — a double click, a retry — lands in the org
  // it already made rather than making a second one of the same name.
  const madeAgain = await fetch(`${stack.url}/auth/new-org`, {
    method: "POST",
    headers: { cookie: ottoNow },
    body: new URLSearchParams({ name: "Otto's Own" }),
    redirect: "manual",
  });
  const againOrgId = madeAgain.headers
    .get("set-cookie")
    ?.match(/session=([^;.]+)/)?.[1];
  check(
    "founding the same org twice makes one",
    madeAgain.status === 303 && againOrgId === ownOrgId,
    `answered ${madeAgain.status}; ${againOrgId} against ${ownOrgId}`,
  );

  // A name of spaces is no name: nothing is founded and the person is sent
  // where the message is said.
  const noName = await fetch(`${stack.url}/auth/new-org`, {
    method: "POST",
    headers: { cookie: ottoNow },
    body: new URLSearchParams({ name: "   " }),
    redirect: "manual",
  });
  check(
    "an org with no name is refused and said so",
    noName.status === 303 &&
      noName.headers.get("location")?.endsWith("/settings?org=name") &&
      !noName.headers.get("set-cookie"),
    `answered ${noName.status} to ${noName.headers.get("location")}`,
  );

  // Inviting an address that already has an account adds a membership, not a
  // refusal: Vera invites Wile; Wile signs in and is in two orgs.
  const veraCookie = await signIn("30000000-0000-4000-8000-000000000001");
  const inviteWile = await settings(
    "/invite",
    new URLSearchParams({ email: "wile@acme-rockets.test" }),
    veraCookie,
  );
  const wileAgain = await admit({
    email: "wile@acme-rockets.test",
    firstName: "Wile",
    lastName: "Coyote",
  });
  const wileOrgs = (await membershipsOf(wileAgain))
    .map((m) => m.orgName)
    .sort();
  check(
    "inviting an existing account adds a membership",
    inviteWile.headers.get("location")?.endsWith("invite=sent") &&
      wileOrgs.join(",") === "Acme Rockets,Chartreuse Observatory",
    wileOrgs.join(", "),
  );
  // The same person's profile is one: renaming in one org renames everywhere.
  const rename = new FormData();
  rename.set("first_name", "Otto");
  rename.set("last_name", "L. Loaf");
  await settings("/settings/profile", rename, ottoObs);

  // Computers: in an org that has them, a membership's first sign-in makes
  // the computer — a disk and a machine, running — behind the response,
  // without a look; the first look finds it and shows the disk. An org
  // whose owner turned them off is told so.
  const computerPage = async (cookie, path = "/") =>
    (
      await (
        await fetch(`${stack.url}/computer?path=${encodeURIComponent(path)}`, {
          headers: { cookie },
        })
      ).text()
    ).replaceAll("<!-- -->", "");
  check(
    "computers are gated by org, and the page says where the switch is",
    /Computers are off for this org[\s\S]*href="\/settings"/.test(
      await computerPage(wile),
    ),
    "Acme told no, and pointed to Settings",
  );
  // Road Runner signs in while Acme is off, so no computer is made for
  // him in the moment the switch is on.
  const roadRunnerSwitch = await signIn("10000000-0000-4000-8000-000000000002");
  const switchedOn = await fetch(`${stack.url}/settings/computers`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({ on: "yes" }),
    redirect: "manual",
  });
  const settingsOn = await settingsPage(wile);
  const memberSwitch = await fetch(`${stack.url}/settings/computers`, {
    method: "POST",
    headers: { cookie: roadRunnerSwitch },
    body: new URLSearchParams({ on: "no" }),
    redirect: "manual",
  });
  const switchedOff = await fetch(`${stack.url}/settings/computers`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({ on: "no" }),
    redirect: "manual",
  });
  check(
    "an owner switches computers on and off; a member cannot",
    switchedOn.headers.get("location")?.endsWith("computers=on") &&
      settingsOn.includes('data-computers="on"') &&
      memberSwitch.status === 403 &&
      switchedOff.headers.get("location")?.endsWith("computers=off") &&
      (await computerPage(wile)).includes("Computers are off for this org"),
    `on ${switchedOn.status}, member ${memberSwitch.status}, off ${switchedOff.status}`,
  );
  const bakeryOrg = orgs[1].id;
  const margeRow = await built(
    bakeryOrg,
    "20000000-0000-4000-8000-000000000001",
  );
  const ottoRow = await built(
    bakeryOrg,
    "20000000-0000-4000-8000-000000000002",
  );
  check(
    "the first sign-in makes the computer, running, without a look",
    fake.volumes.size >= 2 &&
      fake.machines.size >= 2 &&
      [margeRow, ottoRow].every(
        (r) => fake.machines.get(r.machine_id)?.state === "started",
      ),
    `${fake.volumes.size} volumes, ${fake.machines.size} machines, Marge's ${fake.machines.get(margeRow.machine_id)?.state}, Otto's ${fake.machines.get(ottoRow.machine_id)?.state}`,
  );
  const volumesAtSignIn = fake.volumes.size;
  const machinesAtSignIn = fake.machines.size;
  check(
    "a preview's volumes carry its pull request in their names",
    [...fake.volumes.values()].every((v) => v.name.startsWith("pr0_c_")),
    [...fake.volumes.values()].map((v) => v.name).join(", "),
  );
  const ottoComputer = await computerPage(ottoNow);
  const opened = [
    fake.machines.size === machinesAtSignIn,
    fake.volumes.size === volumesAtSignIn,
    fake.machines.get(ottoRow.machine_id)?.state === "started",
    /data-state="started"/.test(ottoComputer),
    ottoComputer.includes("This folder is empty"),
    / of 3\.00 GB used/.test(ottoComputer),
  ];
  check(
    "opening the computer finds it made at sign-in, running, and shows the disk",
    opened.every(Boolean),
    `${fake.machines.size} machines, ${fake.volumes.size} volumes, ${opened.map(Number).join("")}`,
  );
  await computerPage(ottoNow);
  check(
    "a second look makes nothing",
    fake.machines.size === machinesAtSignIn &&
      fake.volumes.size === volumesAtSignIn,
    `${fake.machines.size} machines`,
  );
  const events = await asOrg(
    "00000000-0000-4000-8000-000000000002",
    async (q) =>
      (
        await q.query(
          "select e.kind from computer_events e join computers c on c.id = e.computer_id where c.user_id = '20000000-0000-4000-8000-000000000002' order by e.at",
        )
      ).rows.map((r) => r.kind),
  );
  check(
    "a computer's states are events, and the machine reported on boot",
    ["created", "volume", "start", "started", "reported"].every((k) =>
      events.includes(k),
    ),
    events.join(","),
  );
  // Files go to the store in parts, then land on the disk: the machine
  // pulls them alone and says when they are there. Here the store is a
  // directory behind our own PUT and the disk is a daemon process. Three
  // parts make one file, listed from the disk with its size, fetched back
  // whole from the machine, unseen on anyone else's disk, and deleted.
  const landedAt = async (cookie, path, marker) => {
    let page = "";
    for (let i = 0; i < 60; i++) {
      page = await computerPage(cookie, path);
      if (page.includes(marker)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return page;
  };
  const json = (path, body, cookie) =>
    fetch(`${stack.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
  const chunks = ["alpha ".repeat(600), "beta".repeat(900), "gamma"];
  const whole = chunks.join("");
  const begun = await (
    await json(
      "/files/begin",
      { name: "notes.txt", size: whole.length, type: "text/plain" },
      ottoNow,
    )
  ).json();
  const etags = [];
  for (const [i, chunk] of chunks.entries()) {
    const { url } = await (
      await json("/files/part", { id: begun.id, partNumber: i + 1 }, ottoNow)
    ).json();
    const put = await fetch(`${stack.url}${url}`, {
      method: "PUT",
      body: chunk,
    });
    etags.push({ partNumber: i + 1, etag: put.headers.get("etag") });
  }
  const closed = await (
    await json("/files/complete", { id: begun.id, parts: etags }, ottoNow)
  ).json();
  const listed = await landedAt(ottoNow, "/", 'data-file="/notes.txt"');
  // The machine says it landed on its own time; the staged copy goes then.
  let staged;
  for (let i = 0; i < 80 && !staged?.gone; i++) {
    staged = await asOrg("00000000-0000-4000-8000-000000000002", async (q) => {
      await q.query("select set_config('app.meter', 'sweep', true)");
      return (
        await q.query(
          "select state, deleted_at is not null as gone from files where id = $1",
          [begun.id],
        )
      ).rows[0];
    });
    if (!staged?.gone) await sleep(250);
  }
  check(
    "a file arrives in parts, lands on the disk alone and leaves the store",
    closed.size === whole.length &&
      closed.state === "landing" &&
      listed.includes('data-file="/notes.txt"') &&
      staged?.gone === true,
    `${closed.size} bytes, answered ${closed.state}, staged row ${JSON.stringify(staged)}`,
  );
  const download = async (cookie, path) => {
    const sent = await fetch(
      `${stack.url}/files/download?path=${encodeURIComponent(path)}`,
      { headers: { cookie }, redirect: "manual" },
    );
    const to = sent.headers.get("location");
    if (!to) return { status: sent.status, body: "" };
    const got = await fetch(to);
    return { status: got.status, body: await got.text(), to };
  };
  const fetched = await download(ottoNow, "/notes.txt");
  check(
    "a file comes back whole, from the machine itself",
    fetched.status === 200 &&
      fetched.body === whole &&
      fetched.to.startsWith(`${fake.url}/dl/`),
    `answered ${fetched.status} from ${fetched.to}`,
  );
  const otherMember = await download(margeOwner, "/notes.txt");
  check(
    "a file is on nobody else's disk",
    otherMember.status === 404,
    `answered ${otherMember.status}`,
  );
  const taken = await json(
    "/files/begin",
    { name: "notes.txt", size: 1, type: "text/plain" },
    ottoNow,
  );
  check(
    "a name already on the disk is refused",
    taken.status === 400 && (await taken.text()).includes("already there"),
    `answered ${taken.status}`,
  );
  // The filesystem grows for bytes that arrived, never for a declared
  // size, and stops at Fly's limit.
  const archive = await (
    await json(
      "/files/begin",
      { name: "archive.tar", size: 9e9, type: "application/x-tar" },
      ottoNow,
    )
  ).json();
  const notGrown = await asOrg(
    "00000000-0000-4000-8000-000000000002",
    async (q) =>
      (
        await q.query(
          "select disk_gb from computers where user_id = '20000000-0000-4000-8000-000000000002'",
        )
      ).rows[0],
  );
  check(
    "a declared size grows nothing; arrived bytes grow to fit",
    notGrown.disk_gb === 3 &&
      sizeFor(1e9, 3) === 3 &&
      sizeFor(3e9, 3) === 6 &&
      sizeFor(400e9, 20) === 500 &&
      sizeFor(600e9, 500) === 500,
    `${notGrown.disk_gb} GB after declaring 9 GB`,
  );
  const tooBig = await json(
    "/files/begin",
    { name: "everything.tar", size: 495e9, type: "application/x-tar" },
    ottoNow,
  );
  check(
    "the filesystem stops at 500 GB",
    tooBig.status === 413,
    `answered ${tooBig.status}`,
  );
  const form = (path, body, cookie) =>
    fetch(`${stack.url}${path}`, {
      method: "POST",
      headers: { cookie },
      body: new URLSearchParams(body),
      redirect: "manual",
    });
  const arriving = await computerPage(ottoNow);
  const abandoned = await form(
    "/files/delete",
    { path: "/", upload: archive.id },
    ottoNow,
  );
  const fileDeleted = await form(
    "/files/delete",
    { path: "/", target: "/notes.txt" },
    ottoNow,
  );
  check(
    "an upload on its way is shown, and can be abandoned; a file is deleted",
    arriving.includes(`data-upload="${archive.id}"`) &&
      abandoned.headers.get("location")?.includes("deleted=yes") &&
      fileDeleted.headers.get("location")?.includes("deleted=yes") &&
      !(await computerPage(ottoNow)).includes('data-file="/notes.txt"') &&
      (await download(ottoNow, "/notes.txt")).status === 404,
    "gone from the list and the disk",
  );
  // The filesystem: folders to open, in the tree and the listing; files
  // inside them, renamed, moved; a folder deleted with what it holds.
  const folderMade = await form(
    "/files/folder",
    { path: "/", name: "photos" },
    ottoNow,
  );
  const inPhotos = await computerPage(ottoNow, "/photos");
  check(
    "a folder is made, opens empty, and is in the tree",
    folderMade.headers.get("location")?.includes("folder=made") &&
      inPhotos.includes('data-path="/photos"') &&
      inPhotos.includes("This folder is empty") &&
      inPhotos.includes('data-tree="/photos"'),
    "photos, empty",
  );
  const photo = await (
    await json(
      "/files/begin",
      { name: "sunset.txt", size: 5, type: "text/plain", path: "/photos" },
      ottoNow,
    )
  ).json();
  const { url: photoUrl } = await (
    await json("/files/part", { id: photo.id, partNumber: 1 }, ottoNow)
  ).json();
  await fetch(`${stack.url}${photoUrl}`, { method: "PUT", body: "hello" });
  await json(
    "/files/complete",
    { id: photo.id, parts: [{ partNumber: 1, etag: "x" }] },
    ottoNow,
  );
  const photosView = await landedAt(
    ottoNow,
    "/photos",
    'data-file="/photos/sunset.txt"',
  );
  const rootView = await computerPage(ottoNow);
  check(
    "a file uploaded into a folder is there and not at the root",
    photosView.includes('data-file="/photos/sunset.txt"') &&
      !rootView.includes("sunset.txt") &&
      rootView.includes('data-folder="/photos"'),
    "sunset.txt in photos",
  );
  const fileRenamed = await form(
    "/files/rename",
    { path: "/photos", target: "/photos/sunset.txt", name: "dusk.txt" },
    ottoNow,
  );
  const fileMoved = await form(
    "/files/move",
    { path: "/photos", target: "/photos/dusk.txt", to: "/" },
    ottoNow,
  );
  const rootAfter = await computerPage(ottoNow);
  check(
    "a file is renamed and moved to the root",
    fileRenamed.headers.get("location")?.includes("renamed=yes") &&
      fileMoved.headers.get("location")?.includes("moved=yes") &&
      rootAfter.includes('data-file="/dusk.txt"') &&
      (await download(ottoNow, "/dusk.txt")).body === "hello",
    "dusk.txt at the root",
  );
  const escaped = await form(
    "/files/move",
    { path: "/", target: "/dusk.txt", to: "/../../etc" },
    ottoNow,
  );
  check(
    "nothing leaves the disk",
    escaped.headers.get("location")?.includes("moved=where") &&
      (await computerPage(ottoNow)).includes('data-file="/dusk.txt"'),
    "a path with .. is not a path",
  );
  // The terminal: a shell on the disk over a WebSocket by a signed link
  // for the session the tab names; it sees the files, and neither a
  // forged link nor another session's is opened. The ports the machine
  // listens on are previews: a link sets the cookie, and the browser then
  // lives at the port through the machine.
  const shellLink = await fetch(
    `${stack.url}/computer/terminal?session=smoke-shell`,
    { headers: { cookie: ottoNow } },
  ).then(async (r) => (await r.json()).url);
  const typed = await new Promise((resolve) => {
    const ws = new WebSocket(shellLink);
    let seen = "";
    const done = setTimeout(() => {
      ws.close();
      resolve(seen);
    }, 8000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ resize: [80, 24] }));
      ws.send(new TextEncoder().encode("ls; echo DONE_$((1+1))\n"));
    };
    ws.onmessage = async (e) => {
      seen += typeof e.data === "string" ? e.data : await e.data.text();
      if (seen.includes("DONE_2")) {
        clearTimeout(done);
        ws.close();
        resolve(seen);
      }
    };
    ws.onerror = () => resolve(seen);
  });
  check(
    "a shell on the disk answers over the socket and sees the files",
    typed.includes("DONE_2") && typed.includes("dusk.txt"),
    typed
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
      .trim()
      .slice(-80),
  );
  const opens = (link) =>
    new Promise((resolve) => {
      const ws = new WebSocket(link);
      ws.onopen = () => resolve("opened");
      ws.onerror = () => resolve("refused");
      ws.onclose = () => resolve("refused");
    });
  const forgedShell = await opens(shellLink.replace(/\/[^/?]+\?/, "/forged?"));
  const otherSession = await opens(
    shellLink.replace("session=smoke-shell", "session=smoke-other"),
  );
  check(
    "a terminal link opens the session it names and no other",
    forgedShell === "refused" && otherSession === "refused",
    `forged ${forgedShell}, another session ${otherSession}`,
  );
  const listener = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`served ${req.url}`);
  });
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const servedPort = listener.address().port;
  const withPort = await computerPage(ottoNow);
  const previewLink = await fetch(
    `${stack.url}/computer/preview?port=${servedPort}`,
    { headers: { cookie: ottoNow }, redirect: "manual" },
  );
  const entered = await fetch(previewLink.headers.get("location"), {
    redirect: "manual",
  });
  const previewCookie = entered.headers.get("set-cookie")?.split(";")[0];
  const previewed = await fetch(`${fake.url}/hello/there`, {
    headers: { cookie: previewCookie },
  });
  listener.close();
  check(
    "a port the machine listens on is listed and previewed through it",
    withPort
      .match(/data-ports="([^"]*)"/)?.[1]
      .split(",")
      .includes(String(servedPort)) &&
      entered.status === 302 &&
      previewed.status === 200 &&
      (await previewed.text()) === "served /hello/there",
    `port ${servedPort}, preview ${previewed.status}`,
  );
  // Backups: the person asks for one and the bar says so; a second within
  // the hour is refused plainly. A day on, the sweep asks the machine for
  // its daily one; the archive lands in the store with a size, and an
  // emptied disk gets it back.
  const kept = async (n) => {
    for (let i = 0; i < 40; i++) {
      const page = await computerPage(ottoNow);
      if (page.includes(`data-backups="${n}"`)) return page;
      await new Promise((r) => setTimeout(r, 500));
    }
    return await computerPage(ottoNow);
  };
  const ottoId = "20000000-0000-4000-8000-000000000002";
  const askedNow = await form("/computer/backup-now", { path: "/" }, ottoNow);
  const backedUpNow = await kept(1);
  const askedAgain = await form("/computer/backup-now", { path: "/" }, ottoNow);
  const refusedFor = (res) =>
    new URL(res.headers.get("location") ?? "", stack.url).searchParams.get(
      "error",
    ) ?? "";
  check(
    "a backup on demand is taken; a second within the hour is refused",
    askedNow.headers.get("location")?.includes("backup=started") &&
      backedUpNow.includes("backed up 0 min ago, 1 kept") &&
      refusedFor(askedAgain).startsWith(
        "The last backup was taken 0 min ago; one an hour is the limit.",
      ),
    `${askedNow.headers.get("location")?.split("?")[1]}; then: ${refusedFor(askedAgain)}`,
  );
  // A reset backs the home up before anything, and its outcome is on the
  // page: refused with nothing changed when the backup could not be taken
  // (one is on its way), and again, after a backup of its own once the
  // last is old, because a laptop has no system to reset.
  const withRow = (sql, more = []) =>
    asOrg("00000000-0000-4000-8000-000000000002", async (q) => {
      await q.query("select set_config('app.meter', 'sweep', true)");
      await q.query(sql, [ottoId, ...more]);
    });
  // Yesterday's, as far as the hour and the day are concerned.
  const aged = () =>
    withRow(
      "update backups set started_at = started_at - interval '2 days', finished_at = finished_at - interval '2 days' where user_id = $1",
    );
  await withRow(
    "insert into backups (user_id, key) values ($1, 'orgs/x/members/x/backups/on-its-way.tar.gz')",
  );
  const resetOutcome = async () => {
    const started = await form("/computer/reset", { path: "/" }, ottoNow);
    let page = "";
    for (let i = 0; i < 40; i++) {
      page = await (
        await fetch(`${stack.url}/computer?path=%2F&reset=started`, {
          headers: { cookie: ottoNow },
        })
      ).text();
      if (!page.includes("is being reset")) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    return {
      started: started.headers.get("location")?.includes("reset=started"),
      said: page.match(/data-notice[^>]*>([^<]*)</)?.[1] ?? "",
    };
  };
  const refusedReset = await resetOutcome();
  await withRow(
    "delete from backups where user_id = $1 and key like '%on-its-way%'",
  );
  await aged();
  const laptopReset = await resetOutcome();
  check(
    "the page offers both actions; a refused reset says nothing was changed",
    backedUpNow.includes("data-backup-now") &&
      backedUpNow.includes("data-reset") &&
      refusedReset.started &&
      refusedReset.said.startsWith(
        "The backup before the reset failed (backup begin answered 409), so nothing was changed.",
      ) &&
      laptopReset.started &&
      laptopReset.said ===
        "There is no system on this computer to reset: it has none of its own, so nothing was changed." &&
      (await computerPage(ottoNow)).includes('data-backups="2"'),
    `${refusedReset.said} | ${laptopReset.said}`,
  );
  await aged();
  await fetch(`${stack.url}/meter/sweep`, {
    headers: { authorization: "Bearer smoke" },
  });
  const backedUp = await kept(3);
  const backupRow = await asOrg(
    "00000000-0000-4000-8000-000000000002",
    async (q) => {
      await q.query("select set_config('app.meter', 'sweep', true)");
      return (
        await q.query(
          "select size::int as size, finished_at is not null as finished from backups where user_id = $1 order by started_at desc limit 1",
          [ottoId],
        )
      ).rows[0];
    },
  );
  check(
    "the sweep has the machine back its disk up into the store",
    backedUp.includes('data-backups="3"') &&
      backedUp.includes("backed up 0 min ago, 3 kept") &&
      backupRow?.finished === true &&
      backupRow.size > 0,
    `backup ${JSON.stringify(backupRow)}`,
  );
  await fetch(`${stack.url}/meter/sweep`, {
    headers: { authorization: "Bearer smoke" },
  });
  check(
    "a second sweep the same day makes no second backup",
    (await computerPage(ottoNow)).includes('data-backups="3"'),
    "still three",
  );
  // A window that spans the turn of a month is written as a row each side
  // of it. A disk made after that turn belongs to the later row alone: the
  // earlier one would have to start after it ended, which the meter must
  // never write. A fresh org's computer, with a row from before the turn
  // to continue from, is that case.
  const meterOrg = await fetch(`${stack.url}/auth/new-org`, {
    method: "POST",
    headers: { cookie: ottoNow },
    body: new URLSearchParams({ name: "Otto's Meter" }),
    redirect: "manual",
  });
  const meterCookie = meterOrg.headers
    .get("set-cookie")
    ?.match(/session=[^;]+/)?.[0];
  const meterOrgId = meterCookie?.replace("session=", "").split(".")[0];
  const meterMember = await asOrg(
    meterOrgId,
    async (q) => (await q.query("select id from users")).rows[0],
  );
  await built(meterOrgId, meterMember.id);
  await asOrg(meterOrgId, (q) =>
    q.query(
      `insert into usage (org_id, user_id, resource, unit, quantity, price, cost, from_at, to_at)
       values ($1, $2, 'disk', 'gb_second', 0, 0, 0, now() - interval '50 days', now() - interval '40 days')`,
      [meterOrgId, meterMember.id],
    ),
  );
  await fetch(`${stack.url}/meter/sweep`, {
    headers: { authorization: "Bearer smoke" },
  });
  const spans = await asOrg(
    meterOrgId,
    async (q) =>
      (
        await q.query(
          `select count(*) filter (where to_at <= from_at)::int as inverted,
                  count(*) filter (where resource = 'disk' and from_at > now() - interval '2 days')::int as disks
             from usage where user_id = $1`,
          [meterMember.id],
        )
      ).rows[0],
  );
  check(
    "a disk made after the turn of a month is billed in the month it was made, and no row starts after it ends",
    spans.inverted === 0 && spans.disks > 0,
    `${spans.inverted} inverted, ${spans.disks} disk rows since it was made`,
  );

  // A staged file whose landing was never heard of is landed by the
  // sweep, and a file of the person's own with the same name and size is
  // never taken for it: the upload lands beside it, under the next name.
  const twinId = crypto.randomUUID();
  const twinKey = `orgs/00000000-0000-4000-8000-000000000002/members/${ottoId}/files/${twinId}`;
  await fs.writeFile(
    path.join(scratch, "files", twinKey.replaceAll("/", "_")),
    "world",
  );
  await asOrg("00000000-0000-4000-8000-000000000002", async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [ottoId]);
    await q.query(
      "insert into files (id, org_id, user_id, name, size, content_type, key, path, state, created_at, ready_at) values ($1, $2, $3, 'dusk.txt', 5, 'text/plain', $4, '/', 'ready', now() - interval '3 minutes', now() - interval '3 minutes')",
      [twinId, "00000000-0000-4000-8000-000000000002", ottoId, twinKey],
    );
  });
  // And one whose bytes are gone from the store cannot land: the machine
  // says why, the row is staged again with the reason, and the page and
  // the uploader's look say it.
  const ghostId = crypto.randomUUID();
  await asOrg("00000000-0000-4000-8000-000000000002", async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [ottoId]);
    await q.query(
      "insert into files (id, org_id, user_id, name, size, content_type, key, path, state, created_at, ready_at) values ($1, $2, $3, 'ghost.txt', 5, 'text/plain', $4, '/', 'ready', now() - interval '3 minutes', now() - interval '3 minutes')",
      [
        ghostId,
        "00000000-0000-4000-8000-000000000002",
        ottoId,
        `orgs/00000000-0000-4000-8000-000000000002/members/${ottoId}/files/${ghostId}`,
      ],
    );
  });
  await fetch(`${stack.url}/meter/sweep`, {
    headers: { authorization: "Bearer smoke" },
  });
  const beside = await landedAt(ottoNow, "/", 'data-file="/dusk (2).txt"');
  let ghost;
  for (let i = 0; i < 40 && !ghost?.said; i++) {
    ghost = (
      await (
        await fetch(`${stack.url}/files/landing`, {
          headers: { cookie: ottoNow },
        })
      ).json()
    ).files.find((f) => f.id === ghostId);
    if (!ghost?.said) await new Promise((r) => setTimeout(r, 250));
  }
  const ghostPage = await computerPage(ottoNow);
  check(
    "a landing that failed is staged again with why, and the page says so",
    ghost?.state === "ready" &&
      ghost.said === "the source answered 404" &&
      ghostPage.includes("could not land: the source answered 404"),
    `${JSON.stringify(ghost)}`,
  );
  await asOrg("00000000-0000-4000-8000-000000000002", async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [ottoId]);
    await q.query("update files set deleted_at = now() where id = $1", [
      ghostId,
    ]);
  });
  const twinRow = await asOrg(
    "00000000-0000-4000-8000-000000000002",
    async (q) => {
      await q.query("select set_config('app.meter', 'sweep', true)");
      return (
        await q.query(
          "select state, deleted_at is not null as gone from files where id = $1",
          [twinId],
        )
      ).rows[0];
    },
  );
  check(
    "the sweep lands a straggler beside a file of the same name, never in its place",
    beside.includes('data-file="/dusk (2).txt"') &&
      (await download(ottoNow, "/dusk (2).txt")).body === "world" &&
      (await download(ottoNow, "/dusk.txt")).body === "hello" &&
      twinRow?.gone === true,
    `dusk.txt still hello; dusk (2).txt ${(await download(ottoNow, "/dusk (2).txt")).body}; row ${JSON.stringify(twinRow)}`,
  );
  await form("/files/delete", { path: "/", target: "/dusk (2).txt" }, ottoNow);
  await form("/files/delete", { path: "/", target: "/photos" }, ottoNow);
  await form("/files/delete", { path: "/", target: "/dusk.txt" }, ottoNow);
  const emptied = await computerPage(ottoNow);
  const restoreId = emptied.match(/data-restore="([^"]+)"/)?.[1];
  const putBack = await form(
    "/computer/restore",
    { path: "/", backup: restoreId ?? "" },
    ottoNow,
  );
  // The machine carries on alone; the page catches up.
  let back = "";
  for (let i = 0; i < 40; i++) {
    back = await computerPage(ottoNow);
    if (back.includes('data-file="/dusk.txt"')) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  check(
    "an emptied disk offers its backup, and gets it back",
    Boolean(restoreId) &&
      putBack.headers.get("location")?.includes("restored=started") &&
      back.includes('data-file="/dusk.txt"') &&
      back.includes('data-folder="/photos"') &&
      (await download(ottoNow, "/dusk.txt")).body === "hello",
    `${putBack.headers.get("location")?.split("?")[1]}; ${(back.match(/data-(?:file|folder)="[^"]+"/g) ?? []).join(" ")}; ${(await download(ottoNow, "/dusk.txt")).status}`,
  );
  const notEmpty = await form(
    "/computer/restore",
    { path: "/", backup: restoreId ?? "" },
    ottoNow,
  );
  check(
    "a restore onto a disk that is not empty is refused",
    /error=the%20disk%20is%20not%20empty/.test(
      notEmpty.headers.get("location") ?? "",
    ),
    notEmpty.headers.get("location")?.split("?")[1] ?? "",
  );
  const folderGone = await form(
    "/files/delete",
    { path: "/", target: "/photos" },
    ottoNow,
  );
  const fileGone = await form(
    "/files/delete",
    { path: "/", target: "/dusk.txt" },
    ottoNow,
  );
  const rootFinal = await computerPage(ottoNow);
  check(
    "a folder is deleted with what it holds",
    folderGone.headers.get("location")?.includes("deleted=yes") &&
      fileGone.headers.get("location")?.includes("deleted=yes") &&
      !rootFinal.includes('data-folder="/photos"') &&
      (await download(ottoNow, "/photos/sunset.txt")).status === 404,
    `photos gone, sunset.txt ${(await download(ottoNow, "/photos/sunset.txt")).status}`,
  );
  // A profile photo is bytes in the bucket: saving one raises the live
  // meter by exactly its size, the usage page names it with its size, and
  // replacing it removes the old object from the store. The org's logo is
  // on its principal's line, and the logo replaced earlier is gone.
  const bakeryId = "00000000-0000-4000-8000-000000000002";
  const uploadsDir = path.join(scratch, "uploads");
  const ottoPhoto = () =>
    asOrg(
      bakeryId,
      async (q) =>
        (
          await q.query(
            "select avatar_key as key, avatar_bytes::int as bytes from users where id = $1",
            [ottoId],
          )
        ).rows[0],
    );
  const bucketRate = async () =>
    (
      await (
        await fetch(`${stack.url}/meter/live`, { headers: { cookie: ottoNow } })
      ).json()
    ).active.find((a) => a.resource === "bucket")?.ratePerHour ?? 0;
  const usageOf = async (cookie) =>
    (await fetch(`${stack.url}/usage`, { headers: { cookie } })).text();
  const rateBefore = await bucketRate();
  const photoForm = new FormData();
  photoForm.set("first_name", "Otto");
  photoForm.set("last_name", "L. Loaf");
  photoForm.set("avatar", new File([png], "me.png", { type: "image/png" }));
  const photoSaved = await settings("/settings/profile", photoForm, ottoNow);
  const firstPhoto = await ottoPhoto();
  const rateAfter = await bucketRate();
  const perByteHour = (0.02 / (730 * 3600) / 1e9) * 3600;
  const [ottoPhotoUsage, margeLogoUsage] = await Promise.all([
    usageOf(ottoNow),
    usageOf(margeOwner),
  ]);
  check(
    "a profile photo is metered in the bucket the moment it is saved",
    photoSaved.headers.get("location")?.endsWith("profile=saved") &&
      firstPhoto?.bytes === png.length &&
      Math.abs(rateAfter - rateBefore - png.length * perByteHour) < 1e-15 &&
      new RegExp(
        `data-bucket-picture="photo"[^]*?your profile photo[^]*?${png.length} B`,
      ).test(ottoPhotoUsage) &&
      !/data-bucket-picture="logo"/.test(ottoPhotoUsage) &&
      /data-bucket-picture="logo"/.test(margeLogoUsage) &&
      (await fetch(`${stack.url}${logoUrl}`)).status === 404,
    `${png.length} bytes, +$${(rateAfter - rateBefore).toExponential(3)}/h; the logo on Marge's line, the first logo gone`,
  );
  photoForm.set("avatar", new File([png], "again.png", { type: "image/png" }));
  await settings("/settings/profile", photoForm, ottoNow);
  const secondPhoto = await ottoPhoto();
  const stored = await fs.readdir(uploadsDir);
  const owed = await asOrg(
    bakeryId,
    async (q) =>
      (
        await q.query(
          "select count(*)::int as n from orphans where kind = 'picture'",
        )
      ).rows[0].n,
  );
  check(
    "replacing the photo removes the old object from the store",
    secondPhoto.key !== firstPhoto.key &&
      stored.includes(secondPhoto.key) &&
      !stored.includes(firstPhoto.key) &&
      owed === 0,
    `${firstPhoto.key} → ${secondPhoto.key}, ${owed} owed`,
  );
  // A picture key held by two rows goes when the last lets it go: Marge
  // is given Otto's key, Otto replaces his, and Marge's still answers.
  const margePerson = await asOrg(
    bakeryId,
    async (q) =>
      (await q.query("select person_id from users where id = $1", [margeId]))
        .rows[0].person_id,
  );
  await asPerson(
    { orgId: bakeryId, personId: margePerson, userId: margeId },
    async (q) => {
      await q.query("update people set avatar_key = $1 where id = $2", [
        secondPhoto.key,
        margePerson,
      ]);
      await q.query("update users set avatar_key = $1 where id = $2", [
        secondPhoto.key,
        margeId,
      ]);
    },
  );
  photoForm.set("avatar", new File([png], "third.png", { type: "image/png" }));
  await settings("/settings/profile", photoForm, ottoNow);
  const shared = await fetch(`${stack.url}/uploads/${secondPhoto.key}`);
  const sharedOwed = await asOrg(
    bakeryId,
    async (q) =>
      (
        await q.query(
          "select count(*)::int as n from orphans where kind = 'picture'",
        )
      ).rows[0].n,
  );
  check(
    "a shared picture stays until the last to show it lets it go",
    (await ottoPhoto()).key !== secondPhoto.key &&
      shared.status === 200 &&
      sharedOwed === 0,
    `Marge's copy answers ${shared.status}, ${sharedOwed} owed`,
  );
  // The meter: a sweep turns what happened into priced usage, per person,
  // and a second sweep only adds the time since.
  const sweepOnce = () =>
    fetch(`${stack.url}/meter/sweep`, {
      headers: { authorization: "Bearer smoke" },
    });
  check(
    "the sweep needs its secret",
    (await fetch(`${stack.url}/meter/sweep`)).status === 404,
    "404 without it",
  );
  await new Promise((r) => setTimeout(r, 1100));
  const swept = await (await sweepOnce()).json();
  await new Promise((r) => setTimeout(r, 1100));
  await sweepOnce();
  const meteredFor = (userId) =>
    asOrg(
      "00000000-0000-4000-8000-000000000002",
      async (q) =>
        (
          await q.query(
            "select resource, unit, sum(quantity)::float8 as q, sum(cost)::float8 as cost, count(*)::int as n from usage where user_id = $1 group by resource, unit order by resource",
            [userId],
          )
        ).rows,
    );
  const ottoMetered = await meteredFor("20000000-0000-4000-8000-000000000002");
  const margeMetered = await meteredFor("20000000-0000-4000-8000-000000000001");
  const by = Object.fromEntries(ottoMetered.map((r) => [r.resource, r]));
  const margeBrain = margeMetered.find((r) => r.resource === "brain");
  check(
    "the meter prices compute, disk, bucket and brain per person",
    swept.appended > 0 &&
      by.compute?.unit === "second" &&
      by.compute.q > 0 &&
      by.disk?.unit === "gb_second" &&
      by.disk.q > 0 &&
      by.bucket?.unit === "byte_second" &&
      by.bucket.q > 0 &&
      margeBrain?.unit === "byte_second" &&
      margeBrain.q > 0 &&
      [...ottoMetered, ...margeMetered].every((r) => r.n >= 2 && r.cost >= 0),
    [...ottoMetered, margeBrain]
      .filter(Boolean)
      .map(
        (r) =>
          `${r.resource} ${r.q.toFixed(1)} ${r.unit} $${r.cost.toFixed(9)} x${r.n}`,
      )
      .join("; "),
  );
  const liveMeter = await (
    await fetch(`${stack.url}/meter/live`, { headers: { cookie: ottoNow } })
  ).json();
  // Each rate is the price list's, not whatever the server added up.
  const rateOf = (resource) =>
    liveMeter.active.find((a) => a.resource === resource)?.ratePerHour ?? 0;
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  check(
    "the live meter's rate is everything ticking, added up",
    liveMeter.month > 0 &&
      near(rateOf("compute"), PRICES.compute["shared-cpu-1x:1024"] * 3600) &&
      near(rateOf("disk"), 3 * PRICES.disk * 3600) &&
      near(
        liveMeter.ratePerHour,
        liveMeter.active.reduce((n, a) => n + a.ratePerHour, 0),
      ) &&
      (await fetch(`${stack.url}/meter/live`)).status === 401,
    `$${liveMeter.month?.toFixed(8)} this month, $${liveMeter.ratePerHour?.toFixed(8)}/h, ${liveMeter.active?.map((a) => a.resource).join(", ")}`,
  );
  const usagePage = await (
    await fetch(`${stack.url}/usage`, { headers: { cookie: margeOwner } })
  ).text();
  check(
    "the usage page says what is ticking, what the month holds, and everyone's total",
    /data-ticking="disk"/.test(usagePage) &&
      /data-projection="[0-9.e-]+"/.test(usagePage) &&
      /data-usage="disk"/.test(usagePage) &&
      /data-member-usage=/.test(usagePage) &&
      (await fetch(`${stack.url}/usage`, { redirect: "manual" })).status ===
        307,
    "ticking, projected, listed, per member; signed out is sent home",
  );
  // Otto makes a folder and writes a note, then the usage page names the
  // folder, the machine's runs, the backup in the bucket and the note's kind.
  await form("/files/folder", { path: "/", name: "ledgers" }, ottoNow);
  await fetch(`${stack.url}/brain/records`, {
    method: "POST",
    headers: { cookie: ottoNow },
    body: new URLSearchParams({
      kind: "note",
      title: "Q3",
      body: "Closed.",
    }),
    redirect: "manual",
  });
  const ottoUsage = await (
    await fetch(`${stack.url}/usage`, { headers: { cookie: ottoNow } })
  ).text();
  const detail = [
    /data-disk-entry="\/ledgers"/.test(ottoUsage),
    /data-session=/.test(ottoUsage),
    /data-bucket-backup=/.test(ottoUsage),
    /data-brain-kind="note"/.test(ottoUsage),
  ];
  check(
    "the usage page breaks the disk, the runs, the bucket and the brain down",
    detail.every(Boolean),
    `disk, runs, bucket, brain: ${detail.map(Number).join("")}`,
  );
  const settingsUsage = await settingsPage(margeOwner);
  const ottoMonth = await computerPage(ottoNow);
  check(
    "usage shows on settings and the computer page",
    /data-usage-total="[0-9.e-]+"/.test(settingsUsage) &&
      settingsUsage.includes("Usage this month") &&
      /data-month-total="[0-9.e-]+"/.test(ottoMonth) &&
      !/data-usage-total="0"/.test(settingsUsage),
    `settings total ${settingsUsage.match(/data-usage-total="([^"]+)"/)?.[1]}`,
  );
  // Every debt the app can owe a vendor is a kind the database takes: a
  // migration that rewrote the list and dropped one would be found here.
  const refusedKinds = [];
  for (const kind of KINDS)
    await asOrg("00000000-0000-4000-8000-000000000002", async (q) => {
      await q.query("savepoint kind");
      await q
        .query("insert into orphans (org_id, kind, ref) values ($1, $2, 'x')", [
          "00000000-0000-4000-8000-000000000002",
          kind,
        ])
        .catch(() => refusedKinds.push(kind));
      await q.query("rollback to savepoint kind");
    });
  check(
    "every orphan kind the app pays is one the database takes",
    KINDS.length > 0 && refusedKinds.length === 0,
    refusedKinds.length
      ? `refused: ${refusedKinds.join(", ")}`
      : KINDS.join(", "),
  );
  // A machine gone behind our back is forgotten by the row, and the next
  // look makes a new one on the same filesystem.
  const machinesBeforeGone = fake.machines.size;
  const goneId = (await rowOf(bakeryOrg, ottoId)).machine_id;
  const goneMachine = fake.machines.get(goneId);
  goneMachine.child?.kill();
  fake.machines.delete(goneId);
  const afterGone = await computerPage(ottoNow);
  check(
    "a machine gone behind our back is replaced at the next look",
    /data-state="started"/.test(afterGone) &&
      fake.machines.size === machinesBeforeGone &&
      !fake.machines.has(goneId),
    `${fake.machines.size} machines now`,
  );
  // Nothing puts a machine to sleep: made without autostop, the proxy
  // leaves it running however long nothing asks for it, and the meter
  // ticks on. One from before, whose service autostops, is stopped by the
  // proxy for idleness and replaced by the sweep while off — its stop on
  // the record, so the meter stops there. One on an old image answers no
  // link of ours, so the sweep lets go of it while it runs. Either way a
  // machine is made and started on the same disk.
  const ottoIdle = fake.machines.get(
    (await rowOf(bakeryOrg, ottoId)).machine_id,
  );
  await sleep(IDLE_MS * 2.5);
  const liveIdle = await (
    await fetch(`${stack.url}/meter/live`, { headers: { cookie: ottoNow } })
  ).json();
  check(
    "a machine made now is never stopped for idleness, and the meter ticks on",
    ottoIdle.state === "started" &&
      ottoIdle.services[0]?.autostop === "off" &&
      liveIdle.active.some((a) => a.resource === "compute"),
    `${ottoIdle.state} after ${IDLE_MS * 2.5} ms idle, autostop ${ottoIdle.services[0]?.autostop}, compute ${liveIdle.active.some((a) => a.resource === "compute") ? "on" : "off"}`,
  );
  ottoIdle.services = [{ autostop: "suspend" }];
  await sleep(IDLE_MS * 2.5);
  const suspendedByProxy = ottoIdle.state;
  // The bakery's other machines go on an old image while they run.
  const oldIds = (
    await asOrg(
      bakeryOrg,
      async (q) => (await q.query("select machine_id from computers")).rows,
    )
  ).map((r) => r.machine_id);
  for (const id of oldIds)
    if (id !== ottoIdle.id)
      fake.machines.get(id).image = "registry.fly.io/placeholder-computers:v0";
  const stillRunning = oldIds.filter(
    (id) => fake.machines.get(id)?.state === "started",
  ).length;
  await fetch(`${stack.url}/meter/sweep`, {
    headers: { authorization: "Bearer smoke" },
  });
  const ottoReplaced = await built(bakeryOrg, ottoId, { not: ottoIdle.id });
  const rowsOfBakery = await asOrg(
    bakeryOrg,
    async (q) =>
      (await q.query("select user_id, machine_id, state from computers")).rows,
  );
  const sinceSuspend = await asOrg(bakeryOrg, async (q) =>
    (
      await q.query(
        "select e.kind from computer_events e join computers c on c.id = e.computer_id where c.user_id = $1 and e.kind in ('suspended', 'destroyed', 'start', 'started') and e.at >= to_timestamp($2 / 1000.0) order by e.at",
        [
          ottoId,
          ottoIdle.events.findLast((e) => e.status === "suspended").timestamp,
        ],
      )
    ).rows.map((r) => r.kind),
  );
  check(
    "one that autostops is replaced by the sweep while off, one on an old image while it runs; all running again",
    suspendedByProxy === "suspended" &&
      stillRunning > 0 &&
      oldIds.every((id) => !fake.machines.has(id)) &&
      rowsOfBakery.every(
        (r) => fake.machines.get(r.machine_id)?.state === "started",
      ) &&
      fake.machines.get(ottoReplaced.machine_id)?.services[0]?.autostop ===
        "off" &&
      sinceSuspend.join(",").startsWith("suspended,destroyed,start"),
    `${suspendedByProxy} by the proxy, ${stillRunning} running on an old image; ${oldIds.filter((id) => !fake.machines.has(id)).length} of ${oldIds.length} replaced, ${rowsOfBakery.filter((r) => fake.machines.get(r.machine_id)?.state === "started").length} of ${rowsOfBakery.length} running, Otto's autostop ${fake.machines.get(ottoReplaced.machine_id)?.services[0]?.autostop}; ${sinceSuspend.join(",")}`,
  );
  // The page does not wait for a sweep to be rid of one on an old image.
  const staleId = (await rowOf(bakeryOrg, ottoId)).machine_id;
  fake.machines.get(staleId).image = "registry.fly.io/placeholder-computers:v0";
  const afterLook = await computerPage(ottoNow);
  const afterStale = (await rowOf(bakeryOrg, ottoId)).machine_id;
  check(
    "the page's own look replaces a machine on an old image",
    !fake.machines.has(staleId) &&
      afterStale !== staleId &&
      fake.machines.get(afterStale)?.state === "started" &&
      /data-state="started"/.test(afterLook),
    `${staleId} gone: ${!fake.machines.has(staleId)}; now ${afterStale} ${fake.machines.get(afterStale)?.state}`,
  );
  // A machine Fly could not run is terminal: the next look lets go of it
  // and makes another on the same disk, rather than leaving the person
  // with a computer that never starts again.
  const failedId = (await rowOf(bakeryOrg, ottoId)).machine_id;
  fake.machines.get(failedId).state = "failed";
  await computerPage(ottoNow);
  const remade = await built(bakeryOrg, ottoId, { not: failedId });
  check(
    "a machine Fly has failed is replaced at the next look",
    !fake.machines.has(failedId) &&
      fake.machines.get(remade.machine_id)?.state === "started" &&
      /data-state="started"/.test(await computerPage(ottoNow)),
    `${failedId} gone: ${!fake.machines.has(failedId)}; now ${remade.machine_id} ${remade.state}`,
  );

  // A report with the wrong secret, or for a machine we never made, is a 404.
  const [m1] = fake.machines.keys();
  const forged = await fetch(`${stack.url}/computer/report`, {
    method: "POST",
    headers: {
      authorization: "Bearer nope",
      "fly-machine-id": m1,
      "content-type": "application/json",
    },
    body: JSON.stringify({ disk: { used: 1, total: 2 } }),
  });
  check(
    "a report needs the machine's own secret",
    forged.status === 404,
    `answered ${forged.status}`,
  );
  // A machine with nothing killed says so with a zero, and is heard.
  const honest = await fetch(`${stack.url}/computer/report`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${fake.machines.get(m1).env.COMPUTER_SECRET}`,
      "fly-machine-id": m1,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      disk: { used: 1, total: 2 },
      memory: { total: 2 ** 30, available: 2 ** 29 },
      oom: 0,
      load: 0.5,
    }),
  });
  check(
    "a report of nothing killed and memory to spare is taken",
    honest.status === 204,
    `answered ${honest.status}`,
  );
  check(
    "every rung of the ladder has a price and a name",
    LADDER.every(
      (s) =>
        PRICES.compute[s] > 0 &&
        /^\d+ (shared|performance) CPUs?, \d+ GB memory$/.test(sizeName(s)),
    ) && sizeName("performance-2x:8192") === "2 performance CPUs, 8 GB memory",
    LADDER.map(sizeName).join("; "),
  );
  // The ladder goes both ways from what the machine reports. A laptop's
  // daemon says what it is told of its memory, load and kills, at once;
  // each report is judged as it lands, behind the daemon's answer.
  const current = async () =>
    fake.machines.get((await rowOf(bakeryOrg, ottoId)).machine_id);
  check(
    "money is said as a person reads it",
    dollars(6.02) === "$6" &&
      dollars(0.42) === "$0.42" &&
      dollars(0.001) === "under 1¢" &&
      dollars(0) === "$0" &&
      spent(6.02) === "$6.02" &&
      rate(0.0083) === "$0.008 / h" &&
      rate(0.0000137) === "under $0.001 / h" &&
      dollars(monthly(LADDER[0])) === "$6",
    `${dollars(monthly(LADDER[0]))} a month at the first rung`,
  );
  const press = async (said, expect = 200) => {
    const mc = await current();
    const answered = await fetch(`http://127.0.0.1:${mc.port}/fs/pressure`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${mc.env.COMPUTER_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(said),
    }).catch(() => null);
    if (answered && answered.status !== expect)
      throw new Error(`pressure answered ${answered.status}`);
    return mc;
  };
  const replaced = (was) => built(bakeryOrg, ottoId, { not: was.id });
  const unchanged = async (was, ms = 1500) => {
    await sleep(ms);
    return (await rowOf(bakeryOrg, ottoId)).machine_id === was.id;
  };
  // The ladder will not change a size twice inside half an hour, and will
  // not come down until three hours of reports have actually spanned three
  // hours. A smoke runs in seconds, so the record is aged instead: events
  // are never updated, so aged copies replace them.
  const ageResizes = async () => {
    await withRow(
      `insert into computer_events (computer_id, kind, size, disk_gb, at)
         select computer_id, kind, size, disk_gb, at - interval '4 hours' from computer_events
         where kind in ('resized', 'asked-bigger', 'short-of-memory', 'out-of-memory', 'room-to-spare') and at > now() - interval '1 hour'
           and computer_id in (select id from computers where user_id = $1)`,
    );
    await withRow(
      "delete from computer_events where kind in ('resized', 'asked-bigger', 'short-of-memory', 'out-of-memory', 'room-to-spare') and at > now() - interval '1 hour' and computer_id in (select id from computers where user_id = $1)",
    );
  };
  // The reports the row keeps, spread back over the last four hours.
  const ageReports = async () => {
    for (const at of ["{reports}", "{loadAt}", "{memory,at}"])
      await withRow(
        `update computers set need = jsonb_set(need, $2::text[], (
           select jsonb_agg(to_jsonb(to_char(
             (now() - interval '4 hours' + (i * interval '6 minutes')) at time zone 'UTC',
             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by i)
           from generate_series(0, jsonb_array_length(need #> $2::text[]) - 1) i))
         where user_id = $1 and need #> $2::text[] is not null`,
        [at],
      );
  };
  // What the usage page says of the runs, read before the record is aged.
  const runsSay = async () =>
    (
      await fetch(`${stack.url}/usage`, { headers: { cookie: ottoNow } })
    ).text();
  const resizes = () =>
    asOrg(
      bakeryOrg,
      async (q) =>
        (
          await q.query(
            "select e.kind, e.size from computer_events e join computers c on c.id = e.computer_id where c.user_id = $1 and e.kind = 'resized' order by e.at",
            [ottoId],
          )
        ).rows,
    );
  // The Finder hides what a Mac hides: a dotfolder is on the disk, in the
  // daemon's listing for the shell and the tools, and not on the page.
  const pressedMachine = await current();
  const asMachine = (path, init) =>
    fetch(`http://127.0.0.1:${pressedMachine.port}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${pressedMachine.env.COMPUTER_SECRET}`,
        "content-type": "application/json",
      },
    });
  await asMachine("/fs/folder", {
    method: "POST",
    body: JSON.stringify({ path: "/.cache" }),
  });
  const daemonSees = (await (await asMachine("/fs?path=%2F")).json()).entries;
  const finderShows = await computerPage(ottoNow);
  check(
    "the Finder hides dotfiles; the daemon lists them",
    daemonSees.some((e) => e.name === ".cache") &&
      !finderShows.includes('data-folder="/.cache"') &&
      !finderShows.includes('data-tree="/.cache"'),
    `${daemonSees.map((e) => e.name).join(", ")} on the disk`,
  );
  await press({ free: 0.59, load: 0.12 });
  await sleep(500);
  const figures = await computerPage(ottoNow);
  check(
    "the status bar shows the last report's CPU and memory",
    /data-cpu="12"/.test(figures) &&
      /data-memory="41"/.test(figures) &&
      figures.includes("CPU 12%") &&
      figures.includes("memory 41% used") &&
      !/data-wants=/.test(figures) &&
      !/data-pending=/.test(figures),
    `cpu ${figures.match(/data-cpu="([^"]*)"/)?.[1]}, memory ${figures.match(/data-memory="([^"]*)"/)?.[1]}`,
  );
  // A figure the machine would never report of itself is refused whole,
  // so nothing pretends a share of memory below zero from then on.
  const refusedPress = await press({ free: -1, load: 0.12 }, 400);
  await sleep(500);
  const stillFigures = await computerPage(ottoNow);
  check(
    "a pressure below zero is refused and the last report stands",
    refusedPress && /data-memory="41"/.test(stillFigures),
    `memory ${stillFigures.match(/data-memory="([^"]*)"/)?.[1]}`,
  );

  // Short of memory while busy: more memory is on its way, offered now,
  // and the machine runs on until a quiet moment. A terminal open is not
  // a quiet moment either.
  const busy = await press({ free: 0.2, load: 0.9 });
  const stillBusy = await unchanged(busy);
  const pending = await computerPage(ottoNow);
  check(
    "short of memory while busy, more memory is on its way and offered now",
    stillBusy &&
      busy.state === "started" &&
      /data-wants="shared-cpu-2x:2048"/.test(pending) &&
      /data-pending="up"/.test(pending) &&
      pending.includes("it needs more memory") &&
      pending.includes("Restart with more memory now"),
    `wants ${pending.match(/data-wants="([^"]*)"/)?.[1] ?? "nothing"}, ${busy.state}, machine ${stillBusy ? "kept" : "replaced"}`,
  );
  const termLink = await fetch(
    `${stack.url}/computer/terminal?session=smoke-quiet`,
    { headers: { cookie: ottoNow } },
  ).then(async (r) => (await r.json()).url);
  const withTerminal = await new Promise((resolve) => {
    const ws = new WebSocket(termLink);
    ws.onopen = async () => {
      await sleep(300);
      await press({ free: 0.2, load: 0.1 });
      const kept = await unchanged(busy);
      ws.close();
      resolve(kept);
    };
    ws.onerror = () => resolve(null);
  });
  await sleep(500);
  check(
    "a terminal open is not a quiet moment",
    withTerminal === true && (await current()).id === busy.id,
    withTerminal === null
      ? "no socket"
      : `machine ${withTerminal ? "kept" : "replaced"}`,
  );
  // A sweep first, so the window the ledger prices next begins with the
  // machine running at its first size.
  await sleep(1100);
  await fetch(`${stack.url}/meter/sweep`, {
    headers: { authorization: "Bearer smoke" },
  });
  const asked = await form("/computer/bigger", { path: "/" }, ottoNow);
  const askedRow = await replaced(busy);
  const askedMachine = fake.machines.get(askedRow.machine_id);
  const askedPage = await computerPage(ottoNow);
  check(
    "restarted with more memory now, it comes back bigger on the same disk, and the page says so",
    asked.headers.get("location")?.includes("bigger=done") &&
      !fake.machines.has(busy.id) &&
      askedRow.size === "shared-cpu-2x:2048" &&
      askedMachine.guest?.memory_mb === 2048 &&
      askedMachine.volume === busy.volume &&
      askedMachine.state === "started" &&
      /data-size="shared-cpu-2x:2048"/.test(askedPage) &&
      !/data-wants=/.test(askedPage) &&
      /data-sized-up="shared-cpu-2x:2048"/.test(askedPage) &&
      askedPage.includes("sized up to 2 GB at") &&
      askedPage.includes(", as you asked"),
    `${asked.headers.get("location")?.split("?")[1]}; ${askedRow.size} at ${askedMachine?.guest?.memory_mb} MB, ${askedMachine?.state}`,
  );
  // The old size's last stretch ends at the moment the old machine went,
  // not at the sweep that priced it.
  await sleep(1100);
  await fetch(`${stack.url}/meter/sweep`, {
    headers: { authorization: "Bearer smoke" },
  });
  const { ending, lastOld } = await asOrg(bakeryOrg, async (q) => ({
    ending: (
      await q.query(
        "select e.kind, extract(epoch from e.at) * 1000 as at from computer_events e join computers c on c.id = e.computer_id where c.user_id = $1 and e.kind in ('asked-bigger', 'destroyed', 'resized') order by e.at desc limit 3",
        [ottoId],
      )
    ).rows.reverse(),
    lastOld: (
      await q.query(
        "select quantity::float8 as quantity, extract(epoch from from_at) * 1000 as from_ms from usage where user_id = $1 and resource = 'compute' and price = $2 order by from_at desc limit 1",
        [ottoId, PRICES.compute["shared-cpu-1x:1024"]],
      )
    ).rows[0],
  }));
  const destroyedAt = Number(
    ending.find((e) => e.kind === "destroyed")?.at ?? NaN,
  );
  const ran = lastOld ? (destroyedAt - Number(lastOld.from_ms)) / 1000 : NaN;
  check(
    "the meter stops where the old machine went, and the new size is its own stretch",
    ending.map((e) => e.kind).join(",") === "asked-bigger,destroyed,resized" &&
      Math.abs(lastOld?.quantity - ran) < 1,
    `${ending.map((e) => e.kind).join(",")}; ${lastOld?.quantity?.toFixed(2)} s billed of ${ran.toFixed(2)} s run at the first size`,
  );
  const saidAsked = (await runsSay()).includes(
    "you restarted it with more memory",
  );
  await ageResizes();
  // Short of memory at a quiet moment: up a rung, so nothing ran out.
  const quietBefore = await current();
  await press({ free: 0.2, load: 0.1 });
  const up2 = await replaced(quietBefore);
  const up2Page = await computerPage(ottoNow);
  check(
    "short of memory at a quiet moment, it comes back bigger so nothing ran out",
    up2.size === "shared-cpu-4x:4096" &&
      fake.machines.get(up2.machine_id)?.guest?.memory_mb === 4096 &&
      /data-sized-up="shared-cpu-4x:4096"/.test(up2Page) &&
      up2Page.includes("so nothing ran out") &&
      !/data-wants=/.test(up2Page),
    `${up2.size}, ${up2Page.match(/data-sized-up="([^"]*)"/)?.[1] ?? "nothing said"}`,
  );
  const saidShort = (await runsSay()).includes(
    "it was short of memory and came back bigger",
  );
  await ageResizes();
  // A kill goes up at once, busy or not, two rungs when starved, never
  // past the top.
  const killedBefore = await current();
  await press({ free: 0.05, load: 0.9, oom: 1 });
  const up3 = await replaced(killedBefore);
  const saidOom = (await runsSay()).includes(
    "it ran out of memory and came back bigger",
  );
  check(
    "a kill goes up at once, two rungs when starved, never past the top; the usage page says why",
    up3.size === "performance-2x:8192" &&
      fake.machines.get(up3.machine_id)?.guest?.memory_mb === 8192 &&
      saidAsked &&
      saidShort &&
      saidOom,
    `${up3.size}; ${(await resizes()).map((r) => r.size).join(" → ")}; said ${[saidAsked && "asked", saidShort && "short", saidOom && "out"].filter(Boolean).join(", ")}`,
  );
  // Thirty-six reports fired in a moment are not three hours, and come
  // down nothing; three hours of them, with a change of size three hours
  // behind, come down a rung.
  const burstBefore = await current();
  for (let i = 0; i < KEPT; i++) await press({ free: 0.8, load: 0.1 });
  const burstHeld = await unchanged(burstBefore);
  await ageReports();
  const heldBefore = await current();
  await press({ free: 0.8, load: 0.1 });
  const held = await unchanged(heldBefore);
  await ageResizes();
  // The machine made next boots on a disk of one megabyte, for the pulls
  // below.
  fake.volumes.get(heldBefore.volume).size_gb = 0.001;
  // A backup on its way when the machine went down died with it: the
  // machine that boots next says so, and the row is let go of.
  await withRow(
    "insert into backups (user_id, key) values ($1, 'orgs/x/members/x/backups/died-with-the-machine.tar.gz')",
  );
  await press({ free: 0.8, load: 0.1 });
  const down = await replaced(heldBefore);
  const downPage = await computerPage(ottoNow);
  const downRuns = await runsSay();
  const sizes = (await resizes()).map((r) => r.size);
  check(
    "three hours of room to spare comes down a rung, quietly, never within three hours of a change",
    burstHeld &&
      held &&
      down.size === "shared-cpu-4x:4096" &&
      fake.machines.get(down.machine_id)?.guest?.memory_mb === 4096 &&
      fake.machines.get(down.machine_id)?.volume === heldBefore.volume &&
      /data-size="shared-cpu-4x:4096"/.test(downPage) &&
      !/data-sized-up=/.test(downPage) &&
      !/data-wants=/.test(downPage) &&
      sizes.join(",") ===
        "shared-cpu-2x:2048,shared-cpu-4x:4096,performance-2x:8192,shared-cpu-4x:4096" &&
      downRuns.includes("it had room to spare and came back smaller"),
    `burst ${burstHeld ? "held" : "changed"}, then ${held ? "held" : "changed"} within three hours; ${sizes.join(" → ")}; ${downRuns.includes("it had room to spare and came back smaller") ? "said why" : "said nothing"}`,
  );
  let diedWith;
  for (let i = 0; i < 40 && !diedWith?.gone; i++) {
    diedWith = await asOrg(bakeryOrg, async (q) => {
      await q.query("select set_config('app.meter', 'sweep', true)");
      return (
        await q.query(
          "select deleted_at is not null as gone from backups where key like '%died-with-the-machine%'",
        )
      ).rows[0];
    });
    if (!diedWith?.gone) await sleep(250);
  }
  check(
    "a backup on its way dies with the machine, and the next boot says so",
    diedWith?.gone === true,
    `row ${JSON.stringify(diedWith)}`,
  );
  const resizedMachine = await current();
  await sleep(1100);
  await fetch(`${stack.url}/meter/sweep`, {
    headers: { authorization: "Bearer smoke" },
  });
  const computePrices = await asOrg(bakeryOrg, async (q) =>
    (
      await q.query(
        "select distinct price::float8 as price from usage where user_id = $1 and resource = 'compute' and quantity > 0",
        [ottoId],
      )
    ).rows.map((r) => r.price),
  );
  const nowBigger = await (
    await fetch(`${stack.url}/meter/live`, { headers: { cookie: ottoNow } })
  ).json();
  check(
    "the ledger prices each stretch at its own size",
    computePrices.includes(PRICES.compute["shared-cpu-1x:1024"]) &&
      computePrices.includes(PRICES.compute["shared-cpu-2x:2048"]) &&
      computePrices.includes(PRICES.compute["performance-2x:8192"]) &&
      nowBigger.active.some((a) => a.resource === "compute"),
    `prices ${computePrices.join(", ")}; ${nowBigger.active.map((a) => a.resource).join("; ")}`,
  );
  // A month of a computer's life, priced from its events alone: made, a
  // first machine that failed and went, placed, run, asleep, run again,
  // replaced at a bigger size on the same disk, the disk grown, asleep
  // again; a reset is nothing to the meter.
  // Every second of compute is at the size that ran it, the image while
  // off spans both machines, the disk both sizes, and cutting the month
  // into sweeps changes nothing.
  const T0 = Date.UTC(2026, 0, 1);
  const at = (secs) => new Date(T0 + secs * 1000);
  const [small, bigger] = LADDER;
  const life = [
    [0, "created", small, 3],
    [10, "volume", small, 3],
    [12, "failed", small, 3],
    [15, "destroyed", small, 3],
    [20, "stopped", small, 3],
    [60, "started", small, 3],
    [3660, "suspended", small, 3],
    [7200, "started", small, 3],
    [9000, "stopped", small, 3],
    [9100, "destroyed", small, 3],
    [9100, "resized", bigger, 3],
    [9200, "stopped", bigger, 3],
    [9300, "started", bigger, 3],
    [10000, "extended", bigger, 6],
    [10300, "suspended", bigger, 6],
  ];
  const lifeId = crypto.randomUUID();
  await asOrg(stranger.orgId, async (q) => {
    await q.query(
      "insert into computers (id, org_id, user_id, region, size, disk_gb, volume_id, machine_id, state, created_at) values ($1, $2, $3, 'sjc', $4, 6, 'vol_life', 'm_life', 'suspended', $5)",
      [lifeId, stranger.orgId, stranger.userId, bigger, at(0)],
    );
    for (const [secs, kind, size, gb] of life)
      await q.query(
        "insert into computer_events (computer_id, kind, size, disk_gb, at) values ($1, $2, $3, $4, $5)",
        [lifeId, kind, size, gb, at(secs)],
      );
  });
  const priced = async (from, to) => {
    const out = { compute: {}, rootfs: 0, disk: 0 };
    await asOrg(stranger.orgId, async (q) => {
      await q.query("select set_config('app.member_id', $1, true)", [
        stranger.userId,
      ]);
      for (const m of await measure(q, stranger.userId, at(from), at(to)))
        if (m.resource === "compute")
          out.compute[m.liveUnit] = (out.compute[m.liveUnit] ?? 0) + m.quantity;
        else out[m.resource] = (out[m.resource] ?? 0) + m.quantity;
    });
    return out;
  };
  const month = await priced(0, 20000);
  const cuts = [0, 2000, 9150, 9250, 20000];
  const pieces = await Promise.all(
    cuts.slice(1).map((to, i) => priced(cuts[i], to)),
  );
  const sweeps = pieces.reduce(
    (a, b) => ({
      compute: Object.fromEntries(
        LADDER.map((s) => [s, (a.compute[s] ?? 0) + (b.compute[s] ?? 0)]),
      ),
      rootfs: a.rootfs + b.rootfs,
      disk: a.disk + b.disk,
    }),
    { compute: {}, rootfs: 0, disk: 0 },
  );
  // A window the machine is up at the start of and destroyed inside:
  // the image's row begins where the window does.
  const cutShort = await asOrg(stranger.orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [
      stranger.userId,
    ]);
    return (await measure(q, stranger.userId, at(7300), at(9150))).find(
      (m) => m.resource === "rootfs",
    );
  });
  const expected = {
    [small]: 3600 + 1800,
    [bigger]: 1000,
    rootfs: 3 + 9080 + 10800 - 6400,
    disk: 3 * 9990 + 6 * 10000,
  };
  check(
    "a month of runs, sleeps, a resize and a growth is priced exactly from events",
    near(month.compute[small], expected[small]) &&
      near(month.compute[bigger], expected[bigger]) &&
      near(month.rootfs, expected.rootfs) &&
      near(month.disk, expected.disk) &&
      near(sweeps.compute[small], expected[small]) &&
      near(sweeps.compute[bigger], expected[bigger]) &&
      near(sweeps.rootfs, expected.rootfs) &&
      near(sweeps.disk, expected.disk) &&
      cutShort?.from.getTime() === at(7300).getTime() &&
      near(cutShort.quantity, 1800 - 1700),
    `${small} ${month.compute[small]} s, ${bigger} ${month.compute[bigger]} s, image off ${month.rootfs} GB·s, disk ${month.disk} GB·s; in four sweeps ${sweeps.rootfs} and ${sweeps.disk}; destroyed mid-window: ${cutShort?.quantity} GB·s from ${cutShort?.from?.toISOString()}`,
  );
  await asOrg(stranger.orgId, async (q) => {
    await q.query("delete from computer_events where computer_id = $1", [
      lifeId,
    ]);
    await q.query("delete from computers where id = $1", [lifeId]);
  });
  // Pulls accepted together cannot together overrun the disk: what each
  // has still to write is held against the room until it ends. Two
  // declared bigger than the megabyte together: the second is refused
  // on the spot, the first lands, and the room is free again after.
  const bytes = Buffer.alloc(600_000, 120);
  const source = createServer((req, res) => {
    res.writeHead(200, { "content-length": bytes.length });
    res.end(bytes);
  });
  await new Promise((r) => source.listen(0, "127.0.0.1", r));
  const sourceUrl = `http://127.0.0.1:${source.address().port}/big`;
  const asResized = (path, init) =>
    fetch(`http://127.0.0.1:${resizedMachine.port}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${resizedMachine.env.COMPUTER_SECRET}`,
        "content-type": "application/json",
      },
    });
  const pullTo = (name, size) =>
    asResized("/fs/pull", {
      method: "POST",
      body: JSON.stringify({
        id: crypto.randomUUID(),
        path: `/${name}`,
        url: sourceUrl,
        size,
      }),
    });
  const first = await pullTo("big-a.bin", bytes.length);
  const second = await pullTo("big-b.bin", bytes.length);
  let landedA = null;
  for (let i = 0; i < 40 && landedA?.size !== bytes.length; i++) {
    landedA = await (await asResized("/fs/stat?path=%2Fbig-a.bin")).json();
    if (landedA?.size !== bytes.length)
      await new Promise((r) => setTimeout(r, 250));
  }
  const third = await pullTo("big-c.bin", 300_000);
  check(
    "pulls accepted together cannot overrun the disk; the room comes back",
    first.status === 202 &&
      second.status === 507 &&
      landedA?.size === bytes.length &&
      third.status === 202,
    `first ${first.status}, second ${second.status}, a ${landedA?.size} bytes, then ${third.status}`,
  );
  // The third was promised less than its source sends, so it is cut off
  // short of landing: its hidden copy goes with it, and once the app has
  // been told, the name is free for the next pull.
  await asResized("/fs?path=%2Fbig-a.bin", { method: "DELETE" });
  const fourthId = crypto.randomUUID();
  let fourth = 409;
  for (let i = 0; i < 40 && fourth === 409; i++) {
    await new Promise((r) => setTimeout(r, 250));
    fourth = (
      await asResized("/fs/pull", {
        method: "POST",
        body: JSON.stringify({
          id: fourthId,
          path: "/big-c.bin",
          url: sourceUrl,
          size: bytes.length,
        }),
      })
    ).status;
  }
  for (let i = 0; i < 40; i++) {
    const c = await (await asResized("/fs/stat?path=%2Fbig-c.bin")).json();
    if (c?.size === bytes.length) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  source.close();
  const hidden = (
    await fs.readdir(path.join(scratch, "computers", resizedMachine.volume))
  ).filter((n) => n.startsWith(".landing-") && n !== `.landing-${fourthId}`);
  check(
    "a pull cut short leaves no hidden copy, and its name is free again",
    fourth === 202 && hidden.length === 0,
    `then ${fourth}, hidden ${hidden.join(", ") || "none"}`,
  );
  await asResized("/fs?path=%2Fbig-c.bin", { method: "DELETE" });
  // A landing is claimed before anything about it is checked, so two
  // pulls arriving together cannot both start: the same id and path is
  // one pull, joined; another id for the path, or the path's id for
  // another path, is refused.
  let pulled = 0;
  const holding = [];
  const slow = createServer((req, res) => {
    pulled++;
    holding.push(res);
  });
  await new Promise((r) => slow.listen(0, "127.0.0.1", r));
  const slowUrl = `http://127.0.0.1:${slow.address().port}/held`;
  const claimId = crypto.randomUUID();
  const claim = (id, name) =>
    asResized("/fs/pull", {
      method: "POST",
      body: JSON.stringify({ id, path: `/${name}`, url: slowUrl, size: 5 }),
    }).then((r) => r.status);
  const together = await Promise.all([
    claim(claimId, "claimed.bin"),
    claim(claimId, "claimed.bin"),
  ]);
  const otherId = await claim(crypto.randomUUID(), "claimed.bin");
  const otherPath = await claim(claimId, "elsewhere.bin");
  for (const res of holding) {
    res.writeHead(200, { "content-length": 5 });
    res.end("hello");
  }
  slow.close();
  check(
    "a landing is claimed before it is checked: one pull per path, one path per id",
    together.every((s) => s === 202) &&
      pulled === 1 &&
      otherId === 409 &&
      otherPath === 409,
    `together ${together.join(" and ")}, pulled ${pulled} time(s); another id ${otherId}, another path ${otherPath}`,
  );
  for (let i = 0; i < 40; i++) {
    const c = await (await asResized("/fs/stat?path=%2Fclaimed.bin")).json();
    if (c?.size === 5) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  // A link made in the shell that points outside the home, with a name
  // under it that is not there yet, reaches nothing: a folder, a move and
  // a pull under it are refused, and nothing is made outside.
  const outside = path.join(scratch, "outside");
  const link = path.join(scratch, "computers", resizedMachine.volume, "out");
  await fs.mkdir(outside, { recursive: true });
  await fs.symlink(outside, link);
  const post = (route, body) =>
    asResized(route, { method: "POST", body: JSON.stringify(body) }).then(
      (r) => r.status,
    );
  const viaLink = {
    folder: await post("/fs/folder", { path: "/out/made" }),
    move: await post("/fs/move", { from: "/claimed.bin", to: "/out/made" }),
    pull: await post("/fs/pull", {
      id: crypto.randomUUID(),
      path: "/out/made",
      url: slowUrl,
      size: 5,
    }),
  };
  await fs.unlink(link);
  await asResized("/fs?path=%2Fclaimed.bin", { method: "DELETE" });
  check(
    "a link out of the home reaches nothing, even to a name not there yet",
    Object.values(viaLink).every((status) => status === 400) &&
      !(await fs.stat(path.join(outside, "made")).catch(() => null)),
    `folder ${viaLink.folder}, move ${viaLink.move}, pull ${viaLink.pull}`,
  );
  // Power off: the machine goes at once and the disk stays; the page says
  // so and offers Power on; a look makes nothing. Six power-ons at once make
  // one computer, and the page is back.
  const margeBefore = await rowOf(bakeryOrg, margeId);
  const machinesBeforeOff = fake.machines.size;
  const volumesBeforeOff = fake.volumes.size;
  const turnedOff = await form("/computer/off", { path: "/" }, margeOwner);
  const offPage = await computerPage(margeOwner);
  await computerPage(margeOwner);
  const margeOff = await rowOf(bakeryOrg, margeId);
  const offEvents = await asOrg(bakeryOrg, async (q) =>
    (
      await q.query(
        "select e.kind from computer_events e join computers c on c.id = e.computer_id where c.user_id = $1 and e.kind in ('powered-off', 'destroyed') order by e.at desc limit 2",
        [margeId],
      )
    ).rows.map((r) => r.kind),
  );
  const liveOff = await (
    await fetch(`${stack.url}/meter/live`, { headers: { cookie: margeOwner } })
  ).json();
  check(
    "Power off destroys the machine, keeps the disk, stops the meter, and the page says so",
    turnedOff.headers.get("location")?.includes("computer=off") &&
      !fake.machines.has(margeBefore.machine_id) &&
      fake.machines.size === machinesBeforeOff - 1 &&
      fake.volumes.has(margeBefore.volume_id) &&
      margeOff.off_at !== null &&
      margeOff.machine_id === null &&
      offEvents.join(",") === "destroyed,powered-off" &&
      /data-state="powered-off"/.test(offPage) &&
      offPage.includes("You powered this off on") &&
      offPage.includes("3 GB disk and everything on it are kept") &&
      offPage.includes("data-power-on") &&
      !liveOff.active.some((a) => a.resource === "compute") &&
      liveOff.active.some((a) => a.resource === "disk"),
    `${machinesBeforeOff} → ${fake.machines.size} machines; ${offEvents.join(",")}; ticking ${liveOff.active.map((a) => a.resource).join(", ")}`,
  );
  // A sweep while it is off makes nothing and starts nothing.
  await fetch(`${stack.url}/meter/sweep`, {
    headers: { authorization: "Bearer smoke" },
  });
  const sweptOff = await rowOf(bakeryOrg, margeId);
  check(
    "a sweep makes nothing for a computer its person powered off",
    fake.machines.size === machinesBeforeOff - 1 &&
      sweptOff.machine_id === null &&
      sweptOff.off_at !== null,
    `${fake.machines.size} machines; machine ${sweptOff.machine_id ?? "none"}`,
  );
  const turnedOn = await Promise.all(
    Array.from({ length: 6 }, () =>
      form("/computer/on", { path: "/" }, margeOwner),
    ),
  );
  const margeOn = await built(bakeryOrg, margeId, {
    not: margeBefore.machine_id,
  });
  const onPage = await computerPage(margeOwner);
  check(
    "racing power-ons make one computer, on the same disk, and the page is back",
    turnedOn.every((r) => r.headers.get("location")?.includes("computer=on")) &&
      fake.machines.size === machinesBeforeOff &&
      fake.volumes.size === volumesBeforeOff &&
      margeOn.off_at === null &&
      fake.machines.get(margeOn.machine_id)?.volume === margeBefore.volume_id &&
      /data-state="started"/.test(onPage),
    `${fake.machines.size} machines, ${fake.volumes.size} volumes`,
  );
  // An owner switches Acme's computers on: six first sign-ins at once by
  // Wile make one computer, running. Off again: the sweep stops it, a
  // sign-in makes none, and the page and the notice say so.
  const acmeOrg = orgs[0].id;
  const wileId = "10000000-0000-4000-8000-000000000001";
  await fetch(`${stack.url}/settings/computers`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({ on: "yes" }),
    redirect: "manual",
  });
  const machinesBeforeAcme = fake.machines.size;
  await Promise.all(Array.from({ length: 6 }, () => signIn(wileId)));
  const wileRow = await built(acmeOrg, wileId);
  check(
    "six first sign-ins at once make one computer, running",
    fake.machines.size === machinesBeforeAcme + 1 &&
      fake.machines.get(wileRow.machine_id)?.state === "started",
    `${machinesBeforeAcme} → ${fake.machines.size} machines, Wile's ${fake.machines.get(wileRow.machine_id)?.state}`,
  );
  const acmeOff = await fetch(`${stack.url}/settings/computers`, {
    method: "POST",
    headers: { cookie: wile },
    body: new URLSearchParams({ on: "no" }),
    redirect: "manual",
  });
  const acmeNotice = await (
    await fetch(`${stack.url}/settings?computers=off`, {
      headers: { cookie: wile },
    })
  ).text();
  await fetch(`${stack.url}/meter/sweep`, {
    headers: { authorization: "Bearer smoke" },
  });
  await signIn(wileId);
  await sleep(1000);
  const wileMachine = fake.machines.get(wileRow.machine_id);
  check(
    "the switch turned off stops the org's machines at the sweep, makes none at sign-in, and says so",
    acmeOff.headers.get("location")?.endsWith("computers=off") &&
      acmeNotice.includes("every machine in the org stops within the hour") &&
      wileMachine?.state === "stopped" &&
      (await rowOf(acmeOrg, wileId)).state === "stopped" &&
      fake.machines.size === machinesBeforeAcme + 1 &&
      (await computerPage(wile)).includes(
        "Computers are off for this org. You can turn them on again in",
      ),
    `${acmeOff.headers.get("location")?.split("?")[1]}; notice ${acmeNotice.includes("every machine in the org stops within the hour") ? "shown" : "missing"}; Wile's machine ${wileMachine?.state}, row ${(await rowOf(acmeOrg, wileId)).state}, ${fake.machines.size} machines`,
  );
  check(
    "a person's name is one across orgs",
    (await page(ottoNow)).includes("Sign out, Otto L. Loaf"),
    "renamed in the observatory, seen in the bakery",
  );
  // Renames racing from both orgs all land, none deadlocks, and every org
  // agrees on one name.
  const renames = await Promise.all(
    ["Otto A", "Otto B", "Otto C", "Otto D", "Otto E", "Otto F"].map(
      (name, i) => {
        const f = new FormData();
        f.set("first_name", "Otto");
        f.set("last_name", name.slice("Otto ".length));
        return settings("/settings/profile", f, i % 2 ? ottoObs : ottoNow);
      },
    ),
  );
  const seen = [await page(ottoNow), await page(ottoObs)].map(
    (h) => h.match(/Sign out, (Otto [A-F])</)?.[1],
  );
  const deadlocks = await asOrg(
    "00000000-0000-4000-8000-000000000002",
    async (q) =>
      (
        await q.query(
          "select deadlocks::int as n from pg_stat_database where datname = current_database()",
        )
      ).rows[0].n,
  );
  check(
    "racing renames all land, and every org agrees",
    renames.every((r) => r.status === 303) &&
      deadlocks === 0 &&
      seen[0] !== undefined &&
      seen[0] === seen[1],
    `${renames.map((r) => r.status).join(" ")}, ${deadlocks} deadlocks, ${seen.join(" vs ")}`,
  );
  await settings("/settings/profile", rename, ottoObs);

  // Leaving. Road Runner leaves Acme and becomes a past member; Wile, who
  // holds Acme, cannot leave until he hands it over.
  const roadRunner = await signIn("10000000-0000-4000-8000-000000000002");
  const left = await fetch(`${stack.url}/auth/leave`, {
    method: "POST",
    headers: { cookie: roadRunner },
    redirect: "manual",
  });
  const acmeAfter = await settingsPage(wile);
  check(
    "a member leaves",
    left.status === 303 &&
      /^session=;/.test(left.headers.get("set-cookie") ?? "") &&
      !/name="remove"[^>]*value="10000000-0000-4000-8000-000000000002"|value="10000000-0000-4000-8000-000000000002"[^>]*name="remove"/.test(
        acmeAfter,
      ) &&
      acmeAfter.includes("Show 1 past member"),
    "signed out, under Acme's past members",
  );
  const wileLeaves = await fetch(`${stack.url}/auth/leave`, {
    method: "POST",
    headers: { cookie: wile },
    redirect: "manual",
  });
  const roadRunnerBack = await settings(
    "/settings/members",
    new URLSearchParams({ restore: "10000000-0000-4000-8000-000000000002" }),
    wile,
  );
  check(
    "the principal cannot leave",
    wileLeaves.headers.get("location")?.endsWith("leave=principal") &&
      (await settingsPage(wile)).includes("wile@acme-rockets.test") &&
      roadRunnerBack.headers.get("location")?.endsWith("member=restored"),
    "sent back, still in Acme; Road Runner brought back",
  );

  // Deleting an org. Only its principal, and only by typing its name. Late
  // holds an org with a note in it, a member and a past member, and deletes
  // it; nothing of it is left, and Late is still a person.
  const lateCookie = `session=${await createSession(late)}`;
  const lateNote = await fetch(`${stack.url}/brain/records`, {
    method: "POST",
    headers: { cookie: lateCookie },
    body: new URLSearchParams({
      kind: "note",
      title: "Rent",
      body: "Due on the first.",
    }),
    redirect: "manual",
  });
  await settings(
    "/invite",
    new URLSearchParams({ email: "mate@late.test" }),
    lateCookie,
  );
  await settings(
    "/invite",
    new URLSearchParams({ email: "gone@late.test" }),
    lateCookie,
  );
  const mate = await admit({
    email: "mate@late.test",
    firstName: "Mate",
    lastName: null,
  });
  const goneMate = await admit({
    email: "gone@late.test",
    firstName: "Gone",
    lastName: null,
  });
  await settings(
    "/settings/members",
    new URLSearchParams({ remove: goneMate.userId }),
    lateCookie,
  );
  const mateCookie = `session=${await createSession(mate)}`;
  const ottoDeletes = await fetch(`${stack.url}/auth/delete-org`, {
    method: "POST",
    headers: { cookie: ottoNow },
    body: new URLSearchParams({ name: "Blue Whale Bakery & Co" }),
    redirect: "manual",
  });
  const wrongName = await fetch(`${stack.url}/auth/delete-org`, {
    method: "POST",
    headers: { cookie: lateCookie },
    body: new URLSearchParams({ name: "late" }),
    redirect: "manual",
  });
  check(
    "deleting an org takes its principal and its exact name",
    ottoDeletes.status === 403 &&
      wrongName.headers.get("location")?.endsWith("delete=mismatch") &&
      (await settingsPage(ottoNow)).includes("Blue Whale Bakery"),
    `owner ${ottoDeletes.status}, wrong name ${wrongName.headers.get("location")?.split("?")[1]}`,
  );
  // Only the machine a link names holds the key to read it: a forged link
  // landing on another machine is replayed to the one it names, and
  // refused there.
  const [someMachine] = [...fake.machines.values()];
  const forgedLink = await fetch(
    `${fake.url}/dl/${someMachine.id}/9999999999999/forged?path=%2Fx`,
    {
      headers: {
        "fly-force-instance-id": [...fake.machines.keys()][1] ?? someMachine.id,
      },
    },
  );
  check(
    "a forged link is refused by the machine it names",
    forgedLink.status === 403 &&
      (await forgedLink.text()).includes("not one of ours"),
    `${forgedLink.status}, ${someMachine.id} ${someMachine.state}`,
  );
  // A link past its expiry is refused where it lands and never replayed;
  // a fresh one for another machine is replayed there unread.
  const running = [...fake.machines.values()].find(
    (m) => m.state === "started",
  );
  const nobody = "m00009999";
  const direct = (expires) =>
    fetch(
      `http://127.0.0.1:${running.port}/dl/${nobody}/${expires}/forged?path=%2Fx`,
    );
  const expiredLink = await direct(1);
  const freshLink = await direct(9999999999999);
  check(
    "an expired link is refused unread; a fresh one is replayed unread",
    expiredLink.status === 403 &&
      !expiredLink.headers.has("fly-replay") &&
      freshLink.headers.get("fly-replay") === `instance=${nobody}`,
    `expired ${expiredLink.status}${expiredLink.headers.has("fly-replay") ? " and replayed" : ""}; fresh ${freshLink.headers.get("fly-replay") ?? freshLink.status}`,
  );
  // Late's org has computers, as every org founded does; Late opens
  // theirs, so the org has a volume and a machine on Fly when it is
  // deleted.
  await fetch(`${stack.url}/computer`, { headers: { cookie: lateCookie } });
  const lateThings = {
    volumes: fake.volumes.size,
    machines: fake.machines.size,
  };
  const deleted = await fetch(`${stack.url}/auth/delete-org`, {
    method: "POST",
    headers: { cookie: lateCookie },
    body: new URLSearchParams({ name: "Late" }),
    redirect: "manual",
  });
  check(
    "an org's machine and volume go with it, owed first and paid at once",
    fake.volumes.size === lateThings.volumes - 1 &&
      fake.machines.size === lateThings.machines - 1,
    `${lateThings.volumes} → ${fake.volumes.size} volumes, ${lateThings.machines} → ${fake.machines.size} machines`,
  );
  const leftOfLate = await asOrg(late.orgId, async (q) => {
    await q.query("select set_config('app.past_members', 'on', true)");
    await q.query("select set_config('app.member_id', $1, true)", [
      late.userId,
    ]);
    return {
      orgs: (await q.query("select 1 from orgs")).rowCount,
      users: (await q.query("select 1 from users")).rowCount,
      records: (await q.query("select 1 from records")).rowCount,
    };
  });
  const latePerson = await asEmail(
    "late@bluewhale.test",
    async (q) => (await q.query("select 1 from people")).rowCount,
  );
  check(
    "an org deleted is gone, its people remain",
    lateNote.status === 303 &&
      deleted.status === 303 &&
      /^session=;/.test(deleted.headers.get("set-cookie") ?? "") &&
      leftOfLate.orgs === 0 &&
      leftOfLate.users === 0 &&
      leftOfLate.records === 0 &&
      latePerson === 1 &&
      (await page(lateCookie)).includes("Pick a person from the pill") &&
      (await page(mateCookie)).includes("Pick a person from the pill"),
    `note ${lateNote.status}; ${leftOfLate.orgs} orgs, ${leftOfLate.users} users, ${leftOfLate.records} records, ${latePerson} person, Mate signed out`,
  );

  // A membership restored carries the person's photo of today; the one
  // its hidden copy held, replaced meanwhile from another org, is paid
  // off at the restore.
  const beforeRemoval = await ottoPhoto();
  await settings(
    "/settings/members",
    new URLSearchParams({ remove: ottoId }),
    margeOwner,
  );
  photoForm.set(
    "avatar",
    new File([png], "elsewhere.png", { type: "image/png" }),
  );
  await settings("/settings/profile", photoForm, ottoObs);
  const heldWhileGone = await fs.readdir(uploadsDir);
  const ottoRestored = await settings(
    "/settings/members",
    new URLSearchParams({ restore: ottoId }),
    margeOwner,
  );
  const afterRestore = await ottoPhoto();
  const afterRestoreStore = await fs.readdir(uploadsDir);
  const restoreOwed = await asOrg(
    bakeryId,
    async (q) =>
      (
        await q.query(
          "select count(*)::int as n from orphans where kind = 'picture'",
        )
      ).rows[0].n,
  );
  check(
    "a restored membership's old photo is paid off",
    ottoRestored.headers.get("location")?.endsWith("member=restored") &&
      heldWhileGone.includes(beforeRemoval.key) &&
      afterRestore?.key !== beforeRemoval.key &&
      afterRestoreStore.includes(afterRestore?.key) &&
      !afterRestoreStore.includes(beforeRemoval.key) &&
      restoreOwed === 0,
    `${beforeRemoval.key} held while Otto was out, gone after the restore; ${restoreOwed} owed`,
  );

  const signedOutSettings = await fetch(`${stack.url}/settings`, {
    redirect: "manual",
  });
  check(
    "settings need a session",
    signedOutSettings.status === 307 &&
      new URL(signedOutSettings.headers.get("location") ?? "", stack.url)
        .pathname === "/",
    `answered ${signedOutSettings.status} → ${signedOutSettings.headers.get("location")}`,
  );

  await globalThis.__pool?.end();
  globalThis.__pool = undefined;

  const stale = await page(
    "session=00000000-0000-4000-8000-000000000001.00000000-0000-4000-8000-000000000009",
  );
  check(
    "unknown session",
    stale.includes("Pick a person from the pill"),
    "sign-in page",
  );
  // Every suite runs, whatever failed before it.
  failed = !(await smokeConnections(stack, signIn)) || failed;
  failed = !(await smokeDb(stack)) || failed;
  failed = !(await smokeBrain(stack)) || failed;
  failed = !(await smokeMcp(stack, signIn)) || failed;
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  // The pool goes before the database does, so a crash above is the error
  // that is shown, not the shutdown's.
  await globalThis.__pool?.end();
  await stack.stop();
  fake.close();
  await fs.rm(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
