// One database per pull request: a Neon branch off preview-parent, the two
// URLs written to Vercel scoped to the PR's git branch, and a deploy if the
// first build raced ahead of them.
//   up   --pr N --branch REF --sha SHA
//   down --pr N --branch REF
import { randomBytes } from "node:crypto";

const [command, ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(
  rest
    .map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : []))
    .filter(Boolean),
);
const pr = Number(opt.pr);
const ref = opt.branch;
if (!Number.isInteger(pr) || !ref)
  throw new Error(
    "usage: preview-db.mjs up|down --pr N --branch REF [--sha SHA]",
  );

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
  if (!r.ok)
    throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 300)}`);
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
}

const name = `preview/pr-${pr}`;
const keys = ["DATABASE_URL", "DATABASE_OWNER_URL"];

async function up() {
  const { branches } = await neon("GET", `/projects/${neonProject}/branches`);
  let branch = branches.find((b) => b.name === name);
  if (!branch) {
    const parent = branches.find((b) => b.name === parentName);
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
  const password = randomBytes(24).toString("base64url");
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
    });
  }
  console.log(`vercel: ${keys.join(", ")} set for branch ${ref}`);

  if (!opt.sha) return;
  const { deployments } = await vercel(
    "GET",
    `/v6/deployments?projectId=${project}&target=preview&sha=${opt.sha}&limit=1`,
  );
  const latest = deployments[0];
  if (latest && !["ERROR", "CANCELED"].includes(latest.state)) {
    console.log(
      `vercel: deployment for ${opt.sha.slice(0, 7)} is ${latest.state}; nothing to do`,
    );
    return;
  }
  const { name: projectName, link } = await vercel(
    "GET",
    `/v9/projects/${project}`,
  );
  const d = await vercel("POST", `/v13/deployments`, {
    name: projectName,
    gitSource: { type: "github", repoId: link.repoId, ref, sha: opt.sha },
  });
  console.log(`vercel: redeployed ${opt.sha.slice(0, 7)} → https://${d.url}`);
}

async function down() {
  const { branches } = await neon("GET", `/projects/${neonProject}/branches`);
  const branch = branches.find((b) => b.name === name);
  if (branch) {
    await neon("DELETE", `/projects/${neonProject}/branches/${branch.id}`);
    console.log(`neon: deleted ${name}`);
  }
  const { envs } = await vercel("GET", `/v9/projects/${project}/env`);
  for (const e of envs.filter(
    (e) => e.gitBranch === ref && keys.includes(e.key),
  )) {
    await vercel("DELETE", `/v9/projects/${project}/env/${e.id}`);
    console.log(`vercel: removed ${e.key} for branch ${ref}`);
  }
}

await (
  { up, down }[command] ??
  (() => {
    throw new Error(`unknown command ${command}`);
  })
)();
