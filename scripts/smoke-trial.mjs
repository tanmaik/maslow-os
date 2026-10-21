// The trial's gate, on a fresh cluster of its own: a trial deployment
// resolves with no vendor's key at all; "Try it" makes a guest with an org
// and a session; the reap deletes trial orgs a day old and keeps younger
// ones; and, through a dev server run as a trial, uploads are refused and
// the brain's MCP is not there.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { migrate } from "../packages/db/src/migrate.ts";
import {
  ensureAppRole,
  exited,
  startPostgres,
} from "../packages/db/src/postgres.ts";
import { freePort, root } from "./stack.mjs";

let ok = true;
const check = (label, pass, detail = "") => {
  console.log(
    `${pass ? "ok  " : "FAIL"}  trial: ${label.padEnd(34)} ${detail}`,
  );
  ok &&= pass;
};

// Every vendor's key, emptied: a trial needs none of them.
const KEYS = [
  "WORKOS_API_KEY",
  "WORKOS_CLIENT_ID",
  "RESEND_API_KEY",
  "MAIL_FROM",
  "POSTHOG_KEY",
  "STORAGE_ENDPOINT",
  "STORAGE_REGION",
  "STORAGE_BUCKET",
  "STORAGE_ACCESS_KEY",
  "STORAGE_SECRET_KEY",
  "COMPOSIO_API_KEY",
  "VOYAGE_API_KEY",
  "FLY_API_TOKEN",
  "FLY_COMPUTERS_APP",
  "FLY_MACHINES_DOMAIN",
  "AWS_COMPUTERS_NAME",
  "APNS_TEAM_ID",
  "APNS_KEY_ID",
  "APNS_KEY",
  "SYNC_URL",
  "VERCEL",
];
const bare = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => !KEYS.includes(k)),
);

