import { createHash, createHmac } from "node:crypto";

// A signed request to any S3-compatible store: AWS, MinIO, R2. Signature
// version 4, nothing else.
export type S3 = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
};

const sha256 = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) =>
  createHmac("sha256", key).update(data).digest();

const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

// The object's path, each segment encoded as SigV4 wants it.
const objectUrl = (cfg: S3, key: string) =>
  new URL(
    `${cfg.endpoint}/${[cfg.bucket, ...key.split("/")].map(encode).join("/")}`,
  );

// Keys as a listing gives them back, entities undone.
export const unescapeXml = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

function stamp() {
  const date = new Date().toISOString().replace(/[-:]|\.\d{3}/g, "");
  return { date, day: date.slice(0, 8) };
}

function signingKey(cfg: S3, day: string) {
  return hmac(
    hmac(hmac(hmac(`AWS4${cfg.secretKey}`, day), cfg.region), "s3"),
    "aws4_request",
  );
}

function canonicalQuery(query: Record<string, string>) {
  return Object.keys(query)
    .sort()
    .map((k) => `${encode(k)}=${encode(query[k]!)}`)
    .join("&");
}

export async function s3(
  cfg: S3,
  method: "PUT" | "GET" | "DELETE" | "HEAD" | "POST",
  key: string,
  body?: Uint8Array,
  contentType?: string,
  query: Record<string, string> = {},
): Promise<Response> {
  const url = objectUrl(cfg, key);
  url.search = canonicalQuery(query);
  const { date, day } = stamp();
  const payloadHash = sha256(body ?? "");

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": date,
  };
  if (contentType) headers["content-type"] = contentType;
  const signed = Object.keys(headers).sort();
  const canonical = [
    method,
    url.pathname,
    url.search.slice(1),
    ...signed.map((h) => `${h}:${headers[h]}`),
    "",
    signed.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonical)].join(
    "\n",
  );
  const signature = createHmac("sha256", signingKey(cfg, day))
    .update(toSign)
    .digest("hex");
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, ` +
    `SignedHeaders=${signed.join(";")}, Signature=${signature}`;

  return fetch(url, { method, headers, body: body && Buffer.from(body) });
}

// Deletes an object. Already gone is fine; any other refusal is an error.
export async function remove(cfg: S3, key: string): Promise<void> {
  const r = await s3(cfg, "DELETE", key);
  if (!r.ok && r.status !== 404)
    throw new Error(
      `storage delete → ${r.status}: ${(await r.text()).slice(0, 200)}`,
    );
}
