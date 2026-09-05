import { createHash } from "node:crypto";
import os from "node:os";

import { startFakeFly } from "./fake-fly.mjs";
import { devSecrets, freePort, root, startStack } from "./stack.mjs";

// Development runs the real thing: the dev secrets hold the preview Fly
// app and the bucket, and everything this checkout makes there is named
// for it and purged by the nightly reap. Without the secrets, computers
// run against a fake Machines API in this process: they cost nothing and
// behave as Fly does.
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
const fake = effective.FLY_API_TOKEN ? null : await startFakeFly();
const stack = await startStack({
  webPort,
  env: fake
    ? {
        FLY_API_TOKEN: "fake",
        FLY_COMPUTERS_APP: "fake",
        FLY_API_HOST: fake.url,
        FLY_MACHINES_HOST: fake.url,
        LINK_SECRET: "fake-link",
        FLY_REPORT_URL: `http://127.0.0.1:${webPort}/computer/report`,
      }
    : {
        FLY_NAME_PREFIX: `dev-${checkout}-`,
        STORAGE_PREFIX: `dev/${checkout}/`,
        FLY_REPORT_URL: `http://127.0.0.1:${webPort}/computer/report`,
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
  storage: `faked: uploads go to ${process.env.UPLOADS_DIR ?? ".local/uploads"}`,
  connections: "faked: three pretend apps connect with a click",
};
for (const [name, vendor] of Object.entries(stack.vendors)) {
  console.log(`${name.padEnd(9)} ${vendor ? `real (${vendor})` : faked[name]}`);
}
console.log(
  fake
    ? "computers faked in this process"
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