// 1. The deployment as production reads it, with no key but the trial's.
{
  const said = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { deployment: d } = await import(${JSON.stringify(
        path.join(root, "apps/web/lib/deployment.ts"),
      )}); console.log(JSON.stringify(d));`,
    ],
    {
      env: {
        ...bare,
        NODE_ENV: "production",
        TRIAL: "1",
        APP_URL: "https://maslow.example.test",
        SYNC_SECRET: "trial",
        CRON_SECRET: "trial",
      },
      encoding: "utf8",
    },
  );
  const d = JSON.parse(said.trim().split("\n").at(-1));
  const kinds = [
    d.identity.kind,
    d.mail.kind,
    d.storage.kind,
    d.analytics.kind,
    d.embeddings.kind,
    d.connections.kind,
    d.computers.kind,
    d.push.kind,
    d.sync.kind,
  ].join(" ");
  check(
    "production with no keys resolves",
    d.trial === true &&
      d.production === true &&
      d.seededSignIn === false &&
      kinds === "trial none none none fake fake none none none",
    kinds,
  );
}

await fs.mkdir(path.join(root, ".local"), { recursive: true });
const scratch = await fs.mkdtemp(path.join(root, ".local", "smoke-trial-"));
const pgPort = await freePort();
const cluster = await startPostgres(path.join(scratch, "pg"), pgPort, {
  temporary: true,
});
let web;
try {
  await ensureAppRole(cluster.url);
  await migrate(cluster.url, path.join(root, "packages/db/migrations"));
  // The app's own pool, as the app role, read when first asked for.
  process.env.DATABASE_URL = `postgres://app@127.0.0.1:${pgPort}/postgres`;
  const { asPerson } = await import("../packages/db/src/index.ts");
  const { foundTrial, createSession, resolveSession } =
    await import("../packages/db/src/auth.ts");
  const { reapTrials, trialCount } =
    await import("../packages/db/src/trials.ts");
  const { seedTrial } = await import("../packages/brain/src/seed.ts");
  const pg = createRequire(
    new URL("../packages/db/package.json", import.meta.url),
  )("pg");
  const owner = new pg.Client({ connectionString: cluster.url });
  await owner.connect();

  // 2. A guest, an org of their own with the made-up records, a session.
  const guest = async () => {
    const email = `guest-${Math.random().toString(16).slice(2)}@trial.invalid`;
    const p = await foundTrial(email);
    await asPerson(p, (q) => seedTrial(q));
    return { p, email };
  };
  const a = await guest();
  const token = await createSession(a.p);
  const s = await resolveSession(token);
  const records = (
    await owner.query(
      "select count(*)::int as n from records where org_id = $1",
      [a.p.orgId],
    )
  ).rows[0].n;
  const marked = (
    await owner.query("select trial_at from orgs where id = $1", [a.p.orgId])
  ).rows[0]?.trial_at;
  check(
    "try makes a guest, an org and a session",
    s?.orgId === a.p.orgId && records > 0 && marked instanceof Date,
    `${records} records, session ${s ? "resolves" : "missing"}`,
  );

  // 3. A day old goes, with its guest; a younger one stays.
  const b = await guest();
  await owner.query(
    "update orgs set trial_at = now() - interval '25 hours' where id = $1",
    [a.p.orgId],
  );
  const before = await trialCount();
  const gone = await reapTrials(24);
  const left = (
    await owner.query("select id from orgs where trial_at is not null")
  ).rows.map((r) => r.id);
  const people = (
    await owner.query("select email from people where email = any($1)", [
      [a.email, b.email],
    ])
  ).rows.map((r) => r.email);
  const orphaned = (
    await owner.query(
      "select count(*)::int as n from records where org_id = $1",
      [a.p.orgId],
    )
  ).rows[0].n;
  check(
    "reap takes a day-old org, keeps a new one",
    before === 2 &&
      gone === 1 &&
      left.length === 1 &&
      left[0] === b.p.orgId &&
      people.length === 1 &&
      people[0] === b.email &&
      orphaned === 0 &&
      (await resolveSession(token)) === null,
    `${gone} gone, ${left.length} left, ${orphaned} records left behind`,
  );
  await owner.end();

  // 4. Through the pages, as a trial.
  const webPort = await freePort();
  const url = `http://127.0.0.1:${webPort}`;
  web = spawn(
    path.join(root, "apps", "web", "node_modules", ".bin", "next"),
    ["dev", "-p", String(webPort)],
    {
      cwd: path.join(root, "apps", "web"),
      stdio: ["ignore", "ignore", "pipe"],
      env: {
        ...bare,
        TRIAL: "1",
        DATABASE_URL: process.env.DATABASE_URL,
        APP_URL: url,
        CRON_SECRET: "trial",
        NEXT_DIST_DIR: ".next-smoke",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
  let stderr = "";
  web.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (exited(web)) throw new Error(`next dev exited:\n${stderr}`);
    if (Date.now() > deadline) throw new Error(`no answer:\n${stderr}`);
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  const signedOut = await (await fetch(url)).text();
  const tried = await fetch(`${url}/try`, {
    method: "POST",
    redirect: "manual",
  });
  const cookie = tried.headers.get("set-cookie")?.match(/session=[^;]+/)?.[0];
  const home = cookie
    ? (await (await fetch(url, { headers: { cookie } })).text()).replaceAll(
        "<!-- -->",
        "",
      )
    : "";
  check(
    "the page offers Try it, /try signs in",
    signedOut.includes("Try it") &&
      !signedOut.includes('name="email"') &&
      tried.status === 303 &&
      Boolean(cookie) &&
      home.includes("Get Maslow OS"),
    `try ${tried.status}, cookie ${cookie ? "set" : "missing"}`,
  );

  const form = new FormData();
  form.set(
    "file",
    new Blob(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])],
      {
        type: "image/png",
      },
    ),
    "x.png",
  );
  const wallpaper = await fetch(`${url}/desktop/wallpaper`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  const said = await wallpaper.text();
  const shared = await fetch(
    `${url}/file/00000000-0000-4000-8000-000000000000/upload`,
    {
      method: "PUT",
      headers: { cookie },
      body: "x",
    },
  );
  const computerUpload = await fetch(`${url}/computer/files/upload`, {
    method: "POST",
    headers: { cookie },
    body: "x",
  });
  check(
    "uploads are refused",
    !wallpaper.ok &&
      said.includes("The trial keeps no files") &&
      shared.status === 404 &&
      computerUpload.status === 403 &&
      (await computerUpload.text()) === "Read-only in the trial",
    `wallpaper ${wallpaper.status}, shared ${shared.status}, computer ${computerUpload.status}`,
  );

  const mcp = await Promise.all([
    fetch(`${url}/mcp`, { method: "POST", headers: { cookie } }),
    fetch(`${url}/mcp`),
    fetch(`${url}/oauth/register`, { method: "POST", body: "{}" }),
    fetch(`${url}/.well-known/oauth-authorization-server`),
  ]);
  check(
    "MCP and OAuth are not there",
    mcp.every((r) => r.status === 404),
    mcp.map((r) => r.status).join(" "),
  );

  // 5. The pretend computer: its shell, its home folder, its apps, and
  // what they wrote to the brain.
  const sh = async (line) =>
    (
      await fetch(`${url}/trial/shell`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ line }),
      })
    ).json();
  const [ls, nope, claude] = await Promise.all([
    sh("ls"),
    sh("rm -rf /"),
    sh("claude"),
  ]);
  check(
    "the terminal answers ls",
    ls.out.includes("apps/") &&
      ls.out.includes("notes/") &&
      nope.out.startsWith("rm: not in the trial") &&
      claude.replay === true,
    ls.out,
  );
  const listed = await fetch(`${url}/computer/files/list?path=.`, {
    headers: { cookie },
  });
  const folder = listed.ok ? (await listed.json()).map((e) => e.name) : [];
  const todo = await (
    await fetch(`${url}/computer/files/read?path=notes/todo.md`, {
      headers: { cookie },
    })
  ).text();
  const mkdir = await fetch(`${url}/computer/files/mkdir?path=x`, {
    method: "POST",
    headers: { cookie },
  });
  const found = await (
    await fetch(`${url}/trial/maslow/find?q=todo&ticket=trial`, {
      headers: { cookie },
    })
  ).json();
  check(
    "Files lists the home folder",
    folder.includes("README.md") &&
      folder.includes("apps") &&
      todo.includes("Publish the reading list") &&
      mkdir.status === 403 &&
      found.includes("notes/todo.md"),
    folder.join(" "),
  );
  const applets = (
    await (
      await fetch(`${url}/computer/applets`, { headers: { cookie } })
    ).text()
  ).replaceAll("<!-- -->", "");
  const app = await (await fetch(`${url}/trial/app/3000`)).text();
  const books = new pg.Client({ connectionString: cluster.url });
  await books.connect();
  const fromApps = (
    await books.query(
      "select count(*)::int as n from records r join orgs o on o.id = r.org_id where o.trial_at is not null and r.source in ('reading-list', 'run-log')",
    )
  ).rows[0].n;
  await books.end();
  check(
    "Applets lists the demo apps",
    applets.includes("Reading list") &&
      applets.includes("Run log") &&
      app.includes("Sourdough at Altitude") &&
      fromApps >= 8,
    `${fromApps} records from the apps`,
  );
} catch (err) {
  check("ran", false, err.message);
} finally {
  web?.kill();
  await globalThis.__pool?.end().catch(() => {});
  await cluster.stop();
  await fs.rm(scratch, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
