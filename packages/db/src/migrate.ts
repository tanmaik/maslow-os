import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

// Applies every migrations/*.sql not yet applied, in filename order. Applied
// files are checksummed; a changed one is refused, never re-run. One runner at
// a time per database.
export async function migrate(url: string, dir: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      "select pg_advisory_lock(hashtext('schema_migrations'))",
    );
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`);
    const applied = new Map<string, string>(
      (
        await client.query("select name, checksum from schema_migrations")
      ).rows.map((r) => [r.name, r.checksum]),
    );

    const done: string[] = [];
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const name of files) {
      const sql = fs.readFileSync(path.join(dir, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = applied.get(name);
      if (previous === checksum) continue;
      if (previous !== undefined) {
        throw new Error(
          `${name} changed after it was applied. Migrations are append-only: ` +
            `put the fix in a new file with a later timestamp.`,
        );
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into schema_migrations (name, checksum) values ($1, $2)",
          [name, checksum],
        );
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
      done.push(name);
    }
    return done;
  } finally {
    await client.end();
  }
}
