// Fetches the dev-secrets key from Vercel with your own login and writes it
// to .env.keys. Once per checkout, humans only; agents get the key from their
// environment's secret store.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pulled = path.join(root, ".local", "env-pull");
fs.mkdirSync(path.dirname(pulled), { recursive: true });

execFileSync(
  "vercel",
  [
    "env",
    "pull",
    pulled,
    "--environment",
    "development",
    "--yes",
    "--scope",
    "maslowtech",
  ],
  {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      VERCEL_PROJECT_ID: "prj_rAZ2iUe98KkFuLsvFc7uwqTh8ko0",
      VERCEL_ORG_ID: "team_7NQXOFvUYkNy7L2ztTSnohQ8",
    },
  },
);
const key = fs
  .readFileSync(pulled, "utf8")
  .match(/^DOTENV_PRIVATE_KEY_DEVELOPMENT="?([^"\n]+)"?/m)?.[1];
fs.rmSync(pulled, { force: true });
if (!key) {
  throw new Error(
    "DOTENV_PRIVATE_KEY_DEVELOPMENT is not on Vercel's development target, or you are not on the maslowtech team. Run `vercel login` first.",
  );
}
fs.writeFileSync(
  path.join(root, ".env.keys"),
  `DOTENV_PRIVATE_KEY_DEVELOPMENT=${key}\n`,
  { mode: 0o600 },
);
console.log("wrote .env.keys — pnpm dev now uses real vendors");
