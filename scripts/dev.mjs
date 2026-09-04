import { startStack } from "./stack.mjs";

const stack = await startStack({ webPort: process.env.PORT });
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
console.log(`web       http://localhost:${stack.webPort}`);

const shutdown = () => stack.stop().then(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
stack.web.on("exit", shutdown);
