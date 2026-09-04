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
  check("signed out", out.includes("Development sign-in"), "sign-in page");

  // The first org signs in again at the end: its second visit reuses a pooled
  // connection where an old org setting exists as '' rather than missing.
  for (const org of [...orgs, orgs[0]]) {
    const html = await page(await signIn(org.users[0].id));
    const got = html.match(/(\d+) members/);
    check(
      `${org.users[0].name} (${org.name})`,
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
    (await page(marge)).includes("Development sign-in"),
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
  check(
    "invitation pending",
    (await page(wile)).includes("hire@acme-rockets.test"),
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
    name: "New Hire",
  });
  const after = await page(wile);
  check(
    "invited person admitted",
    hire.orgId === orgs[0].id &&
      /3 members/.test(after) &&
      !after.includes("Invited, not yet signed in"),
    after.match(/\d+ members/)?.[0] ?? "no match",
  );
  const stranger = await admit({ email: "solo@example.test", name: "Solo" });
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
    twice.headers.get("location")?.endsWith("/?invite=member") === true,
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
    again.headers.get("location")?.endsWith("/?invite=pending") === true,
    again.headers.get("location") ?? "no redirect",
  );

  // A real session id under the wrong org is nobody.
  const [, wileSession] = wile.replace("session=", "").split(".");
  check(
    "session under another org",
    (await page(`session=${orgs[1].id}.${wileSession}`)).includes(
      "Development sign-in",
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
    [1, 2, 3].map(() => admit({ email: "race@example.test", name: "Race" })),
  );
  check(
    "racing first sign-ins share one row",
    new Set(raced.map((r) => r.userId)).size === 1,
    `${new Set(raced.map((r) => r.userId)).size} rows`,
  );
  await globalThis.__pool?.end();

  const stale = await page(
    "session=00000000-0000-4000-8000-000000000001.00000000-0000-4000-8000-000000000009",
  );
  check(
    "unknown session",
    stale.includes("Development sign-in"),
    "sign-in page",
  );
  failed ||= !(await smokeBrain(stack));
} finally {
  await stack.stop();
}
process.exit(failed ? 1 : 0);
