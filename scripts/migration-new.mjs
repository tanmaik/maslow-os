// Creates an empty migration stamped with the clock, so two people writing
// migrations at once can never share a name.
//   pnpm migration:new add_widgets
import fs from "node:fs";
import path from "node:path";

const name = process.argv[2];
if (!/^[a-z0-9_]+$/.test(name ?? "")) {
  throw new Error("usage: pnpm migration:new <snake_case_name>");
}
const stamp = new Date()
  .toISOString()
  .replace(/[-:T]/g, "")
  .slice(0, 14)
  .replace(/^(\d{8})/, "$1_");
const file = path.join(
  import.meta.dirname,
  "..",
  "packages",
  "db",
  "migrations",
  `${stamp}_${name}.sql`,
);
fs.writeFileSync(file, "", { flag: "wx" });
console.log(path.relative(process.cwd(), file));
