// One database per pull request: a Neon branch off preview-parent, the two
// URLs written to Vercel scoped to the PR's git branch and stamped as ours,
// and a marked deployment of the head. Every run reapplies all of it, so a
// retry after any failure converges.
//   up   --pr N --branch REF --sha SHA
//   down --pr N
//   reap                       remove whatever no open pull request owns
import { createHmac } from "node:crypto";
import { parseArgs } from "node:util";

const {
  positionals: [command],
  values: opt,
} = parseArgs({
  allowPositionals: true,
  options: {
    pr: { type: "string" },
    branch: { type: "string" },
    sha: { type: "string" },
  },
});
const pr = Number(opt.pr);
const ref = opt.branch;
const usage = {
  up: Number.isInteger(pr) && ref && opt.sha,
  down: Number.isInteger(pr),
  reap: true,
};
if (!usage[command]) {
  throw new Error(
    "usage: preview-db.mjs up --pr N --branch REF --sha SHA | down --pr N | reap",
  );
}

const need = (k) =>
  process.env[k] ||
  (() => {
    throw new Error(`${k} is not set`);
  })();
const neonKey = need("NEON_API_KEY");
const neonProject = need("NEON_PROJECT_ID");
const parentName = need("NEON_PARENT_BRANCH");
const vercelToken = need("VERCEL_TOKEN");
const team = need("VERCEL_TEAM_ID");
const project = need("VERCEL_PROJECT_ID");

async function call(base, token, method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body && JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    throw Object.assign(
      new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 300)}`),
      {
        status: r.status,
      },
    );
  }
  return text ? JSON.parse(text) : {};
}
const neon = (m, p, b) =>
  call("https://console.neon.tech/api/v2", neonKey, m, p, b);
const vercel = (m, p, b) =>
  call(
    "https://api.vercel.com",
    vercelToken,
    m,
    `${p}${p.includes("?") ? "&" : "?"}teamId=${team}`,
    b,
  );

// Neon pages its branch list by cursor; Vercel returns every env row at once.
async function branches() {
  const all = [];
  for (let cursor; ;) {
    const page = await neon(
      "GET",
      `/projects/${neonProject}/branches?limit=100${cursor ? `&cursor=${cursor}` : ""}`,
    );
    all.push(...page.branches);
    cursor = page.pagination?.next;
    if (!cursor || page.branches.length === 0) return all;
  }
}
const envs = async () =>
  (await vercel("GET", `/v9/projects/${project}/env`)).envs;

// Neon runs SQL over HTTPS on the endpoint host; no client library needed.
async function sql(uri, query) {
  const r = await fetch(`https://${new URL(uri).host}/sql`, {
    method: "POST",
    headers: {
      "Neon-Connection-String": uri,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, params: [] }),
  });
  if (!r.ok)
    throw new Error(`sql → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).rows ?? [];
}

const keys = ["DATABASE_URL", "DATABASE_OWNER_URL"];
const branchNameFor = (n) => `preview/pr-${n}`;
// A row is ours by its stamp — Vercel never returns an encrypted value for
// reading. The stamp names the pull request and the Neon branch it points at.
const stamp = (prNumber, branch) => `preview-db:pr-${prNumber}:${branch.id}`;
const stampedFor = (prNumber) => (e) =>
  keys.includes(e.key) &&
  (e.comment ?? "").startsWith(`preview-db:pr-${prNumber}:`);
const ours = (e) =>
  keys.includes(e.key) && (e.comment ?? "").startsWith("preview-db:");
// The app role's password is a function of the branch, so every run sets the
// same one and nothing has to be remembered or rotated.
const passwordFor = (branch) =>
  createHmac("sha256", neonKey).update(branch.id).digest("hex");

async function removeRows(rows) {
  for (const e of rows) {
    await vercel("DELETE", `/v9/projects/${project}/env/${e.id}`);
    console.log(`vercel: removed ${e.key} for branch ${e.gitBranch}`);
  }
}

async function up() {
  const name = branchNameFor(pr);
  const existing = await branches();
  let branch = existing.find((b) => b.name === name);
  if (!branch) {
    const parent = existing.find((b) => b.name === parentName);
    if (!parent) throw new Error(`Neon branch ${parentName} does not exist`);
    ({ branch } = await neon("POST", `/projects/${neonProject}/branches`, {
      branch: { name, parent_id: parent.id },
      endpoints: [{ type: "read_write" }],
    }));
    console.log(`neon: created ${name} (${branch.id}) off ${parentName}`);
  } else {
    console.log(`neon: ${name} exists (${branch.id})`);
  }

  const owner = (
    await neon(
      "GET",
      `/projects/${neonProject}/connection_uri?branch_id=${branch.id}&database_name=neondb&role_name=neondb_owner&pooled=false`,
    )
  ).uri;
  const password = passwordFor(branch);
  if (
    (await sql(owner, "select 1 from pg_roles where rolname = 'app'"))
      .length === 0
  ) {
    await sql(owner, "create role app login");
  }
  await sql(owner, `alter role app password '${password}'`);

  const app = new URL(owner);
  app.username = "app";
  app.password = password;
  app.host = app.host.replace(/^(ep-[a-z0-9-]+?)\./, "$1-pooler.");
  for (const [key, value] of [
    ["DATABASE_URL", app.toString()],
    ["DATABASE_OWNER_URL", owner],
  ]) {
    await vercel("POST", `/v10/projects/${project}/env?upsert=true`, {
      key,
      value,
      type: "encrypted",
      target: ["preview"],
      gitBranch: ref,
      comment: stamp(pr, branch),
    });
  }
  console.log(`vercel: ${keys.join(", ")} set for branch ${ref}`);
  // A renamed head leaves a pair under the old name; only the current one stays.
  await removeRows(
    (await envs()).filter((e) => stampedFor(pr)(e) && e.gitBranch !== ref),
  );

  // apps/web/vercel.json skips any preview build without the marker, so this
  // is the only build of the head. `build.env` is not in Vercel's published
  // schema for this endpoint; it was verified live on 2026-09-03.
  const { name: projectName, link } = await vercel(
    "GET",
    `/v9/projects/${project}`,
  );
  const d = await vercel("POST", `/v13/deployments`, {
    name: projectName,
    gitSource: { type: "github", repoId: link.repoId, ref, sha: opt.sha },
    build: { env: { PREVIEW_DB: "1" } },
  });
  console.log(`vercel: deployed ${opt.sha.slice(0, 7)} → https://${d.url}`);
}

