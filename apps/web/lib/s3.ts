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

export async function s3(
  cfg: S3,
  method: "PUT" | "GET" | "DELETE" | "HEAD",
  key: string,
  body?: Uint8Array,
  contentType?: string,
): Promise<Response> {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${key}`);
  const now = new Date();
  const date = now.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const day = date.slice(0, 8);
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
    "",
    ...signed.map((h) => `${h}:${headers[h]}`),
    "",
    signed.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${cfg.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonical)].join(
    "\n",
  );
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${cfg.secretKey}`, day), cfg.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(toSign)
    .digest("hex");
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, ` +
    `SignedHeaders=${signed.join(";")}, Signature=${signature}`;

  return fetch(url, { method, headers, body: body && Buffer.from(body) });
}
