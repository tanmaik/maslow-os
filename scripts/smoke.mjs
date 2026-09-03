// Boots the stack on a fresh database of its own and checks that each org
// sees only its own rows. This is the merge gate.
import path from "node:path";

import { orgs } from "../packages/db/src/seed.ts";
import { root, startStack, waitFor } from "./stack.mjs";

const stack = await startStack({
  stdio: "ignore",
  dataDir: path.join(root, ".local", "smoke"),
  fresh: true,
});

let failed = false;
try {
  await waitFor(stack.url);
  // No-org runs first on a never-used connection and again on a reused one,
  // where the setting exists as '' rather than missing.
  const cases = [
    ["", 0],
    ...orgs.map((o) => [`?org=${o.slug}`, o.users.length]),
    ["", 0],
  ];
  for (const [query, want] of cases) {
    const html = (
      await (await fetch(`${stack.url}/${query}`)).text()
    ).replaceAll("<!-- -->", "");
    const got = html.match(/(\d+) users visible/);
    const ok = got !== null && Number(got[1]) === want;
    console.log(
      `${ok ? "ok  " : "FAIL"}  /${query.padEnd(28)} ${got?.[0] ?? "no match"}`,
    );
    failed ||= !ok;
  }
} finally {
  await stack.stop();
}
process.exit(failed ? 1 : 0);
