// Connections' part of the merge gate, through the pages as a browser would,
// against the pretend vendor: an app is found and connected, the connection
// is its owner's alone, disconnecting deletes it at the vendor, and so does
// being removed from the org. Returns true when every check passed.
import { orgs } from "../packages/db/src/seed.ts";

export async function smokeConnections(stack, signIn) {
  let ok = true;
  const check = (label, pass, detail) => {
    console.log(
      `${pass ? "ok  " : "FAIL"}  connections: ${label.padEnd(28)} ${detail}`,
    );
    ok &&= pass;
  };
  const settings = async (cookie, query = "") =>
    (
      await fetch(`${stack.url}/settings${query}`, { headers: { cookie } })
    ).text();
  const post = (cookie, body) =>
    fetch(`${stack.url}/settings/connections`, {
      method: "POST",
      headers: { cookie },
      body: new URLSearchParams(body),
      redirect: "manual",
    });

  const bakery = orgs[1];
  const marge = await signIn(bakery.users[0].id);
  const otto = await signIn(bakery.users[1].id);

  const searched = await settings(marge, "?apps=pige");
  check(
    "an app is found",
    searched.includes("Carrier Pigeon") && !searched.includes("Sundial"),
    "Carrier Pigeon, not Sundial",
  );

  // Connecting sends the browser to the vendor's sign-in, which sends it
  // back; the outcome is asked of the vendor, not read from the address.
  const begun = await post(marge, { intent: "connect", app: "pigeon" });
  const signInUrl = begun.headers.get("location") ?? "";
  const returned = await fetch(
    signInUrl.replace("status=success", "status=failed"),
    { headers: { cookie: marge }, redirect: "manual" },
  );
  const landed = returned.headers.get("location") ?? "";
  const after = await settings(marge);
  check(
    "an app connects",
    begun.status === 303 &&
      signInUrl.includes("/settings/connections/callback?status=success") &&
      landed.endsWith("/settings?connection=connected") &&
      after.includes("Carrier Pigeon") &&
      after.includes(">active<"),
    `began ${begun.status}, landed ${landed.split("?")[1] ?? landed}`,
  );

  check(
    "a connection is its owner's alone",
    !(await settings(otto)).includes("Carrier Pigeon"),
    "Otto sees none",
  );

  const id = after.match(/name="account" value="(pretend_[0-9a-f]{8})"/)?.[1];
  const stolen = await post(otto, { intent: "disconnect", account: id });
  check(
    "nobody else disconnects it",
    stolen.status === 303 &&
      (stolen.headers.get("location") ?? "").endsWith("connection=gone") &&
      (await settings(marge)).includes("Carrier Pigeon"),
    `answered ${stolen.headers.get("location")?.split("?")[1]}`,
  );

  const ended = await post(marge, { intent: "disconnect", account: id });
  const again = await post(marge, { intent: "disconnect", account: id });
  check(
    "disconnecting deletes it at the vendor",
    ended.status === 303 &&
      (ended.headers.get("location") ?? "").endsWith(
        "connection=disconnected",
      ) &&
      !(await settings(marge)).includes("Carrier Pigeon") &&
      (again.headers.get("location") ?? "").endsWith("connection=gone"),
    `answered ${ended.headers.get("location")?.split("?")[1]}, then ${again.headers.get("location")?.split("?")[1]}`,
  );
  // Otto connects an app and is removed; brought back, he has no
  // connections, since access to his apps ended with his membership.
  const ottoBegun = await post(otto, { intent: "connect", app: "sundial" });
  await fetch(ottoBegun.headers.get("location"), {
    headers: { cookie: otto },
    redirect: "manual",
  });
  const ottoSettings = await settings(otto);
  const hadSundial = ottoSettings.includes("Sundial");
  // Marge coming back from a sign-in with Otto's account in the address
  // gets nothing: the account has to be hers at the vendor.
  const ottoAccount = ottoSettings.match(
    /name="account" value="(pretend_[0-9a-f]{8})"/,
  )?.[1];
  const forged = await fetch(
    `${stack.url}/settings/connections/callback?status=success&connected_account_id=${ottoAccount}`,
    { headers: { cookie: marge }, redirect: "manual" },
  );
  check(
    "the callback takes nobody else's account",
    (forged.headers.get("location") ?? "").endsWith("connection=gone") &&
      !(await settings(marge)).includes("Sundial"),
    `answered ${forged.headers.get("location")?.split("?")[1]}`,
  );
  const members = (body) =>
    fetch(`${stack.url}/settings/members`, {
      method: "POST",
      headers: { cookie: marge },
      body: new URLSearchParams(body),
      redirect: "manual",
    });
  await members({ remove: bakery.users[1].id });
  await members({ restore: bakery.users[1].id });
  const ottoBack = await signIn(bakery.users[1].id);
  check(
    "removal disconnects their apps",
    hadSundial && !(await settings(ottoBack)).includes("Sundial"),
    hadSundial ? "Sundial gone after removal" : "Sundial never connected",
  );
  return ok;
}
