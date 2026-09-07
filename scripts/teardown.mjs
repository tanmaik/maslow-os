// Tears an environment's costly things down: every object under a prefix
// of the bucket, or the local stack's data. Nothing here asks twice; the
// production prefix needs --production said out loud.
//
//   node scripts/teardown.mjs bucket preview/     STORAGE_* (preview/ prefixes only)
//   node scripts/teardown.mjs bucket orgs/ --production
//   node scripts/teardown.mjs local
import fs from "node:fs/promises";
import path from "node:path";

import { emptyPrefix } from "./purge.mjs";
import { root } from "./stack.mjs";

const [what, arg, flag] = process.argv.slice(2);
const need = (k) =>
  process.env[k] ??
  (() => {
    throw new Error(`${k} is not set`);
  })();

async function bucket() {
  const prefix = arg;
  if (!prefix) throw new Error("bucket needs a prefix");
  // Only previews are fair game by default; anything else is production.
  if (!prefix.startsWith("preview/") && flag !== "--production")
    throw new Error(
      `${prefix} is not a preview prefix: say --production to empty it`,
    );
  const removed = await emptyPrefix(
    {
      endpoint: need("STORAGE_ENDPOINT"),
      region: need("STORAGE_REGION"),
      bucket: need("STORAGE_BUCKET"),
      accessKey: need("STORAGE_ACCESS_KEY"),
      secretKey: need("STORAGE_SECRET_KEY"),
    },
    prefix,
  );
  console.log(`bucket: ${removed} objects under ${prefix} removed`);
}

async function local() {
  for (const dir of [".local", path.join("apps", "web", ".local")])
    await fs.rm(path.join(root, dir), { recursive: true, force: true });
  console.log("local: database and uploads removed");
}

const run = { bucket, local }[what];
if (!run) {
  console.error("usage: teardown bucket <prefix> [--production] | local");
  process.exit(2);
}
await run();
