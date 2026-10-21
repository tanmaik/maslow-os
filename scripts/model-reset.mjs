// Gives people a fresh week's allowance on models without moving their
// week: each key named is given a ceiling of what it has spent plus the
// cap, which the app leaves alone until that person's week next turns.
//
//   pnpm model:reset production            every production key
//   pnpm model:reset production 7cb91e64   the keys whose name holds this
//
// It speaks to OpenRouter alone, with the provisioning key, and touches no
// database.
const [where, ...which] = process.argv.slice(2);
const key = process.env.OPENROUTER_PROVISIONING_KEY;
const capUsd = Number(process.env.CAP_USD) || 5;
if (!where || !key) {
  console.error(
    "usage: pnpm model:reset <environment> [part of a key's name…]",
  );
  process.exit(1);
}

const call = async (method, path, body) => {
  const res = await fetch(`https://openrouter.ai/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}`);
  return res.json();
};

const keys = [];
for (let offset = 0; ; offset += 100) {
  const page = (await call("GET", `/keys?offset=${offset}`)).data;
  keys.push(...page);
  if (page.length < 100) break;
}
const named = keys.filter(
  (k) =>
    k.name.startsWith(`maslow ${where} `) &&
    (which.length === 0 || which.some((w) => k.name.includes(w))),
);
for (const k of named) {
  const limit = k.usage + capUsd;
  await call("PATCH", `/keys/${k.hash}`, { limit, limit_reset: null });
  console.log(`${k.name}: $${capUsd} to spend again`);
}
if (named.length === 0) console.log("no key by that name");
