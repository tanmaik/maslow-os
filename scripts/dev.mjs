import { startStack } from "./stack.mjs";

const stack = await startStack({ webPort: process.env.PORT });
console.log(`postgres  127.0.0.1:${stack.pgPort}`);
for (const name of stack.applied) console.log(`migrated  ${name}`);
console.log("seeded");
console.log(
  stack.secrets === null
    ? "secrets   none: no DOTENV_PRIVATE_KEY_DEVELOPMENT, vendors are faked"
    : `secrets   ${stack.secrets} from .env.development`,
);
console.log(`web       http://localhost:${stack.webPort}`);

const shutdown = () => stack.stop().then(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
stack.web.on("exit", shutdown);
