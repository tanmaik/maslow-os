// Boots the stack on a fresh database of its own, signs in as a person from
// each org through the development sign-in, checks that each sees only their
// own org, and that an invited email is admitted into the inviting org. This
// is the merge gate.
import path from "node:path";

import { orgs } from "../packages/db/src/seed.ts";
import { smokeBrain } from "./smoke-brain.mjs";
import { root, startStack } from "./stack.mjs";

// The smoke carries no credentials: a checkout's pulled config must not reach
// it. Next leaves a variable alone once it is set, even to nothing.
const noCredentials = Object.fromEntries(
  [
    "WORKOS_API_KEY",
    "WORKOS_CLIENT_ID",
    "AUTH_ISSUER",
    "AUTH_CLIENT_ID",
    "AUTH_CLIENT_SECRET",
    "RESEND_API_KEY",
    "MAIL_FROM",
  ].map((k) => [k, ""]),
);

const stack = await startStack({
  stdio: "ignore",
  dataDir: path.join(root, ".local", "smoke"),
  distDir: ".next-smoke",
  fresh: true,
  secrets: false,
  env: noCredentials,
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
  const noted = await fetch(`${stack.url}/brain/note`, {
    method: "POST",
    headers: { cookie: pim },
    body: new URLSearchParams({ title: "Ovens", body: "Preheat by five." }),
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
    "a purged member and their notes are gone",
    purged.headers.get("location")?.endsWith("member=purged") &&
      !(await settingsPage(margeOwner)).includes("past member") &&
      (await pimNotes()) === 0 &&
      pimSignIn.status === 400,
    `${purged.headers.get("location")?.split("?")[1]}, 0 notes, sign-in ${pimSignIn.status}`,
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
  const lateNote = await fetch(`${stack.url}/brain/note`, {
    method: "POST",
    headers: { cookie: lateCookie },
    body: new URLSearchParams({ title: "Rent", body: "Due on the first." }),
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
}
process.exit(failed ? 1 : 0);
