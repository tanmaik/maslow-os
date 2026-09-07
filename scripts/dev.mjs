import { devSecrets, freePort, startStack } from "./stack.mjs";

// Development runs the real thing where the dev secrets hold a key —
// WorkOS, the bucket, mail, Composio, Voyage — and fakes the rest, saying
// which on the pill and here.
const secrets = devSecrets();
const webPort = Number(process.env.PORT) || (await freePort());
const stack = await startStack({ webPort });
console.log(`postgres  127.0.0.1:${stack.pgPort}`);
for (const name of stack.applied) console.log(`migrated  ${name}`);
console.log("seeded");
console.log(
  secrets === null
    ? "secrets   none: no DOTENV_PRIVATE_KEY_DEVELOPMENT, every vendor is faked"
    : `secrets   ${stack.secrets} from .env.development`,
);
const faked = {
  identity: "faked: pick a seeded person from the pill",
  mail: "faked: sign-in codes print here",
  analytics: "faked: nothing is reported",
  storage: `faked: uploads go to ${process.env.UPLOADS_DIR ?? ".local/uploads"}`,
  connections: "faked: three pretend apps connect with a click",
  embeddings: "faked: a stand-in hashes words",
};
for (const [name, vendor] of Object.entries(stack.vendors)) {
  console.log(
    `${name.padEnd(11)} ${vendor ? `real (${vendor})` : faked[name]}`,
  );
}
console.log(`web       http://localhost:${stack.webPort}`);

const shutdown = () => stack.stop().then(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
stack.web.on("exit", shutdown);
