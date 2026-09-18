import type { Computer } from "@maslow/db/computers";
import { createHmac, timingSafeEqual } from "node:crypto";

import { deployment } from "./deployment.ts";

// The one model the agent runs on, whatever name a call asks for, and
// how much it thinks before it answers: the least it offers.
export const MODEL = "z-ai/glm-5.3-flash:nitro";
export const REASONING = { effort: "none" };

// The address a machine's agent sends its model calls to: this deployment's
// gateway where a machine can dial it, else the machine's own door, which
// the laptop's stack dials in to and answers through.
const RELAYED = "http://127.0.0.1:8080/maslow/model";
export function modelUrl(): string {
  const d = deployment.computers;
  return d.kind === "fly" && d.model ? d.model : RELAYED;
}

// What a machine carries to the gateway in place of a key: its org, its
// computer's id and a mark signed with the secret only our server and
// that machine hold. Worth exactly that person's week on the one model,
// and nothing anywhere else.
export const modelToken = (c: Pick<Computer, "orgId" | "id" | "secret">) =>
  `${c.orgId}.${c.id}.${createHmac("sha256", c.secret).update("model").digest("hex")}`;

export function modelTokenOpens(
  c: Pick<Computer, "orgId" | "id" | "secret">,
  token: string,
): boolean {
  const want = Buffer.from(modelToken(c));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}
