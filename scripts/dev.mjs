import { spawn } from "node:child_process";
import path from "node:path";

import { answerTheBrain } from "./brain.mjs";
import { cloudOf } from "./cloud.mjs";
import { checkout, devSecrets, freePort, root, startStack } from "./stack.mjs";

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
  computers: "off: no FLY_API_TOKEN, nobody gets a computer",
  connections: "faked: three pretend apps connect with a click",
  embeddings: "faked: a stand-in hashes words",
  speech: "off: no DEEPGRAM_API_KEY, hold to talk says so",
  sync: "off: no relay, nothing is live",
};
for (const [name, vendor] of Object.entries(stack.vendors)) {
  console.log(
    `${name.padEnd(11)} ${vendor ? `real (${vendor})` : faked[name]}`,
  );
}
console.log(`web       http://localhost:${stack.webPort}`);
if (stack.computer)
  console.log(
    `computer  ${stack.webPort}-${stack.computer}, under whichever computers' domain reaches this machine`,
  );

// The machines this checkout made keep running only while it does: their
// lease is renewed every ten minutes, and the hourly reap stops what
// lapsed. Silence can only stop a machine, never leak one.
const renew = () =>
  cloudOf(stack.env)
    .renewLeases(checkout, stack.env)
    .then(
      (n) =>
        n &&
        console.log(
          `computers  ${n} lease${n === 1 ? "" : "s"} renewed for ${checkout}`,
        ),
      (err) => console.error(`computers  lease: ${err.message}`),
    );
let leases = null;
// A machine cannot reach a laptop, so the brain is answered the other way
// about: this checkout dials its machines and holds their doors open.
let brains = null;
if (stack.vendors.computers) {
  void renew();
  leases = setInterval(renew, 10 * 60_000);
  brains = answerTheBrain({
    checkout,
    webPort: stack.webPort,
    env: stack.env,
  });
}
console.log(`checkout  ${checkout}`);

// Agentation's server, where a note made on the page lands, runs beside
// the stack unless one already answers on its port, another checkout's or
// a Claude session's: then that one serves, since every note goes to the
// same place either way.
const COMMENTS = "http://localhost:4747";
const answering = () =>
  fetch(`${COMMENTS}/health`, { signal: AbortSignal.timeout(1000) }).then(
    (r) => r.ok,
    () => false,
  );
let comments = null;
if (!(await answering())) {
  comments = spawn(
    process.execPath,
    [
      path.join(
        root,
        "apps",
        "web",
        "node_modules",
        "agentation-mcp",
        "dist",
        "cli.js",
      ),
      "server",
    ],
    { stdio: "ignore" },
  );
  for (let i = 0; i < 20 && !(await answering()); i++)
    await new Promise((r) => setTimeout(r, 250));
}
console.log(
  `comments  ${
    (await answering())
      ? `${COMMENTS}${comments ? "" : " (already up)"}`
      : "off: Agentation's server did not start"
  }`,
);

const shutdown = () => {
  if (leases) clearInterval(leases);
  if (brains) brains();
  comments?.kill();
  return stack.stop().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
stack.web.on("exit", shutdown);
