// Refuses an installer template that Terraform would write differently, so
// every change to it reads the same. Skips where neither Terraform nor
// OpenTofu is installed, since the app itself never needs them.
import { spawnSync } from "node:child_process";
import path from "node:path";

import { root } from "./root.mjs";

const tool = ["terraform", "tofu"].find(
  (name) => spawnSync(name, ["version"], { stdio: "ignore" }).status === 0,
);
if (!tool) {
  console.log("skip  infra: no terraform or tofu on this machine");
  process.exit(0);
}
const run = spawnSync(tool, ["fmt", "-check", "-recursive", "-diff"], {
  cwd: path.join(root, "infra"),
  encoding: "utf8",
});
if (run.status !== 0) {
  console.error(`infra: ${tool} fmt would change these; run it in infra/`);
  console.error(run.stdout || run.stderr);
  process.exit(1);
}
console.log(`infra: the installer is as ${tool} writes it`);
