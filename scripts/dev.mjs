import { startFakeFly } from "./fake-fly.mjs";
import { devSecrets, freePort, startStack } from "./stack.mjs";

// Without a Fly token, computers run against a fake Machines API in this
// process: they cost nothing and behave as Fly does.
const secrets = devSecrets();
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
        FLY_REPORT_URL: `http://127.0.0.1:${webPort}/computer/report`,
      }
    : {},
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
};
for (const [name, vendor] of Object.entries(stack.vendors)) {
  console.log(`${name.padEnd(9)} ${vendor ? `real (${vendor})` : faked[name]}`);
}
console.log(
  fake ? "computers faked in this process" : "computers real, on Fly",
);
console.log(`web       http://localhost:${stack.webPort}`);

const shutdown = () =>
  stack.stop().then(() => {
    fake?.close();
    process.exit(0);
  });
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
stack.web.on("exit", shutdown);
