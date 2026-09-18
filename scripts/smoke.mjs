// Boots the stack on a fresh database of its own, signs in as a person from
// each org through the development sign-in, checks that each sees only their
// own org, and that an invited email is admitted into the inviting org. This
// is the merge gate.
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { measure } from "../apps/web/lib/meter.ts";
import { KINDS } from "../apps/web/lib/orphans.ts";
import {
  createSession,
  foundOrg,
  membershipsOf,
  personOf,
  signIn as admit,
} from "../packages/db/src/auth.ts";
import { asEmail, asOrg, asPerson } from "../packages/db/src/index.ts";
import { orgs } from "../packages/db/src/seed.ts";
import { allow } from "../packages/db/src/throttle.ts";

import { share } from "../packages/brain/src/index.ts";
import { smokeBrain } from "./smoke-brain.mjs";
import { smokeConnections } from "./smoke-connections.mjs";
import { smokeSync } from "./smoke-sync.mjs";
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
    "VOYAGE_API_KEY",
  ].map((k) => [k, ""]),
);

// Everything this run writes — the database, the local store — lives in a
// directory of its own and dies with it, so a checkout's own data, the last
// run's and a run beside it never reach it.
await fs.mkdir(path.join(root, ".local"), { recursive: true });
const scratch = await fs.mkdtemp(path.join(root, ".local", "smoke-"));

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
    CRON_SECRET: "smoke",
    // The relay asks after people every second here, not every minute.
    SYNC_RECHECK_MS: "1000",
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

// One pane of settings: the members pane unless another is asked for,
// since that is where the org and who is in it are named.
async function settingsPage(cookie, pane = "members") {
  const res = await fetch(`${stack.url}/settings?pane=${pane}`, {
    headers: { cookie },
  });
  return (await res.text()).replaceAll("<!-- -->", "");
}

// Who the page says you are: the name on the menu bar's right.
const youOn = (html) => html.match(/data-you[^>]*>([^<]*)</)?.[1];

// Whether the page offers a switch to another org of yours. The offer
// sits under your picture, drawn in the browser from what the page
// carries for it.
const offers = (html, orgName) => html.includes(`\\"orgName\\":\\"${orgName}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// What the sign-in page says outside production.
const SIGNED_OUT = "Sign in as one of the seeded people";

let failed = false;
const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label.padEnd(40)} ${detail}`);
  failed ||= !ok;
};

