// Applies migrations during a deploy. On Vercel the owner URL is required;
// anywhere else this is a no-op, because `pnpm dev` migrates on its own.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "../packages/db/src/migrate.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = process.env.DATABASE_OWNER_URL;

if (!url) {
  if (process.env.VERCEL) {
    throw new Error(
      "DATABASE_OWNER_URL is not set for this deployment. Production: set it in Vercel. " +
        "Preview: the preview-db workflow sets it; check its run for this pull request.",
    );
  }
  console.log("migrate: not a deploy, skipping");
  process.exit(0);
}

const applied = await migrate(
  url,
  path.join(root, "packages", "db", "migrations"),
);
console.log(
  applied.length ? `migrated ${applied.join(", ")}` : "migrations up to date",
);
