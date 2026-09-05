// The database gate without Next or vendors, on a fresh cluster per run.
import fs from "node:fs/promises";
import path from "node:path";

import { seedBrain } from "../packages/brain/src/seed.ts";
import { migrate } from "../packages/db/src/migrate.ts";
import { ensureAppRole, startPostgres } from "../packages/db/src/postgres.ts";
import { orgs, seed } from "../packages/db/src/seed.ts";
import { smokeBrain } from "./smoke-brain.mjs";
import { smokeDb } from "./smoke-db.mjs";
import { freePort, root } from "./stack.mjs";

await fs.mkdir(path.join(root, ".local"), { recursive: true });
const scratch = await fs.mkdtemp(path.join(root, ".local", "check-db-"));
const pgPort = await freePort();
let cluster;
let interrupted = false;
const interrupt = () => {
  interrupted = true;
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  cluster = await startPostgres(path.join(scratch, "pg"), pgPort, {
    temporary: true,
  });
  await ensureAppRole(cluster.url);
  await migrate(cluster.url, path.join(root, "packages/db/migrations"));
  await seed(cluster.url);
  await seedBrain(cluster.url, orgs);
  const scoped = !interrupted && (await smokeDb({ pgPort }));
  const brain = !interrupted && (await smokeBrain({ pgPort }));
  process.exitCode = scoped && brain ? 0 : 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  await cluster?.stop();
  await fs.rm(scratch, { recursive: true, force: true });
  if (interrupted) process.exitCode = 130;
}
