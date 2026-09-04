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
  "reap-dev": [],
};
if (!usage[command]) {
  throw new Error(
    "usage: preview-db.mjs up --pr N --branch REF --sha SHA | down --pr N | reap | reap-dev",
  );
}

// Each key is demanded the moment it is used, so a command that needs only
// some of them runs with only those.
const need = (k) =>
  process.env[k] ||
  (() => {
    throw new Error(`${k} is not set`);
  })();
const neonKey = () => need("NEON_API_KEY");
const neonProject = () => need("NEON_PROJECT_ID");
const parentName = () => need("NEON_PARENT_BRANCH");
const vercelToken = () => need("VERCEL_TOKEN");
const team = () => need("VERCEL_TEAM_ID");
const project = () => need("VERCEL_PROJECT_ID");

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
  call("https://console.neon.tech/api/v2", neonKey(), m, p, b);
const vercel = (m, p, b) =>
  call(
    "https://api.vercel.com",
    vercelToken(),
    m,
    `${p}${p.includes("?") ? "&" : "?"}teamId=${team()}`,
    b,
  );

// Neon pages its branch list by cursor; Vercel returns every env row at once.
async function branches() {
  const all = [];
  for (let cursor; ;) {
    const page = await neon(
      "GET",
      `/projects/${neonProject()}/branches?limit=100${cursor ? `&cursor=${cursor}` : ""}`,
    );
    all.push(...page.branches);
    cursor = page.pagination?.next;
    if (!cursor || page.branches.length === 0) return all;
  }
}
const envs = async () =>
  (await vercel("GET", `/v9/projects/${project()}/env`)).envs;

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

const keys = [
  "DATABASE_URL",
  "DATABASE_OWNER_URL",
  "STORAGE_PREFIX",
  "FLY_API_TOKEN",
  "FLY_COMPUTERS_APP",
  "FLY_NAME_PREFIX",
  "FLY_REPORT_URL",
];
// Previews share the bucket under a prefix of their own, emptied with them.
const prefixFor = (n) => `preview/pr-${n}/`;
// Previews make real computers in a Fly app of their own, every machine and
// volume named for the pull request, destroyed with it. The token is scoped
// to that app and nothing else.
const flyPreviewApp = "placeholder-computers-preview";
const flyNamePrefixFor = (n) => `pr${n}-`;
// Vercel's branch alias: the daemon reports there, whichever deployment is
// current for the branch.
const branchUrlFor = (projectName, branch, teamSlug) =>
  `https://${projectName}-git-${branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${teamSlug}.vercel.app`;
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
  createHmac("sha256", neonKey()).update(branch.id).digest("hex");

async function removeRows(rows) {
  for (const e of rows) {
    await vercel("DELETE", `/v9/projects/${project()}/env/${e.id}`);
    console.log(`vercel: removed ${e.key} for branch ${e.gitBranch}`);
  }
}

