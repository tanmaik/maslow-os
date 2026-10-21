import { asPerson } from "@maslow/db";
import { seedTrial } from "@maslow/brain/seed";
import { foundTrial } from "@maslow/db/auth";
import { allow } from "@maslow/db/throttle";
import { trialCount } from "@maslow/db/trials";
import { randomBytes } from "node:crypto";

import { deployment } from "@/lib/deployment";
import { origin } from "@/lib/origin";
import { appRecords } from "@/lib/trial-computer";
import { abandoned, noticed, signedIn } from "@/lib/session";

// Trials one network address may start per ten minutes, and how many may
// stand at once before the next is turned away.
const PER_ADDRESS = 5;
const WINDOW = 10 * 60;
const MOST = 300;

// "Try it": a guest of their own, an org of one made a trial, the
// fictional seed's records in it, and a session, then home. Only in a
// trial deployment.
export async function POST(request: Request) {
  if (!deployment.trial) return new Response(null, { status: 404 });
  const home = origin(request);
  const from =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (!(await allow(`try:${from}`, PER_ADDRESS, WINDOW)))
    return abandoned(noticed(home, "try=slow"));
  if ((await trialCount()) >= MOST) return abandoned(noticed(home, "try=full"));
  const email = `guest-${randomBytes(12).toString("hex")}@trial.invalid`;
  const p = await foundTrial(email);
  await asPerson(p, (q) => seedTrial(q, appRecords()));
  // One line per trial, counted from the logs; no address, no email.
  console.log(`trial: started org=${p.orgId.slice(0, 8)}`);
  return signedIn(p, home, request);
}
