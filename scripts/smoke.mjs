// Boots the stack on a fresh database of its own, signs in as a person from
// each org through the development sign-in, checks that each sees only their
// own org, and that an invited email is admitted into the inviting org. This
// is the merge gate.
import path from "node:path";

import { orgs } from "../packages/db/src/seed.ts";
import { startFakeFly } from "./fake-fly.mjs";
import { smokeBrain } from "./smoke-brain.mjs";
import { root, startStack } from "./stack.mjs";

// The smoke carries no credentials: a checkout's pulled config must not reach
// it. Next leaves a variable alone once it is set, even to nothing.
const noCredentials = Object.fromEntries(
  [
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "RESEND_API_KEY",
    "MAIL_FROM",
    "STORAGE_ENDPOINT",
    "STORAGE_REGION",
    "STORAGE_BUCKET",
    "STORAGE_ACCESS_KEY",
    "STORAGE_SECRET_KEY",
  ].map((k) => [k, ""]),
);

// Fly is faked: computers are built and run against a server in this process.
const fake = await startFakeFly();
const { freePort } = await import("./stack.mjs");
const webPort = await freePort();
const stack = await startStack({
  webPort,
  stdio: "ignore",
  dataDir: path.join(root, ".local", "smoke"),
  distDir: ".next-smoke",
  fresh: true,
  secrets: false,
  env: {
    ...noCredentials,
    FLY_API_TOKEN: "fake",
    FLY_COMPUTERS_APP: "fake",
    FLY_API_HOST: fake.url,
    FLY_MACHINES_HOST: fake.url,
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
  check("invite", invited.status === 303, `answered ${invited.status}`);
  const settingsHtml = async (cookie) =>
    (await fetch(`${stack.url}/settings`, { headers: { cookie } })).text();
  check(
    "invitation pending",
    (await settingsHtml(wile)).includes("hire@acme-rockets.test"),
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
  const { signIn: admit } = await import("../packages/db/src/auth.ts");
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
        (await settingsHtml(wile))
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
  const { allow } = await import("../packages/db/src/throttle.ts");
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
  const settingsPage = async (cookie) =>
    (
      await (
        await fetch(`${stack.url}/settings`, { headers: { cookie } })
      ).text()
    ).replaceAll("<!-- -->", "");
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
  const { asOrg, asPerson } = await import("../packages/db/src/index.ts");
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
  const { signIn: readmit, membershipsOf: orgsOf } =
    await import("../packages/db/src/auth.ts");
  const pimBack = await readmit({
    email: pimSeed.email,
    firstName: "Pim",
    lastName: null,
  });
  check(
    "a leaver invited back is the same member",
    reinvite.headers.get("location")?.endsWith("invite=sent") &&
      pimBack.orgId === bakery.id &&
      pimBack.userId === pimId &&
      (await orgsOf(pimBack)).some((m) => m.orgId === bakery.id) &&
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
    "a purged member's filesystem is gone from Fly",
    fake.volumes.size === volumesBeforePurge - 1,
    `${volumesBeforePurge} → ${fake.volumes.size} volumes`,
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
    (await settingsHtml(wile)).includes("beep@acme-rockets.test"),
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
  const { signIn: admitLate } = await import("../packages/db/src/auth.ts");
  const late = await admitLate({
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
      /<button[^>]*value="30000000-0000-4000-8000-000000000002"[^>]*>Chartreuse Observatory</.test(
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
      !/marge@|pim@/.test(await settingsHtml(ottoObs)),
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
  const { membershipsOf } = await import("../packages/db/src/auth.ts");
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

  // Computers: in an org that may have them, signing in makes the
  // filesystem, and the first look at the computer makes the machine and
  // wakes it, so the page is the disk; an org that may not is told so.
  const computerPage = async (cookie, path = "/") =>
    (
      await fetch(`${stack.url}/computer?path=${encodeURIComponent(path)}`, {
        headers: { cookie },
      })
    ).text();
  check(
    "computers are gated by org",
    (await computerPage(wile)).includes("not available for this org"),
    "Acme told no",
  );
  check(
    "signing in makes the filesystem, not compute",
    fake.volumes.size >= 1 && fake.machines.size === 0,
    `${fake.volumes.size} volumes, ${fake.machines.size} machines`,
  );
  const volumesAtSignIn = fake.volumes.size;
  check(
    "a preview's volumes carry its pull request in their names",
    [...fake.volumes.values()].every((v) => v.name.startsWith("pr0_c_")),
    [...fake.volumes.values()].map((v) => v.name).join(", "),
  );
  const ottoComputer = await computerPage(ottoNow);
  const opened = [
    fake.machines.size === 1,
    fake.volumes.size === volumesAtSignIn,
    [...fake.machines.values()][0]?.state === "started",
    /data-state="started"/.test(ottoComputer),
    ottoComputer.includes("This folder is empty"),
    / of [0-9.]+ [KMG]B used/.test(ottoComputer),
  ];
  check(
    "opening the computer makes the machine, wakes it and shows the disk",
    opened.every(Boolean),
    `${fake.machines.size} machine, ${fake.volumes.size} volume, ${opened.map(Number).join("")}`,
  );
  await computerPage(ottoNow);
  check(
    "a second look makes nothing",
    fake.machines.size === 1 && fake.volumes.size === volumesAtSignIn,
    `${fake.machines.size} machine`,
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
    ["created", "volume", "stopped", "reported"].every((k) =>
      events.includes(k),
    ),
    events.join(","),
  );
  // Files go to the store in parts, then land on the disk. Here the store
  // is a directory behind our own PUT and the disk is a daemon process.
  // Three parts make one file, listed from the disk with its size, fetched
  // back whole from the machine, unseen on anyone else's disk, and deleted.
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
  const listed = await computerPage(ottoNow);
  const staged = await asOrg(
    "00000000-0000-4000-8000-000000000002",
    async (q) => {
      await q.query("select set_config('app.meter', 'sweep', true)");
      return (
        await q.query(
          "select state, deleted_at is not null as gone from files where id = $1",
          [begun.id],
        )
      ).rows[0];
    },
  );
  check(
    "a file arrives in parts, lands on the disk and leaves the store",
    closed.size === whole.length &&
      listed.includes('data-file="/notes.txt"') &&
      staged?.gone === true,
    `${closed.size} bytes, staged row ${JSON.stringify(staged)}`,
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
    taken.status === 413 && (await taken.text()).includes("already there"),
    `answered ${taken.status}`,
  );
  // The filesystem grows for bytes that arrived, never for a declared
  // size, and stops at Fly's limit.
  const { sizeFor } = await import("../apps/web/lib/computer.ts");
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
    notGrown.disk_gb === 10 &&
      sizeFor(1e9, 10) === 10 &&
      sizeFor(9e9, 10) === 20 &&
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
  const rootView = await computerPage(ottoNow);
  const photosView = await computerPage(ottoNow, "/photos");
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
    "a folder and a file are deleted",
    folderGone.headers.get("location")?.includes("deleted=yes") &&
      fileGone.headers.get("location")?.includes("deleted=yes") &&
      !rootFinal.includes('data-folder="/photos"') &&
      !rootFinal.includes('data-file="/dusk.txt"'),
    "photos and dusk.txt gone",
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
    "the meter prices compute, disk and brain per person",
    swept.appended > 0 &&
      by.compute?.unit === "second" &&
      by.compute.q > 0 &&
      by.disk?.unit === "gb_second" &&
      by.disk.q > 0 &&
      (by.bucket === undefined || by.bucket.unit === "byte_second") &&
      margeBrain?.unit === "byte_second" &&
      margeBrain.q > 0 &&
      [...ottoMetered, ...margeMetered].every((r) => r.n === 2 && r.cost >= 0),
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
  check(
    "the live meter ticks with a rate from the last minute",
    liveMeter.month > 0 &&
      liveMeter.ratePerHour > 0 &&
      liveMeter.active.some(
        (a) => a.resource === "disk" && a.ratePerHour > 0,
      ) &&
      (await fetch(`${stack.url}/meter/live`)).status === 401,
    `$${liveMeter.month?.toFixed(8)} this month, $${liveMeter.ratePerHour?.toFixed(8)}/h, ${liveMeter.active?.map((a) => a.what).join(", ")}`,
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
  // A machine gone behind our back is forgotten by the row, and the next
  // look makes a new one on the same filesystem.
  const machinesBeforeGone = fake.machines.size;
  const [goneId, goneMachine] = [...fake.machines.entries()][0];
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
  // Six looks at once for one membership make one computer.
  await Promise.all(Array.from({ length: 6 }, () => computerPage(margeOwner)));
  check(
    "racing looks make one computer",
    fake.machines.size === 2 &&
      fake.volumes.size === volumesAtSignIn &&
      /data-state="started"/.test(await computerPage(margeOwner)),
    `${fake.machines.size} machines, ${fake.volumes.size} volumes`,
  );
  check(
    "a person's name is one across orgs",
    (await page(ottoNow)).includes("Sign out, Otto L. Loaf"),
    "renamed in the observatory, seen in the bakery",
  );
  // Renames racing from both orgs end with every org agreeing on one name.
  await Promise.all(
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
  check(
    "racing renames leave every org agreeing",
    seen[0] !== undefined && seen[0] === seen[1],
    seen.join(" vs "),
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
  const { createSession } = await import("../packages/db/src/auth.ts");
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
  const { asEmail } = await import("../packages/db/src/index.ts");
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

  const signedOutSettings = await fetch(`${stack.url}/settings`, {
    redirect: "manual",
  });
  check(
    "settings need a session",
    signedOutSettings.status === 307 || signedOutSettings.status === 303,
    `answered ${signedOutSettings.status}`,
  );

  await globalThis.__pool?.end();

  const stale = await page(
    "session=00000000-0000-4000-8000-000000000001.00000000-0000-4000-8000-000000000009",
  );
  check(
    "unknown session",
    stale.includes("Pick a person from the pill"),
    "sign-in page",
  );
  failed ||= !(await smokeBrain(stack));
} finally {
  await stack.stop();
  fake.close();
}
process.exit(failed ? 1 : 0);