// Removes the pull request's rows, then its branch if it still exists.
async function down(prNumber = pr, branch = undefined) {
  await removeRows((await envs()).filter(stampedFor(prNumber)));
  const name = branchNameFor(prNumber);
  branch ??= (await branches()).find((b) => b.name === name);
  if (!branch) return;
  await neon("DELETE", `/projects/${neonProject}/branches/${branch.id}`);
  console.log(`neon: deleted ${name}`);
}

// Everything of ours that no open pull request owns: preview branches whose
// pull request is closed or missing, and stamped rows whose branch is gone.
async function reap() {
  const repo = need("GITHUB_REPOSITORY");
  const gh = (p) =>
    call("https://api.github.com", need("GITHUB_TOKEN"), "GET", p);
  let swept = 0;

  const existing = await branches();
  for (const b of existing) {
    const m = /^preview\/pr-(\d+)$/.exec(b.name);
    if (!m) continue;
    const p = await gh(`/repos/${repo}/pulls/${m[1]}`).catch((e) =>
      e.status === 404 ? null : Promise.reject(e),
    );
    if (p?.state === "open") continue;
    await down(Number(m[1]), b);
    swept++;
  }

  const live = new Set(existing.map((b) => b.id));
  const orphaned = (await envs()).filter(
    (e) => ours(e) && !live.has(e.comment.split(":").at(-1)),
  );
  await removeRows(orphaned);
  swept += orphaned.length;

  console.log(`reap: ${swept} stale item${swept === 1 ? "" : "s"} removed`);
}

await { up, down, reap }[command]();