async function up() {
  const name = branchNameFor(pr);
  const existing = await branches();
  let branch = existing.find((b) => b.name === name);
  if (!branch) {
    const parent = existing.find((b) => b.name === parentName());
    if (!parent) throw new Error(`Neon branch ${parentName()} does not exist`);
    ({ branch } = await neon("POST", `/projects/${neonProject()}/branches`, {
      branch: { name, parent_id: parent.id },
      endpoints: [{ type: "read_write" }],
    }));
    console.log(`neon: created ${name} (${branch.id}) off ${parentName()}`);
  } else {
    console.log(`neon: ${name} exists (${branch.id})`);
  }

  const owner = (
    await neon(
      "GET",
      `/projects/${neonProject()}/connection_uri?branch_id=${branch.id}&database_name=neondb&role_name=neondb_owner&pooled=false`,
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
  const {
    name: projectName,
    link,
    accountId,
  } = await vercel("GET", `/v9/projects/${project()}`);
  // The team's slug is part of every branch URL; the preview token cannot
  // read the team, so the workflow says it.
  const teamSlug = need("VERCEL_TEAM_SLUG");
  const flyToken = process.env.FLY_PREVIEW_TOKEN;
  if (!flyToken) {
    console.log("fly: no FLY_PREVIEW_TOKEN, this preview has no computers");
    await removeRows(
      (await envs()).filter(
        (e) =>
          stampedFor(pr)(e) && e.gitBranch === ref && e.key.startsWith("FLY_"),
      ),
    );
  }
  for (const [key, value] of [
    ["DATABASE_URL", app.toString()],
    ["DATABASE_OWNER_URL", owner],
    ["STORAGE_PREFIX", prefixFor(pr)],
    ...(flyToken
      ? [
          ["FLY_API_TOKEN", flyToken],
          ["FLY_COMPUTERS_APP", flyPreviewApp],
          ["FLY_NAME_PREFIX", flyNamePrefixFor(pr)],
          [
            "FLY_REPORT_URL",
            `${branchUrlFor(projectName, ref, teamSlug)}/computer/report`,
          ],
        ]
      : []),
  ]) {
    await vercel("POST", `/v10/projects/${project()}/env?upsert=true`, {
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
  // is the only build of the head.
  const d = await vercel("POST", `/v13/deployments`, {
    name: projectName,
    gitSource: { type: "github", repoId: link.repoId, ref, sha: opt.sha },
    build: { env: { PREVIEW_DB: "1" } },
  });
  console.log(`vercel: deployed ${opt.sha.slice(0, 7)} → https://${d.url}`);
}

// Empties a prefix of the bucket, when this run holds the bucket's keys.
async function emptyPrefix(prefix) {
  const { STORAGE_ENDPOINT, STORAGE_REGION, STORAGE_BUCKET } = process.env;
  const { STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY } = process.env;
  if (!STORAGE_ACCESS_KEY || !STORAGE_SECRET_KEY)
    throw new Error(
      `bucket: no keys here, so ${prefix} cannot be emptied and the preview stays`,
    );
  const cfg = {
    endpoint: STORAGE_ENDPOINT,
    region: STORAGE_REGION,
    bucket: STORAGE_BUCKET,
    accessKey: STORAGE_ACCESS_KEY,
    secretKey: STORAGE_SECRET_KEY,
  };
  const { s3, unescapeXml } = await import("../apps/web/lib/s3.ts");
  let removed = 0;
  for (;;) {
    const r = await s3(cfg, "GET", "", undefined, undefined, {
      "list-type": "2",
      prefix,
      "max-keys": "1000",
    });
    if (!r.ok) throw new Error(`bucket list → ${r.status}`);
    const found = [...(await r.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map(
      (m) => unescapeXml(m[1]),
    );
    for (const key of found) {
      const d = await s3(cfg, "DELETE", key);
      if (!d.ok && d.status !== 404)
        throw new Error(`bucket delete → ${d.status}`);
      removed++;
    }
    if (found.length < 1000) break;
  }
  // Uploads begun and never finished under the prefix are billed too.
  let markers = {};
  for (;;) {
    const u = await s3(cfg, "GET", "", undefined, undefined, {
      uploads: "",
      prefix,
      ...markers,
    });
    if (!u.ok) throw new Error(`bucket uploads list → ${u.status}`);
    const xml = await u.text();
    for (const m of xml.matchAll(
      /<Upload>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<UploadId>([^<]+)<\/UploadId>[\s\S]*?<\/Upload>/g,
    )) {
      const a = await s3(
        cfg,
        "DELETE",
        unescapeXml(m[1]),
        undefined,
        undefined,
        {
          uploadId: m[2],
        },
      );
      if (!a.ok && a.status !== 404)
        throw new Error(`bucket abort → ${a.status}`);
      removed++;
    }
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) break;
    markers = {
      "key-marker": unescapeXml(
        /<NextKeyMarker>([^<]*)<\/NextKeyMarker>/.exec(xml)?.[1] ?? "",
      ),
      "upload-id-marker":
        /<NextUploadIdMarker>([^<]*)<\/NextUploadIdMarker>/.exec(xml)?.[1] ??
        "",
    };
  }
  console.log(
    `bucket: ${removed} object${removed === 1 ? "" : "s"} under ${prefix} removed`,
  );
}

// Destroys the pull request's machines, then its volumes, in the preview
// Fly app, when this run holds that app's token.
// Destroys every machine and volume named for a pull request, or for
// whatever prefix is given.
async function destroyComputers(prNumber, named = null) {
  const token = process.env.FLY_PREVIEW_TOKEN;
  if (!token) {
    console.log(
      `fly: no FLY_PREVIEW_TOKEN, ${named ?? `pr${prNumber}`} computers left as is`,
    );
    return;
  }
  const prefix = named ?? flyNamePrefixFor(prNumber);
  const api = async (method, path, allow404 = false) => {
    const r = await fetch(
      `https://api.machines.dev/v1/apps/${flyPreviewApp}${path}`,
      { method, headers: { authorization: `Bearer ${token}` } },
    );
    if (r.status === 404 && allow404) return null;
    if (!r.ok) throw new Error(`fly ${method} ${path} → ${r.status}`);
    return r.json();
  };
  let gone = 0;
  for (const m of (await api("GET", "/machines")).filter((m) =>
    m.name.startsWith(prefix),
  )) {
    await api("DELETE", `/machines/${m.id}?force=true`, true);
    let still;
    for (let i = 0; i < 60; i++) {
      still = await api("GET", `/machines/${m.id}`, true);
      if (!still || still.state === "destroyed") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (still && still.state !== "destroyed")
      throw new Error(`fly: machine ${m.id} did not go within a minute`);
    gone++;
  }
  for (const v of (await api("GET", "/volumes")).filter((v) =>
    v.name.startsWith(prefix.replaceAll("-", "_")),
  )) {
    let last;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await api("DELETE", `/volumes/${v.id}`, true);
        last = null;
        break;
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (last) throw last;
    gone++;
  }
  console.log(
    `fly: ${gone} of ${named ?? `pr${prNumber}`}'s machines and volumes destroyed`,
  );
}

// Every preview deployment of the project(), oldest last.
async function previewDeployments() {
  const all = [];
  let next;
  do {
    const page = await vercel(
      "GET",
      `/v6/deployments?projectId=${project()}&target=preview&limit=100${next ? `&until=${next}` : ""}`,
    );
    all.push(...page.deployments);
    next = page.pagination?.next;
  } while (next);
  return all;
}

// Deletes the preview deployments of the given branches: their URLs stop
// answering for a database that is gone.
async function removeDeployments(branches) {
  let removed = 0;
  for (const d of await previewDeployments()) {
    if (!branches.has(d.meta?.githubCommitRef)) continue;
    await vercel("DELETE", `/v13/deployments/${d.uid}`);
    removed++;
  }
  console.log(
    `vercel: ${removed} preview deployment${removed === 1 ? "" : "s"} removed`,
  );
}

// Removes the pull request's rows, objects, computers and deployments, then
// its branch if it still exists.
async function down(prNumber = pr, branch = undefined) {
  for (const d of await deploymentsOf(prNumber)) {
    await vercel("DELETE", `/v13/deployments/${d.uid}`);
    console.log(`vercel: deleted deployment ${d.url}`);
  }
  const rows = (await envs()).filter(stampedFor(prNumber));
  await removeRows(rows);
  await emptyPrefix(prefixFor(prNumber));
  await destroyComputers(prNumber);
  const headRef =
    prNumber === pr && ref
      ? ref
      : (
          await gh(
            `/repos/${need("GITHUB_REPOSITORY")}/pulls/${prNumber}`,
          ).catch(() => null)
        )?.head?.ref;
  await removeDeployments(
    new Set([...rows.map((e) => e.gitBranch), headRef].filter(Boolean)),
  );
  const name = branchNameFor(prNumber);
  branch ??= (await branches()).find((b) => b.name === name);
  if (!branch) return;
  await neon("DELETE", `/projects/${neonProject()}/branches/${branch.id}`);
  console.log(`neon: deleted ${name}`);
}

// Everything of ours that no open pull request owns: preview branches whose
// pull request is closed or missing, and stamped rows whose branch is gone.
const gh = async (p) =>
  call("https://api.github.com", need("GITHUB_TOKEN"), "GET", p);

// Everything a laptop made today: machines, volumes and objects named
// dev-…, gone every night, made again tomorrow. Its own command, so it
// can be run by hand with only the Fly and storage keys.
async function reapDev() {
  if (process.env.FLY_PREVIEW_TOKEN) await destroyComputers(null, "dev-");
  else console.log("fly: no FLY_PREVIEW_TOKEN, dev computers left as is");
  if (process.env.STORAGE_ACCESS_KEY && process.env.STORAGE_SECRET_KEY)
    await emptyPrefix("dev/");
  else console.log("storage: no keys, dev objects left as is");
}

async function reap() {
  const repo = need("GITHUB_REPOSITORY");
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

  await reapDev();

  // Machines and volumes of any pull request that is not open, whether or
  // not its branch survived.
  if (process.env.FLY_PREVIEW_TOKEN) {
    const r = await fetch(
      `https://api.machines.dev/v1/apps/${flyPreviewApp}/volumes`,
      { headers: { authorization: `Bearer ${process.env.FLY_PREVIEW_TOKEN}` } },
    );
    const numbers = new Set(
      (await r.json())
        .map((v) => /^pr(\d+)_/.exec(v.name)?.[1])
        .filter(Boolean),
    );
    for (const n of numbers) {
      const p = await gh(`/repos/${repo}/pulls/${n}`).catch((e) =>
        e.status === 404 ? null : Promise.reject(e),
      );
      if (p?.state === "open") continue;
      await destroyComputers(Number(n));
      swept++;
    }
  }

  const live = new Set(existing.map((b) => b.id));
  const orphaned = (await envs()).filter(
    (e) => ours(e) && !live.has(e.comment.split(":").at(-1)),
  );
  await removeRows(orphaned);
  swept += orphaned.length;

  // Deployments of any branch with no open pull request.
  const openHeads = new Set();
  for (let page = 1; ; page++) {
    const pulls = await gh(
      `/repos/${repo}/pulls?state=open&per_page=100&page=${page}`,
    );
    for (const p of pulls) openHeads.add(p.head.ref);
    if (pulls.length < 100) break;
  }
  const stale = new Set(
    (await previewDeployments())
      .map((d) => d.meta?.githubCommitRef)
      .filter((b) => b && !openHeads.has(b)),
  );
  if (stale.size) await removeDeployments(stale);

  console.log(`reap: ${swept} stale item${swept === 1 ? "" : "s"} removed`);
}

await { up, down, reap, "reap-dev": reapDev }[command]();
