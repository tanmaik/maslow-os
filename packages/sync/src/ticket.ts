import { createHmac, timingSafeEqual } from "node:crypto";

// What a ticket to a record's live document says: which deployment issued
// it and is called back for the record, who is holding it, which record it
// opens, at what level, until when.
export type Claims = {
  origin: string;
  org: string;
  user: string;
  record: string;
  level: "view" | "edit";
  exp: number;
};

// The name a record's live document goes by at the relay: the deployment
// it came from, the org, the record, so one relay serving many
// deployments never hands one's document to another.
export const nameOf = (c: Pick<Claims, "origin" | "org" | "record">) =>
  `${Buffer.from(c.origin).toString("base64url")}.${c.org}.${c.record}`;

const sign = (secret: string, said: string) =>
  createHmac("sha256", secret).update(said).digest("base64url");

// A ticket: the claims, then a signature over them, both base64url.
export function mint(
  secret: string,
  claims: Omit<Claims, "exp">,
  seconds: number,
): string {
  const said = Buffer.from(
    JSON.stringify({
      ...claims,
      exp: Math.floor(Date.now() / 1000) + seconds,
    }),
  ).toString("base64url");
  return `${said}.${sign(secret, said)}`;
}

// The claims a ticket carries, or null when it is not ours or has run out.
export function verify(secret: string, ticket: string): Claims | null {
  const [said, sig] = ticket.split(".");
  if (!said || !sig) return null;
  const want = sign(secret, said);
  if (
    want.length !== sig.length ||
    !timingSafeEqual(Buffer.from(want), Buffer.from(sig))
  )
    return null;
  try {
    const c = JSON.parse(Buffer.from(said, "base64url").toString()) as Claims;
    if (typeof c.exp !== "number" || c.exp < Date.now() / 1000) return null;
    if (c.level !== "view" && c.level !== "edit") return null;
    return c;
  } catch {
    return null;
  }
}
