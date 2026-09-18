import { asOrg } from "@maslow/db";
import {
  createSession,
  deleteSession,
  fullName,
  known,
  membershipsByEmail,
  signIn,
  switchTo,
  type Principal,
} from "@maslow/db/auth";
import { orgs } from "@maslow/db/seed";
import { allow, clear } from "@maslow/db/throttle";
import { NextResponse } from "next/server";

import { deployment } from "@/lib/deployment";
import { send } from "@/lib/mail";
import { principal } from "@/lib/session";
import { createCode, redeemCode, WorkOSError } from "@/lib/workos";

// The phone's way in: the same code sign-in the lock screen makes, answered
// as JSON, and the session handed back as a token the phone keeps. The
// phone is the person, so the session is a browser's kind: what it does is
// done in their name, and it opens the site's doors and never the brain's
// MCP.

// What the lock screen's throttles allow, per ten minutes.
const PER_EMAIL = 3;
const PER_ADDRESS = 20;
const GUESSES = 5;
const WINDOW = 10 * 60;
const MAX_EMAIL = 254;

const said = (what: string, status = 400) =>
  NextResponse.json({ said: what }, { status });

// The token, who it opens as, and the orgs the person may be in, the one
// the token opens marked.
async function opened(p: Principal, email: string) {
  const token = await createSession(p);
  if (!token) return said("That membership was removed.", 403);
  const [memberships, me] = await Promise.all([
    membershipsByEmail(email),
    asOrg(
      p.orgId,
      async (q) =>
        (
          await q.query<{ firstName: string; lastName: string | null }>(
            'select first_name as "firstName", last_name as "lastName" from users where id = $1',
            [p.userId],
          )
        ).rows[0],
    ),
  ]);
  return NextResponse.json({
    token,
    person: me ? fullName(me) : email,
    email,
    orgs: memberships.map((m) => ({
      userId: m.userId,
      name: m.orgName,
      current: m.userId === p.userId,
    })),
  });
}

async function sendCode(email: string, from: string | undefined) {
  if (deployment.identity.kind !== "workos")
    return said("Sign-in by code is off here.", 404);
  // The network address is counted first, so probing for accounts is
  // bounded as tightly as asking for codes is.
  if (from && !(await allow(`from:${from}`, PER_ADDRESS, WINDOW)))
    return said("Too many codes asked for. Try again in a few minutes.", 429);
  if (!(await known(email)))
    return said("Maslow is invite-only for now. Ask someone in for an invite.");
  if (!(await allow(`email:${email}`, PER_EMAIL, WINDOW)))
    return said("Too many codes asked for. Try again in a few minutes.", 429);
  let code: string;
  try {
    code = await createCode(email);
  } catch (err) {
    if (err instanceof WorkOSError && [400, 422].includes(err.status))
      return said("That address was refused. Check it and try again.");
    throw err;
  }
  await clear(`code:${email}`);
  if (deployment.mail.kind === "none")
    console.log(`sign-in code for ${email}: ${code}`);
  else
    await send({
      to: email,
      subject: `${code} is your sign-in code`,
      text: `${code} is your sign-in code. It expires in ten minutes.`,
    });
  return NextResponse.json({ sent: true });
}

async function redeem(email: string, code: string) {
  if (deployment.identity.kind !== "workos")
    return said("Sign-in by code is off here.", 404);
  const key = `code:${email}`;
  if (!(await allow(key, GUESSES, WINDOW)))
    return said("Too many wrong codes. Ask for a new one.", 429);
  try {
    const identity = await redeemCode(email, code.trim());
    await clear(key);
    return opened(await signIn(identity), email);
  } catch (err) {
    if (err instanceof WorkOSError && /one_time_code/.test(err.code))
      return said("That code is not right.");
    throw err;
  }
}

// A seeded person, outside production only, as the lock screen offers.
async function seeded(userId: string) {
  if (!deployment.seededSignIn) return said("Not here.", 404);
  const org = orgs.find((o) => o.users.some((u) => u.id === userId));
  const u = org?.users.find((u) => u.id === userId);
  if (!org || !u) return said("No such seeded person.");
  const live = await asOrg(
    org.id,
    async (q) =>
      (
        await q.query<{ role: "owner" | "member"; email: string }>(
          "select role, email from users where id = $1",
          [userId],
        )
      ).rows[0],
  );
  if (!live) return said("That person was removed from the org.");
  return opened(
    { personId: u.personId, orgId: org.id, userId, role: live.role },
    live.email,
  );
}

// Another of the person's orgs: a new session there, the old one ended.
async function switched(userId: string, token: string) {
  const p = await principal();
  if (!p) return said("Sign in first.", 401);
  const there = await switchTo(p, userId);
  if (!there) return said("You are not in that org.");
  const response = await opened(there, p.email);
  if (response.ok) await deleteSession(token);
  return response;
}

// One door, four asks: an email gets a code; an email and a code get a
// session; a seeded person gets one outside production; a membership,
// with a session, moves it to another org.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
    code?: unknown;
    user?: unknown;
    membership?: unknown;
  } | null;
  if (!body) return said("Say what you want.");
  if (typeof body.user === "string") return seeded(body.user);
  if (typeof body.membership === "string") {
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return said("Sign in first.", 401);
    return switched(body.membership, token);
  }
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email.includes("@") || email.length > MAX_EMAIL)
    return said("An email address is required.");
  if (typeof body.code === "string") return redeem(email, body.code);
  return sendCode(
    email,
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  );
}

// The seeded people a phone may sign in as, outside production; none in it.
export async function GET() {
  return NextResponse.json({
    seeded: deployment.seededSignIn
      ? orgs.flatMap((o) =>
          o.users.map((u) => ({
            userId: u.id,
            name: fullName(u),
            org: o.name,
          })),
        )
      : [],
  });
}

// Signing out: the session the phone holds ends, and the token is dead.
export async function DELETE(request: Request) {
  await deleteSession(
    request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1],
  );
  return new Response(null, { status: 204 });
}
