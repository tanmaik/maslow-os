// Applies migrations during a deploy: in Vercel's build, or as the app's
// container starts, before it serves anyone. On Vercel and in any
// production the owner URL is required; anywhere else this is a no-op,
// because `pnpm dev` migrates on its own.
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "../packages/db/src/migrate.ts";
import { ensureAppRole } from "../packages/db/src/postgres.ts";
import { seed } from "../packages/db/src/seed.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const url = process.env.DATABASE_OWNER_URL;

// Production as the app itself reads it: Vercel's own, or any box run as
// production.
const production = process.env.VERCEL
  ? process.env.VERCEL_ENV === "production"
  : process.env.NODE_ENV === "production";

if (!url) {
  if (process.env.VERCEL || production) {
    throw new Error(
      "DATABASE_OWNER_URL is not set for this deployment. Production: set it in Vercel, or where the container runs. " +
        "Preview: the preview-db workflow sets it; check its run for this pull request.",
    );
  }
  console.log("migrate: not a deploy, skipping");
  process.exit(0);
}

// Outside Vercel nobody makes the app's role by hand, so it is made here,
// before the migrations that grant to it, with the password its address
// carries.
const app = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (!process.env.VERCEL && app?.username === "app") {
  await ensureAppRole(url, decodeURIComponent(app.password));
}

const applied = await migrate(
  url,
  path.join(root, "packages", "db", "migrations"),
);
console.log(
  applied.length ? `migrated ${applied.join(", ")}` : "migrations up to date",
);
// A preview is seeded so its people exist to be signed in as. Production never is.
if (!production) {
  await seed(url);
  console.log("seeded");
}
