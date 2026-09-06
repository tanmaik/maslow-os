import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { startFakeFly } from "./fake-fly.mjs";
import { devSecrets, freePort, root, startStack } from "./stack.mjs";

// Development runs the real thing where the real thing can reach a laptop:
// the dev secrets hold WorkOS, the bucket, mail and the model key. The
// machine is the exception. A machine on Fly cannot call a laptop back, so
// on a laptop the machine is a process beside the app, against a fake
// Machines API in this process: the same daemon, the same
// gateway, one address. `COMPUTERS=fly pnpm dev` makes real machines in the
// preview Fly app instead, named for this checkout and purged nightly, for
// work on the machine itself; their reports and backups cannot reach
// here and say so. Real machines are otherwise exercised on the preview.
const secrets = devSecrets();
// This checkout, told apart from every other laptop and worktree.
const checkout = createHash("sha1")
  .update(`${os.hostname()}:${root}`)
  .digest("hex")
  .slice(0, 6);
const webPort = Number(process.env.PORT) || (await freePort());
// Fly as the web will see it: the environment, then the decrypted secrets.
const effective = { ...process.env, ...secrets };
if (!effective.FLY_API_TOKEN !== !effective.FLY_COMPUTERS_APP)
  throw new Error(
    "Fly is half set: FLY_API_TOKEN and FLY_COMPUTERS_APP go together, or neither.",
  );
const wantFly = process.env.COMPUTERS === "fly";
if (wantFly && !effective.FLY_API_TOKEN)
  throw new Error("COMPUTERS=fly needs the dev secrets; run `pnpm env:pull`.");
// The machines' disks live outside the checkout, in this laptop's scratch:
// Claude Code reads every CLAUDE.md and git repository above its working
// directory, and a disk inside the checkout would hand it this repo as the
// person's project. The scratch is the laptop's to purge, as the nightly
// reap purges a laptop's machines on Fly.
const fake = wantFly
  ? null
  : await startFakeFly({
      dir: path.join(os.tmpdir(), "placeholder", checkout, "computers"),
    });
const stack = await startStack({
  webPort,
  env: fake
    ? {
        FLY_API_TOKEN: "fake",
        FLY_COMPUTERS_APP: "fake",
        FLY_API_HOST: fake.url,
        FLY_MACHINES_HOST: fake.url,
        FLY_MACHINES_DOMAIN: "",
        LINK_SECRET: "fake-link",
        FLY_REPORT_URL:
          effective.FLY_REPORT_URL ??
          `http://127.0.0.1:${webPort}/computer/report`,
      }
    : {
        FLY_NAME_PREFIX: `dev-${checkout}-`,
        STORAGE_PREFIX: `dev/${checkout}/`,
        FLY_REPORT_URL:
          effective.FLY_REPORT_URL ??
          `http://127.0.0.1:${webPort}/computer/report`,
      },
});
console.log(`postgres  127.0.0.1:${stack.pgPort}`);
for (const name of stack.applied) console.log(`migrated  ${name}`);
console.log("seeded");
console.log(
  stack.secrets === null
    ? "secrets   none: no DOTENV_PRIVATE_KEY_DEVELOPMENT, every vendor is faked"
    : `secrets   ${stack.secrets} from .env.development`,
);
const faked = {
  identity: "faked: pick a seeded person from the pill",
  mail: "faked: sign-in codes print here",
  analytics: "faked: nothing is reported",
  storage: `faked: uploads go to ${process.env.UPLOADS_DIR ?? ".local/uploads"}`,
  connections: "faked: three pretend apps connect with a click",
  models: "faked: a pretend model answers Claude Code, and nothing is spent",
};
for (const [name, vendor] of Object.entries(stack.vendors)) {
  console.log(`${name.padEnd(9)} ${vendor ? `real (${vendor})` : faked[name]}`);
}
console.log(
  fake
    ? "computers on this laptop, against a fake Fly in this process (COMPUTERS=fly pnpm dev makes real ones)"
    : `computers real, on Fly as dev-${checkout}-*, purged nightly; a machine cannot reach this laptop, so its reports and backups fail here`,
);
if (!fake && effective.STORAGE_BUCKET)
  console.log(`storage   real, under dev/${checkout}/, purged nightly`);
console.log(`web       http://localhost:${stack.webPort}`);

const shutdown = () =>
  stack.stop().then(() => {
    fake?.close();
    process.exit(0);
  });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
stack.web.on("exit", shutdown);
