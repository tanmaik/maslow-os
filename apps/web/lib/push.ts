import type { Notification } from "@maslow/db/notifications";
import { forgetPhone, phonesOf } from "@maslow/db/phones";
import { createPrivateKey, sign } from "node:crypto";
import { connect } from "node:http2";

import { deployment } from "./deployment.ts";

// A notification left for a person reaches their phones while the app is
// closed, through Apple's push service on a key of ours. The phone shows
// the title and the first line, wears the count of asks still waiting,
// and opens Waiting when tapped.

// A token Apple accepts for an hour; a new one is signed before that.
let minted: { jwt: string; at: number } | null = null;
const TOKEN_FOR = 50 * 60 * 1000;

const base64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

// The bearer Apple's push service takes: a JWT signed with the key,
// naming the team and the key's id.
function bearer(p: { teamId: string; keyId: string; key: string }): string {
  if (minted && Date.now() - minted.at < TOKEN_FOR) return minted.jwt;
  const head = base64url(JSON.stringify({ alg: "ES256", kid: p.keyId }));
  const claims = base64url(
    JSON.stringify({ iss: p.teamId, iat: Math.floor(Date.now() / 1000) }),
  );
  const signature = sign("sha256", Buffer.from(`${head}.${claims}`), {
    key: createPrivateKey(p.key),
    dsaEncoding: "ieee-p1363",
  });
  minted = { jwt: `${head}.${claims}.${base64url(signature)}`, at: Date.now() };
  return minted.jwt;
}

// One push to one phone. The status Apple answers with; a token Apple
// says is gone is forgotten.
function send(
  host: string,
  token: string,
  payload: string,
  p: { teamId: string; keyId: string; key: string; bundleId: string },
): Promise<number> {
  return new Promise((resolve, reject) => {
    const client = connect(`https://${host}`);
    client.on("error", reject);
    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${bearer(p)}`,
      "apns-topic": p.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    req.on("response", (headers) => resolve(Number(headers[":status"])));
    req.on("error", reject);
    req.on("close", () => client.close());
    req.end(payload);
  });
}

// Sends a notification just left for a member to every phone they carry.
// A door that left one runs this after its answer is out, so a slow or
// refused push never slows or fails the door.
export async function pushNotification(
  to: { orgId: string; userId: string },
  n: Notification,
  waiting?: number,
): Promise<void> {
  const p = deployment.push;
  if (p.kind === "none") return;
  {
    const phones = await phonesOf(to.orgId, to.userId);
    if (phones.length === 0) return;
    const payload = JSON.stringify({
      aps: {
        alert: { title: n.title, body: n.body.split("\n")[0] ?? "" },
        sound: "default",
        ...(waiting === undefined ? {} : { badge: waiting }),
        "thread-id": "waiting",
      },
      notification: n.id,
    });
    for (const phone of phones) {
      const host = phone.sandbox
        ? "api.sandbox.push.apple.com"
        : "api.push.apple.com";
      try {
        const status = await send(host, phone.token, payload, p);
        if (status === 410 || status === 400)
          await forgetPhone(to.orgId, phone.token);
      } catch (err) {
        console.error(`push to ${phone.token.slice(0, 8)}… failed`, err);
      }
    }
  }
}
