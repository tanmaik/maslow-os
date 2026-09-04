// Tears an environment's costly things down: every machine and volume in
// the Fly app, or every object under a prefix of the bucket, or the local
// stack's data. Nothing here asks twice; the production prefix needs
// --production said out loud.
//
//   node scripts/teardown.mjs fly                 FLY_API_TOKEN, FLY_COMPUTERS_APP
//   node scripts/teardown.mjs bucket preview/     STORAGE_* (preview/ prefixes only)
//   node scripts/teardown.mjs bucket orgs/ --production
//   node scripts/teardown.mjs local
import fs from "node:fs/promises";
import path from "node:path";

import { root } from "./stack.mjs";

const [what, arg, flag] = process.argv.slice(2);
const need = (k) =>
  process.env[k] ??
  (() => {
    throw new Error(`${k} is not set`);
  })();

async function fly() {
  const token = need("FLY_API_TOKEN");
  const app = need("FLY_COMPUTERS_APP");
  const api = process.env.FLY_API_HOST ?? "https://api.machines.dev";
  const call = async (method, p) => {
    const r = await fetch(`${api}/v1/apps/${app}${p}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`Fly ${method} ${p} → ${r.status}`);
    return r.json();
  };
  const machines = await call("GET", "/machines");
  for (const m of machines) {
    await call("DELETE", `/machines/${m.id}?force=true`);
    console.log(`fly: destroyed machine ${m.id} (${m.name})`);
  }
  const volumes = await call("GET", "/volumes");
  for (const v of volumes) {
    await call("DELETE", `/volumes/${v.id}`);
    console.log(`fly: destroyed volume ${v.id} (${v.name})`);
  }
  console.log(
    `fly: ${machines.length} machines, ${volumes.length} volumes gone from ${app}`,
  );
}

async function bucket() {
  const prefix = arg;
  if (!prefix) throw new Error("bucket needs a prefix");
  // Only previews are fair game by default; anything else is production.
  if (!prefix.startsWith("preview/") && flag !== "--production")
    throw new Error(
      `${prefix} is not a preview prefix: say --production to empty it`,
    );
  const cfg = {
    endpoint: need("STORAGE_ENDPOINT"),
    region: need("STORAGE_REGION"),
    bucket: need("STORAGE_BUCKET"),
    accessKey: need("STORAGE_ACCESS_KEY"),
    secretKey: need("STORAGE_SECRET_KEY"),
  };
  const { s3, unescapeXml } = await import("../apps/web/lib/s3.ts");
  let removed = 0;
  for (;;) {
    const r = await s3(cfg, "GET", "", undefined, undefined, {
      "list-type": "2",
      prefix,
      "max-keys": "1000",
    });
    if (!r.ok) throw new Error(`bucket list → ${r.status}`);
    const found = [...(await r.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map(
      (m) => unescapeXml(m[1]),
    );
    for (const key of found) {
      const d = await s3(cfg, "DELETE", key);
      if (!d.ok && d.status !== 404)
        throw new Error(`bucket delete → ${d.status}`);
      removed++;
    }
    if (found.length < 1000) break;
  }
  // Uploads begun and never finished under the prefix are billed too.
  let markers = {};
  for (;;) {
    const u = await s3(cfg, "GET", "", undefined, undefined, {
      uploads: "",
      prefix,
      ...markers,
    });
    if (!u.ok) throw new Error(`bucket uploads list → ${u.status}`);
    const xml = await u.text();
    for (const m of xml.matchAll(
      /<Upload>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<UploadId>([^<]+)<\/UploadId>[\s\S]*?<\/Upload>/g,
    )) {
      const a = await s3(
        cfg,
        "DELETE",
        unescapeXml(m[1]),
        undefined,
        undefined,
        {
          uploadId: m[2],
        },
      );
      if (!a.ok && a.status !== 404)
        throw new Error(`bucket abort → ${a.status}`);
      removed++;
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    markers = {
      "key-marker": unescapeXml(
        /<NextKeyMarker>([^<]*)<\/NextKeyMarker>/.exec(xml)?.[1] ?? "",
      ),
      "upload-id-marker":
        /<NextUploadIdMarker>([^<]*)<\/NextUploadIdMarker>/.exec(xml)?.[1] ??
        "",
    };
  }
  console.log(`bucket: ${removed} objects under ${prefix} removed`);
}

async function local() {
  await fs.rm(path.join(root, ".local"), { recursive: true, force: true });
  console.log("local: .local removed (database, uploads, files)");
}

const run = { fly, bucket, local }[what];
if (!run) {
  console.error("usage: teardown fly | bucket <prefix> [--production] | local");
  process.exit(2);
}
await run();