try {
  await stack.ready();

  const out = await page();
  check("signed out", out.includes(SIGNED_OUT), "sign-in page");

  // The model gateway takes a token of a computer's and nothing else: a
  // stranger and a made-up token are refused, a path it does not carry is
  // not there, and a deployment that mints no keys says so.
  const gate = (token, path = "/v1/messages") =>
    fetch(`${stack.url}/model${path}`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: "{}",
    }).then((r) => r.status);
  const [noToken, madeUp, elsewhere] = await Promise.all([
    gate(null),
    gate("nobody.0000"),
    gate(null, "/v1/models"),
  ]);
  check(
    "model gateway refuses a stranger",
    [401, 503].includes(noToken) &&
      [401, 503].includes(madeUp) &&
      elsewhere === 404,
    `no token ${noToken}, made-up ${madeUp}, other path ${elsewhere}`,
  );

  // The first org signs in again at the end: its second visit reuses a pooled
  // connection where an old org setting exists as '' rather than missing.
  for (const org of [...orgs, orgs[0]]) {
    const cookie = await signIn(org.users[0].id);
    const html = await page(cookie);
    const got = (await settingsPage(cookie)).match(/>(\d+) members?</);
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
    (await page(marge)).includes(SIGNED_OUT),
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
  check(
    "invitation pending",
    (await settingsPage(wile)).includes("hire@acme-rockets.test"),
    "listed",
  );
  // A shared file's link is nothing to whoever it does not reach, and
  // nothing is shared with anyone here, where computers are off.
  const noSuchFile = await fetch(`${stack.url}/file/nope`, {
    headers: { cookie: wile },
    redirect: "manual",
  });
  const nothingShared = await fetch(`${stack.url}/computer/files/shared`, {
    headers: { cookie: wile },
  });
  check(
    "a file link leaks nothing",
    noSuchFile.status === 404 &&
      nothingShared.ok &&
      JSON.stringify(await nothingShared.json()) === "[]",
    `${noSuchFile.status}, shared with me: none`,
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
  const after = await settingsPage(wile);
  check(
    "invited person admitted",
    hire.orgId === orgs[0].id &&
      />3 members</.test(after) &&
      !/invited/.test(
        after.split("hire@acme-rockets.test")[1]?.slice(0, 200) ?? "",
      ),
    after.match(/\d+ members in /)?.[0] ?? "no match",
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
    (await page(`session=${orgs[1].id}.${wileSession}`)).includes(SIGNED_OUT),
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
  const afterRename = await settingsPage(margeOwner, "org");
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
    youOn(await page(otto)) === "Otto L.",
    "Otto L. in the corner",
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
  // Pim writes a note before leaving. Removed, he is a past member: hidden
  // from the roster, listed under past members, his note kept under the
  // membership he held. Brought back, or invited back, he is the same member
  // with the same note. Purged, he and the note are gone.
  const noted = await fetch(`${stack.url}/brain/records`, {
    method: "POST",
    headers: { cookie: pim },
    body: new URLSearchParams({
      type: "note",
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
  // The page saves with the last change it saw, and one that fell behind
  // is refused.
  const ovens =
    (
      await (
        await fetch(`${stack.url}/brain/search?q=Ovens`, {
          headers: { cookie: pim },
        })
      ).json()
    ).records[0]?.id ?? "";
  const changeUrl = `${stack.url}/brain/records/${ovens}/change`;
  const ovensSeen = async () =>
    (await (await fetch(changeUrl, { headers: { cookie: pim } })).json()).seen;
  const seenAtFirst = await ovensSeen();
  const posted = (body, seen) =>
    fetch(changeUrl, {
      method: "POST",
      headers: { cookie: pim, accept: "application/json" },
      body: new URLSearchParams({ body, seen: String(seen) }),
    });
  const inTime = await posted("Preheat by ten.", seenAtFirst);
  const landedAt = inTime.ok ? (await inTime.json()).seen : 0;
  const seenAfter = await ovensSeen();
  const behind = await posted("Preheat by four.", seenAtFirst);
  check(
    "a save that fell behind is refused",
    seenAtFirst > 0 &&
      inTime.status === 200 &&
      landedAt === seenAfter &&
      seenAfter > seenAtFirst &&
      behind.status === 409,
    `saw #${seenAtFirst}, saved ${inTime.status} at #${landedAt}, then #${seenAfter}, behind ${behind.status}`,
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
      afterRemove.includes("1 past member, kept") &&
      button("restore").test(afterRemove),
    "off the roster, under past members",
  );
  check(
    "removed member's session is dead",
    (await page(pim)).includes(SIGNED_OUT),
    "sign-in page",
  );
  check(
    "a member sees no past members",
    !(await settingsPage(otto)).includes("1 past member, kept"),
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
    "a purge by a member is refused",
    memberPurge.status === 403,
    `member answered ${memberPurge.status}`,
  );
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
  const deletion = await settingsPage(ottoNow, "org");
  check(
    "the principal hands the org over",
    handed.headers.get("location")?.endsWith("member=handed") &&
      /otto@bluewhale\.test[\s\S]*?principal<\/span>/.test(afterHandOver) &&
      deletion.includes("Delete Blue Whale Bakery"),
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
      offers(ottoHome, "Chartreuse Observatory"),
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
  // in it as its owner and keep the orgs they were in.
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
  check(
    "a person in an org founds another of their own, and lands in it",
    madeOrg.status === 303 &&
      !orgs.some((o) => o.id === ownOrgId) &&
      ownMember?.role === "owner" &&
      /<h1[^>]*>Otto&#x27;s Own/.test(ownHome) &&
      offers(ownHome, "Blue Whale Bakery"),
    `answered ${madeOrg.status}; ${ownHome.match(/<h1[^>]*>([^<]*)/)?.[1] ?? "no org"} as ${ownMember?.role}`,
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

  // A profile photo is bytes in the bucket: saving one records its size
  // for the meter, and replacing it removes the old object from the store.
  // The logo replaced earlier is gone.
  const bakeryId = "00000000-0000-4000-8000-000000000002";
  const ottoId = "20000000-0000-4000-8000-000000000002";
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
  const photoForm = new FormData();
  photoForm.set("first_name", "Otto");
  photoForm.set("last_name", "L. Loaf");
  photoForm.set("avatar", new File([png], "me.png", { type: "image/png" }));
  const photoSaved = await settings("/settings/profile", photoForm, ottoNow);
  const firstPhoto = await ottoPhoto();
  check(
    "a profile photo carries its size the moment it is saved",
    photoSaved.headers.get("location")?.endsWith("profile=saved") &&
      firstPhoto?.bytes === png.length &&
      (await fetch(`${stack.url}${logoUrl}`)).status === 404,
    `${png.length} bytes; the first logo gone`,
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
    "the meter prices the bucket and the brain per person",
    swept.appended > 0 &&
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
  // A record shared into a person's view is its owner's to pay for: the
  // brain bytes on the meter are the person's own rows and nothing shared
  // in, though the shared rows are in view.
  const shareOrg = orgs.find(
    (o) => o.id === "00000000-0000-4000-8000-000000000002",
  );
  const shareOwner = shareOrg.users.find(
    (u) => u.id === "20000000-0000-4000-8000-000000000001",
  );
  await asPerson(
    {
      orgId: shareOrg.id,
      personId: shareOwner.personId,
      userId: shareOwner.id,
    },
    async (q) => {
      const [record] = (
        await q.query(
          "select id from records where person_id = $1 and deleted_at is null limit 1",
          [shareOwner.id],
        )
      ).rows;
      await share(
        q,
        { record: record.id },
        { who: "member", id: "20000000-0000-4000-8000-000000000002" },
        "view",
      ).catch(() => {});
    },
  );
  const ownBrain = await asOrg(
    "00000000-0000-4000-8000-000000000002",
    async (q) => {
      const otto = "20000000-0000-4000-8000-000000000002";
      await q.query("select set_config('app.member_id', $1, true)", [otto]);
      const seen = (
        await q.query(
          "select count(*)::int as n from records where person_id <> $1",
          [otto],
        )
      ).rows[0].n;
      const own = Number(
        (
          await q.query(
            `select coalesce((select sum(pg_column_size(r.*)) from records r where r.person_id = $1), 0)
                  + coalesce((select sum(pg_column_size(e.*)) from edges e where e.person_id = $1), 0)
                  + coalesce((select sum(pg_column_size(v.*)) from events v where v.person_id = $1), 0) as bytes`,
            [otto],
          )
        ).rows[0].bytes,
      );
      const now = new Date();
      const measured = (
        await measure(q, otto, new Date(now.getTime() - 60_000), now)
      ).find((m) => m.resource === "brain");
      return { seen, own, live: measured?.live ?? 0 };
    },
  );
  check(
    "a record shared in is not on the reader's meter",
    ownBrain.seen > 0 && ownBrain.own > 0 && ownBrain.live === ownBrain.own,
    `${ownBrain.seen} shared in view; own ${ownBrain.own} bytes, metered ${ownBrain.live}`,
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
  check(
    "a person's name is one across orgs",
    youOn(await page(ottoNow)) === "Otto L. Loaf",
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
  const seen = [await page(ottoNow), await page(ottoObs)].map(youOn);
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
      acmeAfter.includes("1 past member, kept"),
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
      type: "note",
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
  const deleted = await fetch(`${stack.url}/auth/delete-org`, {
    method: "POST",
    headers: { cookie: lateCookie },
    body: new URLSearchParams({ name: "Late" }),
    redirect: "manual",
  });
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
      (await page(lateCookie)).includes(SIGNED_OUT) &&
      (await page(mateCookie)).includes(SIGNED_OUT),
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
  check("unknown session", stale.includes(SIGNED_OUT), "sign-in page");
  // Every suite runs, whatever failed before it. One that prints nothing
  // for a minute is stalled: the run fails with the suite's name and what
  // the app and the relay last wrote, and the stack is stopped as after
  // any other failure, so a hang is a failure with a reason.
  const suite = async (name, run) => {
    // What the machine has left as each suite begins, since a runner that
    // runs out of memory dies with no word of its own.
    console.log(
      `smoke: ${name}, ${(os.freemem() / 2 ** 30).toFixed(1)} of ${(os.totalmem() / 2 ** 30).toFixed(1)} GB free, load ${os.loadavg()[0].toFixed(1)}`,
    );
    let quiet = 0;
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (...args) => ((quiet = 0), write(...args));
    let watch;
    const stalled = new Promise((_, reject) => {
      watch = setInterval(() => {
        if (++quiet < 60) return;
        reject(
          new Error(
            `smoke: stalled in ${name} for a minute; app ${stack.app.up() ? "up" : "down"}: ${stack.app.said().slice(-600)}\nrelay ${stack.sync.up() ? "up" : "down"}: ${stack.sync.said().slice(-600)}`,
          ),
        );
      }, 1000);
    });
    try {
      return await Promise.race([run(), stalled]);
    } finally {
      clearInterval(watch);
      process.stdout.write = write;
    }
  };
  failed =
    !(await suite("connections", () => smokeConnections(stack, signIn))) ||
    failed;
  failed = !(await suite("db", () => smokeDb(stack))) || failed;
  failed = !(await suite("brain", () => smokeBrain(stack))) || failed;
  failed = !(await suite("mcp", () => smokeMcp(stack, signIn))) || failed;
  failed = !(await suite("sync", () => smokeSync(stack, signIn))) || failed;
} catch (err) {
  console.error(err);
  failed = true;
} finally {
  // The pool goes before the database does, so a crash above is the error
  // that is shown, not the shutdown's; a pool still waiting on a query
  // that never answers is given ten seconds and left behind.
  await Promise.race([globalThis.__pool?.end(), sleep(10_000)]);
  await stack.stop();
  await fs.rm(scratch, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
